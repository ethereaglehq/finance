from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..config import get_settings
from ..db import get_db
from ..models import Account, Holding, ImportBatch, Instrument, Portfolio, Transaction, User
from ..security import audit, get_current_user, get_portfolio, rate_limit
from ..services import exposure as expo
from ..services import imports as imp
from ..services import marketdata as md
from ..services import portfolio as pfs

router = APIRouter(prefix="/api", tags=["portfolio"])


# ------------------------------------------------------------------ portfolio
@router.get("/portfolio")
def get_portfolio_view(pf: Portfolio = Depends(get_portfolio), db: Session = Depends(get_db)) -> dict:
    return pfs.valuation(db, pf)


@router.get("/portfolio/history")
def portfolio_history(period: str = Query("1Y", pattern="^(1M|3M|6M|1Y|3Y|5Y|ALL)$"),
                      pf: Portfolio = Depends(get_portfolio), db: Session = Depends(get_db)) -> dict:
    return pfs.value_history(db, pf, period)


# ------------------------------------------------------------------ accounts
class AccountIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    account_type: str = Field(default="broker", pattern="^(broker|demat|mf|physical|bank|other)$")


@router.get("/accounts")
def list_accounts(pf: Portfolio = Depends(get_portfolio), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(Account, func.count(Holding.id)).outerjoin(Holding, Holding.account_id == Account.id)
                      .where(Account.portfolio_id == pf.id).group_by(Account.id).order_by(Account.id)).all()
    return [{"id": a.id, "label": a.label, "account_type": a.account_type, "holdings": n} for a, n in rows]


@router.post("/accounts")
def create_account(body: AccountIn, pf: Portfolio = Depends(get_portfolio), db: Session = Depends(get_db)) -> dict:
    if db.scalar(select(Account.id).where(Account.portfolio_id == pf.id, Account.label == body.label.strip())):
        raise HTTPException(409, "An account with this label already exists.")
    a = Account(portfolio_id=pf.id, label=body.label.strip(), account_type=body.account_type)
    db.add(a)
    db.commit()
    return {"id": a.id, "label": a.label, "account_type": a.account_type, "holdings": 0}


def _own_account(db: Session, pf: Portfolio, account_id: int) -> Account:
    a = db.get(Account, account_id)
    if not a or a.portfolio_id != pf.id:
        raise HTTPException(404, "Account not found")
    return a


@router.patch("/accounts/{account_id}")
def update_account(account_id: int, body: AccountIn, pf: Portfolio = Depends(get_portfolio),
                   db: Session = Depends(get_db)) -> dict:
    a = _own_account(db, pf, account_id)
    a.label, a.account_type = body.label.strip(), body.account_type
    db.commit()
    return {"id": a.id, "label": a.label, "account_type": a.account_type}


@router.delete("/accounts/{account_id}")
def delete_account(account_id: int, pf: Portfolio = Depends(get_portfolio), db: Session = Depends(get_db)) -> dict:
    a = _own_account(db, pf, account_id)
    n = db.scalar(select(func.count()).select_from(Holding).where(Holding.account_id == a.id))
    if n:
        raise HTTPException(400, f"Move or delete the {n} holding(s) in this account first.")
    db.delete(a)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ holdings
class HoldingIn(BaseModel):
    instrument_id: int
    quantity: float = Field(gt=0)
    price: float = Field(ge=0)
    trade_date: dt.date
    fees: float = Field(default=0, ge=0)
    account_id: int | None = None
    account_label: str | None = Field(default=None, max_length=120)
    purity: float | None = Field(default=None, gt=0, le=1)
    notes: str = Field(default="", max_length=500)


class FDIn(BaseModel):
    bank: str = Field(min_length=1, max_length=120)
    principal: float = Field(gt=0)
    rate: float = Field(gt=0, lt=30)
    start_date: dt.date
    maturity_date: dt.date
    compounding: str = "quarterly"
    account_id: int | None = None
    account_label: str | None = None


