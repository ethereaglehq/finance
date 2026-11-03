"""Portfolio engine: holdings from transactions, valuation, allocation, XIRR, value history."""
from __future__ import annotations

import datetime as dt
import math
from collections import defaultdict
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import Account, Holding, Instrument, Portfolio, Transaction
from . import marketdata as md

TYPE_LABELS = {
    "equity": "Stocks",
    "mf": "Mutual funds",
    "etf": "ETFs",
    "gold": "Gold",
    "silver": "Silver",
    "fd": "Fixed deposits",
    "index": "Index",
    "cash": "Cash",
}
COMPOUNDING = {"monthly": 12, "quarterly": 4, "half-yearly": 2, "annual": 1, "simple": 0}


class PortfolioError(ValueError):
    pass


# ------------------------------------------------------------------ math helpers
def xirr(cashflows: list[tuple[dt.date, float]]) -> float | None:
    """Annualised money-weighted return. Returns None when undefined (no sign change / too short)."""
    cfs = [(d, a) for d, a in cashflows if abs(a) > 1e-9]
    if len(cfs) < 2 or not (any(a < 0 for _, a in cfs) and any(a > 0 for _, a in cfs)):
        return None
    cfs.sort(key=lambda x: x[0])
    t0 = cfs[0][0]
    years = np.array([(d - t0).days / 365.0 for d, _ in cfs])
    amts = np.array([a for _, a in cfs])
    if years[-1] < 1 / 365:
        return None

    def npv(r: float) -> float:
        return float(np.sum(amts / (1 + r) ** years))

    def dnpv(r: float) -> float:
        return float(np.sum(-years * amts / (1 + r) ** (years + 1)))

    r = 0.1
    for _ in range(100):
        f, df = npv(r), dnpv(r)
        if df == 0 or not math.isfinite(f):
            break
        nr = r - f / df
        if nr <= -0.9999 or not math.isfinite(nr):
            break
        if abs(nr - r) < 1e-10:
            return nr
        r = nr
    lo, hi = -0.9999, 100.0  # bisection fallback
    flo, fhi = npv(lo), npv(hi)
    if flo * fhi > 0:
        return None
    for _ in range(300):
        mid = (lo + hi) / 2
        fm = npv(mid)
        if abs(fm) < 1e-7:
            return mid
        if flo * fm < 0:
            hi, fhi = mid, fm
        else:
            lo, flo = mid, fm
    return (lo + hi) / 2


def fd_value(meta: dict, on: dt.date) -> float:
    principal = float(meta["principal"])
    rate = float(meta["rate"]) / 100.0
    start = dt.date.fromisoformat(meta["start_date"])
    maturity = dt.date.fromisoformat(meta["maturity_date"])
    end = min(max(on, start), maturity)
    t = (end - start).days / 365.0
    n = COMPOUNDING.get(meta.get("compounding", "quarterly"), 4)
    if n == 0:
        return principal * (1 + rate * t)
    return principal * (1 + rate / n) ** (n * t)


@dataclass
class HoldingState:
    quantity: float
    cost_basis: float  # remaining invested amount
    realised: float
    first_date: dt.date | None


def replay(transactions: list[Transaction], upto: dt.date | None = None) -> HoldingState:
    qty = cost = realised = 0.0
    first = None
    for t in sorted(transactions, key=lambda x: (x.trade_date, x.id or 0)):
        if upto and t.trade_date > upto:
            break
        if t.type == "BUY":
            qty += t.quantity
            cost += t.quantity * t.price + t.fees
            first = first or t.trade_date
        elif t.type == "SELL":
            if t.quantity > qty + 1e-9:
                raise PortfolioError(f"Sell of {t.quantity:g} on {t.trade_date} exceeds units held ({qty:g})")
            avg = cost / qty if qty else 0.0
            realised += t.quantity * (t.price - avg) - t.fees
            cost -= avg * t.quantity
            qty -= t.quantity
            if qty < 1e-9:
                qty, cost = 0.0, 0.0
    return HoldingState(qty, cost, realised, first)


def recompute(h: Holding) -> None:
    st = replay(h.transactions)
    h.quantity = st.quantity
    h.avg_cost = st.cost_basis / st.quantity if st.quantity else 0.0
    h.realised_pnl = st.realised


# ------------------------------------------------------------------ pricing
def _metal_quote(db: Session, symbol: str) -> tuple[dict | None, float]:
    inst = db.scalar(select(Instrument).where(Instrument.symbol == symbol))
    if not inst:
        return None, 1.0
    q = md.latest_quote(db, inst)
    divisor = 10.0 if symbol == "GOLD" else 1000.0
    return q, divisor


