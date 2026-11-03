from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import FundHoldingSnapshot, Instrument, Portfolio, User
from ..security import get_current_user, get_portfolio, rate_limit
from ..services import compare as cmp
from ..services import exposure as expo
from ..services import forecasting as fx
from ..services import marketdata as md
from ..services import planner
from ..services import portfolio as pfs
from ..services import scenarios as scn
from ..services import trackrecord as tr

router = APIRouter(prefix="/api", tags=["analysis"])


def _inst(db: Session, iid: int) -> Instrument:
    i = db.get(Instrument, iid)
    if not i:
        raise HTTPException(404, "Instrument not found")
    return i


# ------------------------------------------------------------------ exposure
@router.get("/exposure")
def exposure(user: User = Depends(get_current_user), pf: Portfolio = Depends(get_portfolio),
             db: Session = Depends(get_db)) -> dict:
    return expo.compute_exposure(db, pf, user.preferences or {})


@router.get("/exposure/fund/{instrument_id}")
def fund_snapshot(instrument_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    i = _inst(db, instrument_id)
    rows = list(db.scalars(select(FundHoldingSnapshot).where(FundHoldingSnapshot.scheme_id == i.id)
                           .order_by(FundHoldingSnapshot.weight.desc())))
    return {"instrument": {"id": i.id, "name": i.name}, "rows": [
        {"name": r.underlying_name, "weight": r.weight, "sector": r.sector, "asset_type": r.asset_type,
         "mapped": r.underlying_instrument_id is not None} for r in rows],
        "disclosure_date": rows[0].disclosure_date.isoformat() if rows else None,
        "source": rows[0].source if rows else None}


@router.post("/exposure/fund-holdings/{instrument_id}")
def upload_fund_holdings(instrument_id: int, file: UploadFile = File(...), disclosure_date: dt.date = Form(...),
                         source: str = Form(..., max_length=160), user: User = Depends(get_current_user),
                         db: Session = Depends(get_db)) -> dict:
    admins = {e.strip().lower() for e in get_settings().admin_emails.split(",") if e.strip()}
    if user.email.lower() not in admins:
        raise HTTPException(403, "Only administrators can replace fund disclosures (they affect all users).")
    i = _inst(db, instrument_id)
    if i.asset_class not in ("mf", "etf"):
        raise HTTPException(400, "Look-through data applies to mutual funds and ETFs only.")
    data = file.file.read(2 * 1024 * 1024 + 1)
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(413, "File too large")
    return expo.load_disclosure_csv(db, i, data, disclosure_date, source)


# ------------------------------------------------------------------ compare & forecast
@router.get("/market/universe")
def universe(_: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Instrument).where(Instrument.in_universe.is_(True)))
    order = {"index": 0, "gold": 1, "silver": 2, "etf": 3, "equity": 4}
    out = []
    for i in sorted(rows, key=lambda i: (order.get(i.asset_class, 9), i.name)):
        out.append({"id": i.id, "symbol": i.symbol, "name": i.name, "asset_class": i.asset_class, "unit": i.unit,
                    "sector": i.sector})
    return out