class TxIn(BaseModel):
    type: str = Field(pattern="^(BUY|SELL)$")
    quantity: float = Field(gt=0)
    price: float = Field(ge=0)
    trade_date: dt.date
    fees: float = Field(default=0, ge=0)


class HoldingPatch(BaseModel):
    account_id: int | None = None
    notes: str | None = Field(default=None, max_length=500)
    purity: float | None = Field(default=None, gt=0, le=1)


def _account(db: Session, pf: Portfolio, account_id: int | None, label: str | None) -> Account | None:
    if account_id:
        return _own_account(db, pf, account_id)
    return pfs.get_or_create_account(db, pf, label) if label else None


def _own_holding(db: Session, pf: Portfolio, holding_id: int) -> Holding:
    h = db.scalar(select(Holding).where(Holding.id == holding_id, Holding.portfolio_id == pf.id)
                  .options(selectinload(Holding.transactions), selectinload(Holding.instrument)))
    if not h:
        raise HTTPException(404, "Holding not found")
    return h


@router.post("/holdings")
def add_holding(body: HoldingIn, request: Request, user: User = Depends(get_current_user),
                pf: Portfolio = Depends(get_portfolio), db: Session = Depends(get_db)) -> dict:
    inst = db.get(Instrument, body.instrument_id)
    if not inst or inst.asset_class in ("index", "fd"):
        raise HTTPException(400, "Choose a stock, fund, ETF, gold or silver instrument (use the FD form for deposits).")
    meta = {}
    if inst.asset_class in ("gold", "silver") and inst.exchange == "REF":
        meta = {"purity": body.purity or 0.999, "form": "physical"}
    acc = _account(db, pf, body.account_id, body.account_label)
    h = pfs.add_position(db, pf, inst, body.quantity, body.price, body.trade_date, acc, fees=body.fees,
                         meta=meta or None, notes=body.notes)
    audit(db, user.id, "holding_add", "holding", h.id, request, instrument=inst.symbol)
    db.commit()
    return {"id": h.id}


@router.post("/holdings/fd")
def add_fd(body: FDIn, request: Request, user: User = Depends(get_current_user), pf: Portfolio = Depends(get_portfolio),
           db: Session = Depends(get_db)) -> dict:
    fd = db.scalar(select(Instrument).where(Instrument.symbol == "FD"))
    acc = _account(db, pf, body.account_id, body.account_label or body.bank)
    h = pfs.add_fd(db, pf, fd, body.principal, body.rate, body.start_date, body.maturity_date, body.compounding,
                   body.bank, acc)
    audit(db, user.id, "holding_add", "holding", h.id, request, instrument="FD")
    db.commit()
    return {"id": h.id}


