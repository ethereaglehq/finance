"""Forecast Track Record: immutable, hash-chained forecast log + automatic outcome scoring.

* Every forecast FinLex shows is logged (deduplicated per instrument/model/horizon/cutoff date).
* Records are append-only (ORM guards + no update/delete API) and SHA-256 hash-chained, so any edit
  to a past record is detectable via ``verify_chain``.
* When the horizon passes, the realised return is computed from split/dividend-adjusted closes at
  the cutoff and target dates, and stored as a separate append-only outcome.
* "backtest" records are point-in-time walk-forward replays, clearly separated from "live" records.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import threading
from collections import defaultdict

import numpy as np
import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..models import ForecastLog, ForecastOutcome, Instrument, utcnow
from . import forecasting as fx
from . import marketdata as md

GENESIS = "0" * 64
_chain_lock = threading.Lock()
EVAL_PROTOCOL = "walk-forward, refit/63 sessions, purged split-conformal calibration"
CORE_UNIVERSE = ["NIFTY50", "GOLD", "SILVER", "BANKNIFTY"]
CORE_HORIZONS = [5, 21]
CORE_MODELS = ["ridge", "xgboost"]


def _content(r: ForecastLog) -> str:
    return json.dumps({
        "origin": r.origin, "instrument_id": r.instrument_id, "model": r.model, "model_version": r.model_version,
        "horizon_days": r.horizon_days, "cutoff_date": r.cutoff_date.isoformat(),
        "target_date": r.target_date.isoformat(), "base_price": round(r.base_price, 6),
        "point_return": round(r.point_return, 6), "lower80": round(r.lower80, 6), "upper80": round(r.upper80, 6),
        "lower50": round(r.lower50, 6), "upper50": round(r.upper50, 6), "interval_method": r.interval_method,
        "eval_protocol": r.eval_protocol, "data_version": r.data_version,
        "created_at": r.created_at.replace(microsecond=0).isoformat(),
    }, sort_keys=True)


def _hash(prev: str, r: ForecastLog) -> str:
    return hashlib.sha256((prev + _content(r)).encode()).hexdigest()


def _append(db: Session, recs: list[ForecastLog]) -> None:
    with _chain_lock:
        prev = db.scalar(select(ForecastLog.record_hash).order_by(ForecastLog.id.desc()).limit(1)) or GENESIS
        for r in recs:
            r.created_at = (r.created_at or utcnow()).replace(microsecond=0)
            r.prev_hash = prev
            r.record_hash = _hash(prev, r)
            prev = r.record_hash
            db.add(r)
            db.flush()
        db.commit()


def log_forecast(db: Session, fc: dict, origin: str = "live") -> ForecastLog:
    iid = fc["instrument"]["id"]
    cutoff = dt.date.fromisoformat(fc["cutoff_date"])
    existing = db.scalar(select(ForecastLog).where(
        ForecastLog.instrument_id == iid, ForecastLog.model == fc["model"], ForecastLog.origin == origin,
        ForecastLog.horizon_days == fc["horizon_days"], ForecastLog.cutoff_date == cutoff))
    if existing:
        return existing
    rec = ForecastLog(
        origin=origin, instrument_id=iid, model=fc["model"], model_version=fc["model_version"],
        horizon_days=fc["horizon_days"], cutoff_date=cutoff, target_date=dt.date.fromisoformat(fc["target_date"]),
        base_price=fc["base_price"], point_return=fc["point_return"], lower80=fc["interval80"][0],
        upper80=fc["interval80"][1], lower50=fc["interval50"][0], upper50=fc["interval50"][1],
        interval_method=fc["interval_method"], eval_protocol=EVAL_PROTOCOL,
        data_version=f"{fc['dataset_hash']}/{fc['code_version']}")
    _append(db, [rec])
    return rec


def verify_chain(db: Session) -> dict:
    prev = GENESIS
    n = 0
    q = select(ForecastLog).order_by(ForecastLog.id).execution_options(populate_existing=True)
    for r in db.scalars(q).yield_per(500):
        if r.prev_hash != prev or _hash(prev, r) != r.record_hash:
            return {"ok": False, "checked": n, "broken_at": r.id}
        prev = r.record_hash
        n += 1
    return {"ok": True, "checked": n, "head": prev}


# ------------------------------------------------------------------ scoring
def score_matured(db: Session) -> int:
    pending = list(db.scalars(
        select(ForecastLog).outerjoin(ForecastOutcome).where(ForecastOutcome.id.is_(None),
                                                             ForecastLog.target_date <= md.today_ist())))
    if not pending:
        return 0
    by_inst: dict[int, pd.Series] = {}
    n = 0
    for r in pending:
        s = by_inst.get(r.instrument_id)
        if s is None:
            s = by_inst[r.instrument_id] = md.get_series(db, r.instrument_id)
        if s.empty:
            continue
        after = s.loc[s.index >= pd.Timestamp(r.target_date)]
        before = s.loc[s.index <= pd.Timestamp(r.cutoff_date)]
        if after.empty or before.empty:
            continue  # target not yet observed
        obs_date, obs = after.index[0], float(after.iloc[0])
        base = float(before.iloc[-1])
        realised = math.log(obs / base) * 100
        direction = None if abs(r.point_return) < 1e-12 else bool(np.sign(r.point_return) == np.sign(realised))
        note = ""
        if (obs_date.date() - r.target_date).days > 4:
            note = f"Observed {(obs_date.date() - r.target_date).days} days after target (market holiday/gap)."
        db.add(ForecastOutcome(
            forecast_id=r.id, observed_date=obs_date.date(), observed_price=obs, realised_return=realised,
            error=realised - r.point_return, inside80=bool(r.lower80 <= realised <= r.upper80),
            inside50=bool(r.lower50 <= realised <= r.upper50), direction_hit=direction,
            naive_abs_error=abs(realised), note=note))
        n += 1
    db.commit()
    return n


# ------------------------------------------------------------------ backtest replay
def generate_backtest(db: Session, inst: Instrument, h: int, models: list[str] | None = None) -> int:
    models = models or CORE_MODELS
    have = db.scalar(select(func.count()).select_from(ForecastLog).where(
        ForecastLog.instrument_id == inst.id, ForecastLog.horizon_days == h, ForecastLog.origin == "backtest"))
    if have:
        return 0
    prices = md.get_series(db, inst.id)
    wf = fx.walk_forward(prices, h, ["naive"] + models)
    dates, test_start, sel = wf["_dates"], wf["_test_start"], wf["_sel"]
    dh = md.dataset_hash(prices)
    recs = []
    now = utcnow()
    for m in models:
        p = wf["_preds"][m]
        for pos in sel:
            i = p["idx"][pos]
            cutoff = dates[i].date()
            recs.append(ForecastLog(
                origin="backtest", instrument_id=inst.id, model=m, model_version=fx.MODEL_INFO[m]["version"],
                horizon_days=h, cutoff_date=cutoff, target_date=(pd.Timestamp(cutoff) + pd.offsets.BDay(h)).date(),
                base_price=float(prices.loc[dates[i]]), point_return=p["point"][pos], lower80=p["lo80"][pos],
                upper80=p["hi80"][pos], lower50=p["lo50"][pos], upper50=p["hi50"][pos],
                interval_method="Split-conformal (signed residual quantiles, purged calibration slice)",
                eval_protocol=EVAL_PROTOCOL + " (point-in-time replay)", data_version=f"{dh}/{fx.CODE_VERSION}",
                created_at=now))
    recs.sort(key=lambda r: (r.cutoff_date, r.model))
    _append(db, recs)
    _ = test_start
    return len(recs)


def issue_core_forecasts(db: Session) -> int:
    n = 0
    for sym in CORE_UNIVERSE:
        inst = db.scalar(select(Instrument).where(Instrument.symbol == sym))
        if not inst:
            continue
        for h in CORE_HORIZONS:
            for m in CORE_MODELS:
                try:
                    fc = fx.forecast(db, inst, h, m)
                except ValueError:
                    continue
                before = db.scalar(select(func.count()).select_from(ForecastLog))
                log_forecast(db, fc, "live")
                n += db.scalar(select(func.count()).select_from(ForecastLog)) - before
    return n


def ensure_backtests(db: Session) -> int:
    n = 0
    for sym in CORE_UNIVERSE:
        inst = db.scalar(select(Instrument).where(Instrument.symbol == sym))
        if not inst:
            continue
        for h in CORE_HORIZONS:
            try:
                n += generate_backtest(db, inst, h)
            except ValueError:
                continue
    score_matured(db)
    return n


# ------------------------------------------------------------------ reporting
def _agg(rows: list[tuple[ForecastLog, ForecastOutcome]]) -> dict:
    if not rows:
        return {"n": 0}
    err = np.array([o.error for _, o in rows])
    naive = np.array([o.naive_abs_error for _, o in rows])
    dirs = [o.direction_hit for _, o in rows if o.direction_hit is not None]
    mae = float(np.mean(np.abs(err)))
    nmae = float(np.mean(naive))
    return {
        "n": len(rows),
        "coverage80": float(np.mean([o.inside80 for _, o in rows])),
        "coverage50": float(np.mean([o.inside50 for _, o in rows])),
        "mae": mae,
        "rmse": float(np.sqrt(np.mean(err**2))),
        "naive_mae": nmae,
        "skill_vs_naive": float(1 - mae / nmae) if nmae else None,
        "directional_accuracy": float(np.mean(dirs)) if len(dirs) >= 5 else None,
        "n_direction": len(dirs),
        "mean_width80": float(np.mean([f.upper80 - f.lower80 for f, _ in rows])),
    }


def report(db: Session, origin: str = "live", instrument_id: int | None = None, model: str | None = None,
           horizon: int | None = None, outcome: str | None = None, page: int = 1, page_size: int = 50) -> dict:
    q = select(ForecastLog).options(selectinload(ForecastLog.outcome), selectinload(ForecastLog.instrument))
    if origin != "all":
        q = q.where(ForecastLog.origin == origin)
    if instrument_id:
        q = q.where(ForecastLog.instrument_id == instrument_id)
    if model:
        q = q.where(ForecastLog.model == model)
    if horizon:
        q = q.where(ForecastLog.horizon_days == horizon)
    recs = list(db.scalars(q.order_by(ForecastLog.cutoff_date.desc(), ForecastLog.id.desc())))
    scored = [(r, r.outcome) for r in recs if r.outcome is not None]
    pending = [r for r in recs if r.outcome is None]
    seg: dict[str, dict[str, list]] = {"instrument": defaultdict(list), "model": defaultdict(list),
                                       "horizon": defaultdict(list)}
    for r, o in scored:
        seg["instrument"][r.instrument.name].append((r, o))
        seg["model"][fx.MODEL_INFO.get(r.model, {}).get("name", r.model)].append((r, o))
        seg["horizon"][fx.HORIZONS.get(r.horizon_days, str(r.horizon_days))].append((r, o))
    segments = {k: [{"label": lbl, **_agg(rows)} for lbl, rows in v.items()] for k, v in seg.items()}
    filt = recs
    if outcome == "hit":
        filt = [r for r in recs if r.outcome and r.outcome.inside80]
    elif outcome == "miss":
        filt = [r for r in recs if r.outcome and not r.outcome.inside80]
    elif outcome == "pending":
        filt = pending
    total = len(filt)
    page_rows = filt[(page - 1) * page_size: page * page_size]
    # monthly rolling coverage for the chart
    by_month: dict[str, list] = defaultdict(list)
    for r, o in scored:
        by_month[r.target_date.strftime("%Y-%m")].append(o.inside80)
    coverage_ts = [{"month": m, "coverage80": float(np.mean(v)), "n": len(v)} for m, v in sorted(by_month.items())]
    return {
        "origin": origin,
        "summary": {**_agg(scored), "pending": len(pending), "total": len(recs)},
        "calibration": [
            {"nominal": 0.5, "observed": _agg(scored).get("coverage50")},
            {"nominal": 0.8, "observed": _agg(scored).get("coverage80")},
        ] if scored else [],
        "coverage_over_time": coverage_ts,
        "segments": segments,
        "records": [_rec(r) for r in page_rows],
        "page": page, "page_size": page_size, "total": total,
        "chain": verify_chain(db),
        "notes": [
            "Records are append-only and hash-chained; none can be edited or deleted from the app.",
            "Hit = realised return inside the 80% interval. Directional accuracy counts only non-zero forecasts.",
            "Backtest records are point-in-time walk-forward replays, not forecasts published at the time.",
        ],
    }


def _rec(r: ForecastLog) -> dict:
    o = r.outcome
    return {
        "id": r.id, "origin": r.origin, "created_at": r.created_at.isoformat() + "Z",
        "instrument": {"id": r.instrument.id, "symbol": r.instrument.symbol, "name": r.instrument.name},
        "model": r.model, "model_name": fx.MODEL_INFO.get(r.model, {}).get("name", r.model),
        "model_version": r.model_version, "horizon_days": r.horizon_days, "cutoff_date": r.cutoff_date.isoformat(),
        "target_date": r.target_date.isoformat(), "base_price": r.base_price, "point_return": r.point_return,
        "interval80": [r.lower80, r.upper80], "interval50": [r.lower50, r.upper50],
        "data_version": r.data_version, "record_hash": r.record_hash,
        "outcome": None if o is None else {
            "observed_date": o.observed_date.isoformat(), "observed_price": o.observed_price,
            "realised_return": o.realised_return, "error": o.error, "inside80": o.inside80, "inside50": o.inside50,
            "direction_hit": o.direction_hit, "note": o.note,
        },
    }