@router.get("/market/compare")
def compare(ids: str = Query(..., description="comma-separated instrument ids"),
            period: str = Query("1Y", pattern="^(1M|3M|6M|1Y|3Y|5Y)$"),
            _: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    try:
        id_list = [int(x) for x in ids.split(",") if x.strip()]
    except ValueError as e:
        raise HTTPException(400, "ids must be integers") from e
    return cmp.compare(db, id_list, period)


@router.get("/market/models")
def model_cards(_: User = Depends(get_current_user)) -> dict:
    return {"models": [{"id": k, **v, "available": k != "chronos" or fx.chronos_available()}
                       for k, v in fx.MODEL_INFO.items()],
            "horizons": [{"days": k, "label": v} for k, v in fx.HORIZONS.items()],
            "code_version": fx.CODE_VERSION,
            "protocol": {"refit_every": fx.REFIT_EVERY, "test_sessions": fx.TEST_SESSIONS, "min_train": fx.MIN_TRAIN,
                         "calibration_fraction": fx.CAL_FRAC, "features": fx.FEATURE_LABELS,
                         "steps": ["Chronological splits only — no shuffling",
                                   "Walk-forward: refit every 63 sessions on all data before the test block",
                                   "Purge: training labels end before each forecast origin",
                                   "Scaler fit inside each fold (sklearn Pipeline)",
                                   "Split-conformal intervals from a purged calibration slice",
                                   "Compared with naïve no-change and historical-drift baselines",
                                   "Errors scored on non-overlapping origins (every h sessions)",
                                   "Run metadata stored: dataset hash, code version, seed, parameters"]}}


@router.get("/market/forecast")
def forecast(instrument_id: int, horizon: int = Query(21), model: str = Query("ridge"),
             _: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    i = _inst(db, instrument_id)
    f = fx.forecast(db, i, horizon, model)
    rec = tr.log_forecast(db, f, "live")
    try:
        ev = fx.evaluation(db, i, horizon)
    except ValueError as e:
        ev = {"error": str(e)}
    return {"forecast": f, "chart": fx.forecast_chart(db, i, f), "evaluation": ev,
            "logged": {"id": rec.id, "record_hash": rec.record_hash, "created_at": rec.created_at.isoformat() + "Z"}}


@router.get("/market/evaluation")
def evaluation(instrument_id: int, horizon: int = Query(21), _: User = Depends(get_current_user),
               db: Session = Depends(get_db)) -> dict:
    return fx.evaluation(db, _inst(db, instrument_id), horizon)


@router.get("/market/scenarios", dependencies=[Depends(rate_limit("scenarios", 60, 3600))])
def scenarios(instrument_id: int, engine: str = Query("vae", pattern="^(vae|bootstrap)$"),
              n: int = Query(500, ge=100, le=2000), shock: float = Query(0.0, ge=-50, le=50),
              _: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return scn.scenarios(db, _inst(db, instrument_id), engine, n, shock)


# ------------------------------------------------------------------ track record
@router.get("/track-record")
def track_record(origin: str = Query("live", pattern="^(live|backtest|all)$"), instrument_id: int | None = None,
                 model: str | None = None, horizon: int | None = None,
                 outcome: str | None = Query(None, pattern="^(hit|miss|pending)$"),
                 page: int = Query(1, ge=1), page_size: int = Query(25, ge=5, le=200),
                 _: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return tr.report(db, origin, instrument_id, model, horizon, outcome, page, page_size)


@router.get("/track-record/verify")
def verify(_: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return tr.verify_chain(db)


# ------------------------------------------------------------------ plan
@router.get("/plan/review")
def review(user: User = Depends(get_current_user), pf: Portfolio = Depends(get_portfolio),
           db: Session = Depends(get_db)) -> dict:
    val = pfs.valuation(db, pf)
    ex = expo.compute_exposure(db, pf, user.preferences or {})
    return planner.expert_review(val, ex, user.preferences or {})


class Bound(BaseModel):
    min: int = Field(0, ge=0, le=100)
    max: int = Field(100, ge=0, le=100)


class PlanIn(BaseModel):
    bounds: dict[str, Bound] = {}
    max_vol_pct: float | None = Field(default=None, gt=0, le=60)
    use_risk_cap: bool = True
    risk_level: str | None = Field(default=None, pattern="^(conservative|moderate|aggressive)$")
    step: int = 5


@router.post("/plan/allocate")
def allocate(body: PlanIn, user: User = Depends(get_current_user), pf: Portfolio = Depends(get_portfolio),
             db: Session = Depends(get_db)) -> dict:
    unknown = set(body.bounds) - set(planner.CLASSES)
    if unknown:
        raise HTTPException(400, f"Unknown asset classes: {', '.join(sorted(unknown))}")
    val = pfs.valuation(db, pf)
    cons = {"bounds": {k: v.model_dump() for k, v in body.bounds.items()}, "max_vol_pct": body.max_vol_pct,
            "use_risk_cap": body.use_risk_cap, "risk_level": body.risk_level, "step": body.step}
    return planner.plan(db, val, cons, user.preferences or {})


@router.get("/plan/classes")
def plan_classes(_: User = Depends(get_current_user)) -> dict:
    return {"classes": [{"id": c, "label": planner.CLASS_LABELS[c], "proxy": planner.PROXIES[c]} for c in planner.CLASSES],
            "risk_caps": planner.RISK_VOL_CAP}


_ = md