@router.get("/holdings/{holding_id}")
def holding_detail(holding_id: int, pf: Portfolio = Depends(get_portfolio), db: Session = Depends(get_db)) -> dict:
    h = _own_holding(db, pf, holding_id)
    val = pfs.valuation(db, pf)
    row = next((r for r in val["holdings"] if r["id"] == h.id), None)
    inst = h.instrument
    hist = []
    if inst.asset_class != "fd":
        s = md.get_series(db, inst.id, md.today_ist() - dt.timedelta(days=366 * 3), adjusted=False)
        step = max(1, len(s) // 500)
        hist = [{"date": d.date().isoformat(), "price": round(float(v), 4)} for d, v in s.iloc[::step].items()]
    lookthrough = []
    if inst.asset_class in ("mf", "etf"):
        snaps = expo.snapshots_for(db, [inst.id]).get(inst.id, [])
        value = (row or {}).get("value") or 0
        lookthrough = sorted(({"name": s.underlying_name, "weight": s.weight, "sector": s.sector, "asset_type": s.asset_type,
                               "value": value * s.weight / 100, "disclosure_date": s.disclosure_date.isoformat(),
                               "source": s.source} for s in snaps), key=lambda x: -x["weight"])
    return {
        "holding": row,
        "transactions": [{"id": t.id, "type": t.type, "quantity": t.quantity, "price": t.price, "fees": t.fees,
                          "trade_date": t.trade_date.isoformat(), "source": t.source} for t in h.transactions],
        "price_history": hist,
        "lookthrough": lookthrough,
        "quote": md.latest_quote(db, inst) if inst.asset_class != "fd" else None,
    }


@router.patch("/holdings/{holding_id}")
def update_holding(holding_id: int, body: HoldingPatch, pf: Portfolio = Depends(get_portfolio),
                   db: Session = Depends(get_db)) -> dict:
    h = _own_holding(db, pf, holding_id)
    if body.account_id is not None:
        h.account_id = _own_account(db, pf, body.account_id).id
    if body.notes is not None:
        h.notes = body.notes
    if body.purity is not None and h.instrument.asset_class in ("gold", "silver"):
        h.meta = {**(h.meta or {}), "purity": body.purity}
    db.commit()
    return {"ok": True}


@router.delete("/holdings/{holding_id}")
def delete_holding(holding_id: int, request: Request, user: User = Depends(get_current_user),
                   pf: Portfolio = Depends(get_portfolio), db: Session = Depends(get_db)) -> dict:
    h = _own_holding(db, pf, holding_id)
    audit(db, user.id, "holding_delete", "holding", h.id, request, instrument=h.instrument.symbol)
    db.delete(h)
    db.commit()
    return {"ok": True}


@router.post("/holdings/{holding_id}/transactions")
def add_transaction(holding_id: int, body: TxIn, pf: Portfolio = Depends(get_portfolio),
                    db: Session = Depends(get_db)) -> dict:
    h = _own_holding(db, pf, holding_id)
    if h.instrument.asset_class == "fd":
        raise HTTPException(400, "Fixed deposits don't have transactions; delete and re-add to change terms.")
    if body.trade_date > md.today_ist():
        raise HTTPException(400, "Trade date cannot be in the future")
    t = Transaction(holding_id=h.id, type=body.type, quantity=body.quantity, price=body.price, fees=body.fees,
                    trade_date=body.trade_date)
    db.add(t)
    db.flush()
    db.refresh(h)
    try:
        pfs.recompute(h)
    except pfs.PortfolioError as e:
        db.rollback()
        raise HTTPException(400, str(e)) from e
    db.commit()
    return {"id": t.id}


def _own_tx(db: Session, pf: Portfolio, tx_id: int) -> Transaction:
    t = db.get(Transaction, tx_id)
    if not t or t.holding.portfolio_id != pf.id:
        raise HTTPException(404, "Transaction not found")
    return t


@router.put("/transactions/{tx_id}")
def update_transaction(tx_id: int, body: TxIn, pf: Portfolio = Depends(get_portfolio), db: Session = Depends(get_db)) -> dict:
    t = _own_tx(db, pf, tx_id)
    t.type, t.quantity, t.price, t.fees, t.trade_date = body.type, body.quantity, body.price, body.fees, body.trade_date
    db.flush()
    h = t.holding
    db.refresh(h)
    try:
        pfs.recompute(h)
    except pfs.PortfolioError as e:
        db.rollback()
        raise HTTPException(400, str(e)) from e
    db.commit()
    return {"ok": True}


@router.delete("/transactions/{tx_id}")
def delete_transaction(tx_id: int, pf: Portfolio = Depends(get_portfolio), db: Session = Depends(get_db)) -> dict:
    t = _own_tx(db, pf, tx_id)
    h = t.holding
    db.delete(t)
    db.flush()
    db.refresh(h)
    try:
        pfs.recompute(h)
    except pfs.PortfolioError as e:
        db.rollback()
        raise HTTPException(400, f"Deleting this would leave a sell without units: {e}") from e
    if not h.transactions:
        db.delete(h)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ instruments
def inst_out(db: Session, i: Instrument, quote: bool = True) -> dict:
    d = {"id": i.id, "symbol": i.symbol, "name": i.name, "asset_class": i.asset_class, "exchange": i.exchange,
         "isin": i.isin, "amfi_code": i.amfi_code, "sector": i.sector, "category": i.category, "unit": i.unit,
         "in_universe": i.in_universe}
    if quote and i.asset_class != "fd":
        d["quote"] = md.latest_quote(db, i)
    return d


@router.get("/instruments")
def list_instruments(q: str = "", asset_class: str | None = None, universe: bool = False, limit: int = Query(50, le=300),
                     _: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    stmt = select(Instrument).where(Instrument.asset_class != "fd")
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Instrument.symbol.ilike(like), Instrument.name.ilike(like), Instrument.isin == q.strip().upper()))
    if asset_class:
        stmt = stmt.where(Instrument.asset_class.in_(asset_class.split(",")))
    if universe:
        stmt = stmt.where(or_(Instrument.in_universe.is_(True), Instrument.asset_class == "mf"))
    order = {"index": 0, "gold": 1, "silver": 2, "etf": 3, "equity": 4, "mf": 5}
    rows = sorted(db.scalars(stmt.limit(500)), key=lambda i: (order.get(i.asset_class, 9), i.name))[:limit]
    return [inst_out(db, i) for i in rows]