def price_holding(db: Session, h: Holding) -> dict:
    inst = h.instrument
    meta = h.meta or {}
    if inst.asset_class == "fd":
        today = md.today_ist()
        prev = fd_value(meta, today - dt.timedelta(days=1))
        val = fd_value(meta, today)
        return {"price": val, "prev": prev, "as_of": dt.datetime.combine(today, dt.time()).isoformat() + "Z",
                "source": "Computed from deposit terms", "delay_note": "Accrued value (estimate, pre-tax)",
                "synthetic": False, "stale": False, "estimated": True, "unit_value": True}
    if inst.asset_class in ("gold", "silver") and inst.exchange == "REF":
        q, divisor = _metal_quote(db, inst.symbol)
        if q is None:
            return {"price": None}
        purity = float(meta.get("purity", 0.999 if inst.asset_class == "gold" else 0.999))
        per_g = q["price"] / divisor * (purity / 0.999 if inst.asset_class == "gold" else purity / 0.999)
        prev_g = q["prev_close"] / divisor * (purity / 0.999)
        return {"price": per_g, "prev": prev_g, "as_of": q["as_of"], "source": q["source"],
                "delay_note": q["delay_note"] + "; per-gram estimate", "synthetic": q["synthetic"],
                "stale": q["stale"], "estimated": True}
    q = md.latest_quote(db, inst)
    if q is None:
        return {"price": None}
    return {"price": q["price"], "prev": q["prev_close"], "as_of": q["as_of"], "source": q["source"],
            "delay_note": q["delay_note"], "synthetic": q["synthetic"], "stale": q["stale"], "estimated": False}


def load_holdings(db: Session, pf: Portfolio) -> list[Holding]:
    return list(db.scalars(
        select(Holding).where(Holding.portfolio_id == pf.id)
        .options(selectinload(Holding.transactions), selectinload(Holding.instrument), selectinload(Holding.account))
        .order_by(Holding.id)
    ))


def _inst_dict(i: Instrument) -> dict:
    return {"id": i.id, "symbol": i.symbol, "name": i.name, "asset_class": i.asset_class,
            "sector": i.sector, "category": i.category, "exchange": i.exchange, "isin": i.isin,
            "amfi_code": i.amfi_code, "unit": i.unit}


def holding_cashflows(h: Holding, value: float | None, today: dt.date) -> list[tuple[dt.date, float]]:
    cfs = []
    for t in h.transactions:
        amt = t.quantity * t.price
        cfs.append((t.trade_date, -(amt + t.fees) if t.type == "BUY" else amt - t.fees))
    if value:
        cfs.append((today, value))
    return cfs


