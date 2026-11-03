"""User-configured alerts (in-app notifications). Evaluated by the scheduler and on demand."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Alert, AlertEvent, Filing, Instrument, Portfolio, User, utcnow
from . import exposure as expo
from . import marketdata as md
from . import portfolio as pfs

RULE_TYPES = {
    "price_move": "Daily move beyond ±threshold %",
    "price_above": "Price rises above a level",
    "price_below": "Price falls below a level",
    "concentration": "Any single company exceeds threshold % (look-through)",
    "sector": "Any sector exceeds threshold % (look-through)",
    "new_filing": "New filing/results document for an instrument",
    "data_stale": "A holding's price data becomes stale or unavailable",
}
COOLDOWN = dt.timedelta(hours=20)


def validate(rule_type: str, instrument_id: int | None, threshold: float) -> None:
    if rule_type not in RULE_TYPES:
        raise ValueError(f"rule_type must be one of {', '.join(RULE_TYPES)}")
    if rule_type in ("price_move", "price_above", "price_below", "new_filing") and not instrument_id:
        raise ValueError("This alert needs an instrument")
    if rule_type in ("price_move", "concentration", "sector") and not (0 < threshold <= 100):
        raise ValueError("Threshold must be between 0 and 100%")
    if rule_type in ("price_above", "price_below") and threshold <= 0:
        raise ValueError("Price level must be positive")


def _fire(db: Session, a: Alert, msg: str, data: dict) -> AlertEvent | None:
    if a.last_triggered_at and utcnow() - a.last_triggered_at < COOLDOWN:
        return None
    a.last_triggered_at = utcnow()
    ev = AlertEvent(alert_id=a.id, user_id=a.user_id, message=msg[:500], data=data)
    db.add(ev)
    return ev


def evaluate_user(db: Session, user: User) -> list[AlertEvent]:
    alerts = list(db.scalars(select(Alert).where(Alert.user_id == user.id, Alert.enabled.is_(True))))
    if not alerts:
        return []
    pf = db.scalar(select(Portfolio).where(Portfolio.user_id == user.id).order_by(Portfolio.id))
    events: list[AlertEvent] = []
    exp_cache: dict | None = None
    for a in alerts:
        inst = db.get(Instrument, a.instrument_id) if a.instrument_id else None
        ev = None
        if a.rule_type in ("price_move", "price_above", "price_below") and inst:
            q = md.latest_quote(db, inst)
            if not q:
                continue
            if a.rule_type == "price_move" and abs(q["change_pct"]) >= a.threshold:
                ev = _fire(db, a, f"{inst.name} moved {q['change_pct']:+.2f}% (threshold ±{a.threshold:g}%). "
                                  f"Price {q['price']:,.2f} as of {q['as_of'][:16].replace('T', ' ')} UTC.",
                           {"instrument_id": inst.id, **q})
            elif a.rule_type == "price_above" and q["price"] > a.threshold:
                ev = _fire(db, a, f"{inst.name} is at {q['price']:,.2f}, above your level {a.threshold:,.2f}.",
                           {"instrument_id": inst.id, **q})
            elif a.rule_type == "price_below" and q["price"] < a.threshold:
                ev = _fire(db, a, f"{inst.name} is at {q['price']:,.2f}, below your level {a.threshold:,.2f}.",
                           {"instrument_id": inst.id, **q})
        elif a.rule_type in ("concentration", "sector") and pf:
            if exp_cache is None:
                exp_cache = expo.compute_exposure(db, pf, user.preferences or {})
            if a.rule_type == "concentration":
                over = [c for c in exp_cache["companies"] if c["pct"] >= a.threshold]
                if over:
                    ev = _fire(db, a, f"{over[0]['name']} is ~{over[0]['pct']:.1f}% of your portfolio (look-through), "
                                      f"above your {a.threshold:g}% alert.", {"company": over[0]["name"], "pct": over[0]["pct"]})
            else:
                over = [s for s in exp_cache["sectors"] if s["pct"] >= a.threshold
                        and s["sector"] not in ("Not itemised", "Unclassified")]
                if over:
                    ev = _fire(db, a, f"{over[0]['sector']} is ~{over[0]['pct']:.1f}% of your portfolio, above your "
                                      f"{a.threshold:g}% alert.", {"sector": over[0]["sector"], "pct": over[0]["pct"]})
        elif a.rule_type == "new_filing" and inst:
            since = a.last_triggered_at or a.created_at
            f = db.scalar(select(Filing).where(Filing.instrument_id == inst.id, Filing.created_at > since)
                          .order_by(Filing.created_at.desc()).limit(1))
            if f:
                a.last_triggered_at = None  # filings are discrete events; no cooldown
                ev = _fire(db, a, f"New document for {inst.name}: {f.filing_type} {f.period}.", {"filing_id": f.id})
        elif a.rule_type == "data_stale" and pf:
            val = pfs.valuation(db, pf)
            bad = [i for i in val["issues"] if i["code"] in ("stale_price", "missing_price")]
            if bad:
                ev = _fire(db, a, f"{len(bad)} holding(s) have stale or missing prices: {bad[0]['message']}",
                           {"issues": bad[:5]})
        if ev:
            events.append(ev)
    db.commit()
    return events


def evaluate_all(db: Session) -> int:
    n = 0
    uids = set(db.scalars(select(Alert.user_id).where(Alert.enabled.is_(True)).distinct()))
    for uid in uids:
        u = db.get(User, uid)
        if u:
            n += len(evaluate_user(db, u))
    return n


def alert_dict(a: Alert) -> dict:
    return {"id": a.id, "rule_type": a.rule_type, "rule_label": RULE_TYPES.get(a.rule_type, a.rule_type),
            "instrument": {"id": a.instrument.id, "symbol": a.instrument.symbol, "name": a.instrument.name}
            if a.instrument else None, "threshold": a.threshold, "enabled": a.enabled,
            "last_triggered_at": a.last_triggered_at.isoformat() + "Z" if a.last_triggered_at else None,
            "created_at": a.created_at.isoformat() + "Z"}