@router.get("/instruments/search-mf")
def search_mf(q: str = Query(min_length=3), _: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    words = [w for w in q.lower().split() if w]
    rows = [r for r in md.amfi_schemes() if all(w in r["name"].lower() for w in words)][:40]
    known = {i.amfi_code: i.id for i in db.scalars(select(Instrument).where(Instrument.amfi_code.is_not(None)))}
    if not rows:
        return [{"code": i.amfi_code, "name": i.name, "isin": i.isin, "nav": None, "date": None, "instrument_id": i.id}
                for i in db.scalars(select(Instrument).where(Instrument.asset_class == "mf", Instrument.name.ilike(f"%{q}%")))]
    return [{**r, "instrument_id": known.get(r["code"])} for r in rows]


class AddMF(BaseModel):
    code: str = Field(pattern=r"^\d{3,8}$")


class AddEquity(BaseModel):
    symbol: str = Field(pattern=r"^[A-Za-z0-9&\-]{1,20}$")
    etf: bool = False


@router.post("/instruments/add-mf", dependencies=[Depends(rate_limit("addinst", 30, 3600))])
def add_mf(body: AddMF, _: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return inst_out(db, imp.resolve_key(db, f"amfi:{body.code}", "mf"))


@router.post("/instruments/add-equity", dependencies=[Depends(rate_limit("addinst", 30, 3600))])
def add_equity(body: AddEquity, _: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    existing = db.scalar(select(Instrument).where(Instrument.symbol == body.symbol.upper()))
    if existing:
        return inst_out(db, existing)
    if get_settings().market_data_mode == "synthetic":
        raise HTTPException(400, "Adding new symbols needs live market data (offline mode is on).")
    try:
        return inst_out(db, imp.resolve_key(db, f"yahoo:{body.symbol}", "etf" if body.etf else "stock"))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(404, f"Couldn't find NSE symbol {body.symbol.upper()}.") from e


@router.get("/instruments/{instrument_id}")
def get_instrument(instrument_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    i = db.get(Instrument, instrument_id)
    if not i:
        raise HTTPException(404, "Instrument not found")
    return {**inst_out(db, i), "source": md.series_source(db, i.id)}


@router.get("/instruments/{instrument_id}/history")
def instrument_history(instrument_id: int, period: str = Query("1Y", pattern="^(1M|3M|6M|1Y|3Y|5Y)$"),
                       _: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    from ..services.compare import PERIOD_DAYS

    i = db.get(Instrument, instrument_id)
    if not i:
        raise HTTPException(404, "Instrument not found")
    s = md.get_series(db, i.id, md.today_ist() - dt.timedelta(days=PERIOD_DAYS[period]), adjusted=False)
    step = max(1, len(s) // 400)
    return {"points": [{"date": d.date().isoformat(), "price": round(float(v), 4)} for d, v in s.iloc[::step].items()],
            "source": md.series_source(db, i.id)}


# ------------------------------------------------------------------ imports
def _read_upload(file: UploadFile) -> bytes:
    limit = get_settings().max_upload_mb * 1024 * 1024
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"File too large (max {get_settings().max_upload_mb} MB).")
    if not data:
        raise HTTPException(400, "The file is empty.")
    return data


def batch_out(b: ImportBatch) -> dict:
    return {"id": b.id, "kind": b.kind, "filename": b.filename, "status": b.status, "rows": b.rows,
            "summary": b.summary, "created_at": b.created_at.isoformat() + "Z"}


@router.get("/imports/template.csv", response_class=PlainTextResponse)
def csv_template() -> PlainTextResponse:
    return PlainTextResponse(imp.CSV_TEMPLATE, media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="finlex-import-template.csv"'})


@router.post("/imports/csv", dependencies=[Depends(rate_limit("import", 30, 3600))])
def import_csv(request: Request, file: UploadFile = File(...), user: User = Depends(get_current_user),
               db: Session = Depends(get_db)) -> dict:
    name = file.filename or "upload.csv"
    if not name.lower().endswith((".csv", ".txt")):
        raise HTTPException(400, "Please upload a .csv file.")
    data = _read_upload(file)
    if b"\x00" in data[:4096]:
        raise HTTPException(400, "This file doesn't look like a text CSV.")
    try:
        rows = imp.parse_csv(db, data)
    except imp.ImportError_ as e:
        raise HTTPException(400, str(e)) from e
    b = imp.create_batch(db, user.id, "csv", name, rows)
    audit(db, user.id, "import_parsed", "import", b.id, request, kind="csv", rows=len(rows))
    db.commit()
    return batch_out(b)


@router.post("/imports/cas", dependencies=[Depends(rate_limit("import", 30, 3600))])
def import_cas(request: Request, file: UploadFile = File(...), password: str = Form(""),
               user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    data = _read_upload(file)
    try:
        rows, info = imp.parse_cas(db, data, password)
    except imp.ImportError_ as e:
        raise HTTPException(400, str(e)) from e
    finally:
        del data  # statement bytes are never persisted
    b = imp.create_batch(db, user.id, "cas", file.filename or "statement.pdf", rows, info)
    audit(db, user.id, "import_parsed", "import", b.id, request, kind="cas", rows=len(rows))
    db.commit()
    return batch_out(b)


def _own_batch(db: Session, user: User, batch_id: int) -> ImportBatch:
    b = db.get(ImportBatch, batch_id)
    if not b or b.user_id != user.id:
        raise HTTPException(404, "Import not found")
    return b


@router.get("/imports")
def list_imports(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(ImportBatch).where(ImportBatch.user_id == user.id).order_by(ImportBatch.id.desc()).limit(20))
    return [{**batch_out(b), "rows": None} for b in rows]


@router.get("/imports/{batch_id}")
def get_import(batch_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    return batch_out(_own_batch(db, user, batch_id))


class ConfirmIn(BaseModel):
    decisions: dict[str, dict] = {}
    default_account: str | None = Field(default=None, max_length=120)


@router.post("/imports/{batch_id}/confirm")
def confirm_import(batch_id: int, body: ConfirmIn, request: Request, user: User = Depends(get_current_user),
                   pf: Portfolio = Depends(get_portfolio), db: Session = Depends(get_db)) -> dict:
    b = _own_batch(db, user, batch_id)
    try:
        res = imp.confirm(db, pf, b, body.decisions, body.default_account)
    except imp.ImportError_ as e:
        raise HTTPException(400, str(e)) from e
    audit(db, user.id, "import_confirmed", "import", b.id, request, **{k: v for k, v in res.items() if k != "errors"})
    db.commit()
    return res


@router.delete("/imports/{batch_id}")
def discard_import(batch_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    b = _own_batch(db, user, batch_id)
    if b.status == "pending":
        b.status, b.rows = "discarded", []
        db.commit()
    return {"ok": True}