def valuation(db: Session, pf: Portfolio) -> dict:
    today = md.today_ist()
    holdings = load_holdings(db, pf)
    rows = []
    issues: list[dict] = []
    all_cfs: list[tuple[dt.date, float]] = []
    for h in holdings:
        inst = h.instrument
        if h.quantity <= 1e-9 and not h.transactions:
            continue
        p = price_holding(db, h)
        price = p.get("price")
        invested = h.quantity * h.avg_cost
        if inst.asset_class == "fd":
            value = price
            day_change = (p["price"] - p["prev"]) if h.quantity else 0.0
        else:
            value = price * h.quantity if price is not None else None
            day_change = (price - p["prev"]) * h.quantity if price is not None else None
        cfs = holding_cashflows(h, value if h.quantity > 0 else None, today)
        all_cfs.extend(cfs)
        hx = xirr(cfs)
        row = {
            "id": h.id,
            "instrument": _inst_dict(inst),
            "type_label": TYPE_LABELS.get(inst.asset_class, inst.asset_class),
            "account": {"id": h.account.id, "label": h.account.label} if h.account else None,
            "quantity": h.quantity,
            "avg_cost": h.avg_cost,
            "invested": invested,
            "price": price,
            "value": value,
            "pnl": (value - invested) if value is not None else None,
            "pnl_pct": ((value - invested) / invested * 100) if value is not None and invested else None,
            "realised_pnl": h.realised_pnl,
            "day_change": day_change,
            "day_change_pct": ((price - p["prev"]) / p["prev"] * 100) if price and p.get("prev") else None,
            "xirr": hx * 100 if hx is not None else None,
            "as_of": p.get("as_of"),
            "source": p.get("source"),
            "delay_note": p.get("delay_note"),
            "synthetic": p.get("synthetic", False),
            "stale": p.get("stale", False),
            "estimated": p.get("estimated", False),
            "meta": h.meta or {},
            "notes": h.notes,
            "source_kind": h.source,
            "first_date": h.transactions[0].trade_date.isoformat() if h.transactions else None,
            "closed": h.quantity <= 1e-9,
        }
        rows.append(row)
        if price is None:
            issues.append({"level": "error", "holding_id": h.id, "code": "missing_price",
                           "message": f"No price available for {inst.name}; excluded from totals."})
        elif p.get("stale"):
            issues.append({"level": "warning", "holding_id": h.id, "code": "stale_price",
                           "message": f"{inst.name}: latest price is older than 4 days ({p.get('as_of', '')[:10]})."})
        if p.get("synthetic"):
            issues.append({"level": "warning", "holding_id": h.id, "code": "synthetic_price",
                           "message": f"{inst.name}: live data unavailable — valued with a synthetic demo series."})
        if p.get("estimated") and inst.asset_class in ("gold", "silver"):
            issues.append({"level": "info", "holding_id": h.id, "code": "estimated_value",
                           "message": f"{inst.name}: physical metal valued at the international reference rate "
                                      "(excludes import duty, GST and making charges)."})
    open_rows = [r for r in rows if not r["closed"]]
    total_value = sum(r["value"] for r in open_rows if r["value"] is not None)
    total_invested = sum(r["invested"] for r in open_rows if r["value"] is not None)
    for r in rows:
        r["weight"] = (r["value"] / total_value * 100) if r["value"] and total_value else 0.0
    day_change = sum(r["day_change"] for r in open_rows if r["day_change"] is not None)
    px = xirr(all_cfs)

    def alloc(key) -> list[dict]:
        agg: dict[str, float] = defaultdict(float)
        for r in open_rows:
            if r["value"]:
                agg[key(r) or "Unclassified"] += r["value"]
        return sorted(({"label": k, "value": v, "pct": v / total_value * 100 if total_value else 0}
                       for k, v in agg.items()), key=lambda x: -x["value"])

    by_type = alloc(lambda r: r["type_label"])
    by_account = alloc(lambda r: r["account"]["label"] if r["account"] else "Unassigned")
    by_sector = alloc(lambda r: r["instrument"]["sector"] if r["instrument"]["asset_class"] == "equity" else None)
    by_sector = [x for x in by_sector if x["label"] != "Unclassified"]
    as_ofs = [r["as_of"] for r in open_rows if r.get("as_of")]
    return {
        "portfolio": {"id": pf.id, "name": pf.name, "base_currency": pf.base_currency},
        "totals": {
            "value": total_value,
            "invested": total_invested,
            "pnl": total_value - total_invested,
            "pnl_pct": ((total_value - total_invested) / total_invested * 100) if total_invested else 0.0,
            "realised_pnl": sum(r["realised_pnl"] for r in rows),
            "day_change": day_change,
            "day_change_pct": (day_change / (total_value - day_change) * 100) if total_value - day_change else 0.0,
            "xirr": px * 100 if px is not None else None,
            "holdings": len(open_rows),
            "valued_at": max(as_ofs) if as_ofs else None,
        },
        "holdings": rows,
        "allocation": {"by_type": by_type, "by_account": by_account, "by_sector": by_sector},
        "issues": issues,
        "accounts": [{"id": a.id, "label": a.label, "account_type": a.account_type}
                     for a in db.scalars(select(Account).where(Account.portfolio_id == pf.id).order_by(Account.id))],
    }


# ------------------------------------------------------------------ history
PERIODS = {"1M": 31, "3M": 92, "6M": 183, "1Y": 366, "3Y": 366 * 3, "5Y": 366 * 5}


def value_history(db: Session, pf: Portfolio, period: str = "1Y") -> dict:
    holdings = [h for h in load_holdings(db, pf) if h.transactions]
    today = md.today_ist()
    if not holdings:
        return {"points": [], "twr": None, "period": period}
    first = min(h.transactions[0].trade_date for h in holdings)
    start = max(first, today - dt.timedelta(days=PERIODS.get(period, 366))) if period != "ALL" else first
    dates = pd.bdate_range(start, today)
    if len(dates) == 0:
        dates = pd.DatetimeIndex([pd.Timestamp(today)])
    value = pd.Series(0.0, index=dates)
    invested = pd.Series(0.0, index=dates)
    flows = pd.Series(0.0, index=dates)
    metal_cache: dict[str, pd.Series] = {}
    for h in holdings:
        inst = h.instrument
        # units held & cost basis at each date
        txs = sorted(h.transactions, key=lambda t: (t.trade_date, t.id or 0))
        qty_s = pd.Series(0.0, index=dates)
        cost_s = pd.Series(0.0, index=dates)
        for d in dates:
            st = replay(txs, d.date())
            qty_s[d], cost_s[d] = st.quantity, st.cost_basis
        for t in txs:
            if t.trade_date >= start:
                d = dates[dates.searchsorted(pd.Timestamp(t.trade_date))] if pd.Timestamp(t.trade_date) <= dates[-1] else None
                if d is not None:
                    amt = t.quantity * t.price + (t.fees if t.type == "BUY" else -t.fees)
                    flows[d] += amt if t.type == "BUY" else -amt
        if inst.asset_class == "fd":
            vals = pd.Series([fd_value(h.meta, d.date()) if qty_s[d] > 0 else 0.0 for d in dates], index=dates)
            value += vals
        else:
            if inst.asset_class in ("gold", "silver") and inst.exchange == "REF":
                if inst.symbol not in metal_cache:
                    metal_cache[inst.symbol] = md.get_series(db, inst.id, adjusted=False)
                divisor = 10.0 if inst.symbol == "GOLD" else 1000.0
                purity = float((h.meta or {}).get("purity", 0.999))
                px = metal_cache[inst.symbol] / divisor * (purity / 0.999)
            else:
                px = md.get_series(db, inst.id, start - dt.timedelta(days=10), adjusted=False)
            if px.empty:
                continue
            px = px.reindex(px.index.union(dates)).ffill().reindex(dates).bfill()
            value += qty_s * px
        invested += cost_s
    # time-weighted return chain-linking, removing external flows
    prev = value.shift(1)
    daily = ((value - flows) / prev - 1).replace([np.inf, -np.inf], np.nan)
    daily = daily.where(prev > 0).fillna(0.0)
    twr = float(np.prod(1 + daily.values) - 1) * 100
    pts = [{"date": d.date().isoformat(), "value": round(float(v), 2), "invested": round(float(i), 2)}
           for d, v, i in zip(dates, value.values, invested.values, strict=True)]
    return {"points": pts, "twr": twr, "period": period, "start": start.isoformat(),
            "method": "Time-weighted return (chain-linked daily, external cash flows removed)"}


# ------------------------------------------------------------------ mutations
def get_or_create_account(db: Session, pf: Portfolio, label: str | None, account_type: str = "broker") -> Account | None:
    if not label:
        return None
    label = label.strip()[:120]
    acc = db.scalar(select(Account).where(Account.portfolio_id == pf.id, Account.label == label))
    if acc is None:
        acc = Account(portfolio_id=pf.id, label=label, account_type=account_type)
        db.add(acc)
        db.flush()
    return acc


def add_position(db: Session, pf: Portfolio, inst: Instrument, quantity: float, price: float,
                 trade_date: dt.date, account: Account | None, fees: float = 0.0, meta: dict | None = None,
                 source: str = "manual", notes: str = "") -> Holding:
    if quantity <= 0:
        raise PortfolioError("Quantity must be positive")
    if price < 0:
        raise PortfolioError("Price cannot be negative")
    if trade_date > md.today_ist():
        raise PortfolioError("Trade date cannot be in the future")
    h = None
    if inst.asset_class != "fd":
        h = db.scalar(select(Holding).where(
            Holding.portfolio_id == pf.id, Holding.instrument_id == inst.id,
            Holding.account_id == (account.id if account else None)))
    if h is None:
        h = Holding(portfolio_id=pf.id, instrument_id=inst.id, account_id=account.id if account else None,
                    meta=meta or {}, source=source, notes=notes)
        db.add(h)
        db.flush()
    elif meta:
        h.meta = {**(h.meta or {}), **meta}
    db.add(Transaction(holding_id=h.id, type="BUY", quantity=quantity, price=price, fees=fees,
                       trade_date=trade_date, source=source))
    db.flush()
    db.refresh(h)
    recompute(h)
    return h


def add_fd(db: Session, pf: Portfolio, fd_inst: Instrument, principal: float, rate: float, start: dt.date,
           maturity: dt.date, compounding: str, bank: str, account: Account | None) -> Holding:
    if principal <= 0:
        raise PortfolioError("Principal must be positive")
    if not 0 < rate < 30:
        raise PortfolioError("Interest rate must be between 0 and 30% p.a.")
    if maturity <= start:
        raise PortfolioError("Maturity date must be after the start date")
    if compounding not in COMPOUNDING:
        raise PortfolioError(f"Compounding must be one of {', '.join(COMPOUNDING)}")
    meta = {"principal": principal, "rate": rate, "start_date": start.isoformat(),
            "maturity_date": maturity.isoformat(), "compounding": compounding, "bank": bank}
    return add_position(db, pf, fd_inst, 1.0, principal, start, account, meta=meta, notes=bank)
