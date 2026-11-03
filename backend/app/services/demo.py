"""Synthetic demo portfolio (clearly labelled) built from stored historical prices."""
from __future__ import annotations

import datetime as dt

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Instrument, Portfolio
from . import marketdata as md
from . import portfolio as pfs

STOCKS = [("RELIANCE", 25, 700), ("HDFCBANK", 130, 640), ("ICICIBANK", 40, 560), ("INFY", 30, 500),
          ("ITC", 150, 450), ("TCS", 8, 400), ("LT", 10, 380), ("BHARTIARTL", 15, 300)]
LUMPS = [("MF118955", 150000, 600), ("MF118825", 100000, 520), ("MF118989", 80000, 420), ("MF148986", 120000, 300)]
SIPS = [("MF122639", 10000, 30), ("MF120586", 5000, 24), ("MF119063", 5000, 18)]
ETFS = [("GOLDBEES", 600, 500), ("SILVERBEES", 300, 250), ("NIFTYBEES", 150, 360)]


def _price_on(db: Session, inst: Instrument, d: dt.date) -> tuple[dt.date, float] | None:
    s = md.get_series(db, inst.id, adjusted=False)
    if s.empty:
        return None
    s = s[s.index <= pd.Timestamp(d)]
    if s.empty:
        return None
    return s.index[-1].date(), float(s.iloc[-1])


def build_demo(db: Session, pf: Portfolio) -> int:
    today = md.today_ist()
    by_sym = {i.symbol: i for i in db.scalars(select(Instrument))}
    n = 0
    zerodha = pfs.get_or_create_account(db, pf, "Zerodha (demo)", "broker")
    cams = pfs.get_or_create_account(db, pf, "CAMS · mutual funds (demo)", "mf")
    locker = pfs.get_or_create_account(db, pf, "Home locker (demo)", "physical")
    bank = pfs.get_or_create_account(db, pf, "HDFC Bank FD (demo)", "bank")

    def buy(sym: str, qty: float | None, days_ago: int, account, amount: float | None = None) -> None:
        nonlocal n
        inst = by_sym.get(sym)
        if not inst:
            return
        p = _price_on(db, inst, today - dt.timedelta(days=days_ago))
        if not p:
            return
        d, px = p
        q = qty if qty is not None else round(amount / px, 3)
        pfs.add_position(db, pf, inst, q, round(px, 2), d, account, fees=0.0, source="demo")
        n += 1

    for sym, qty, ago in STOCKS:
        buy(sym, qty, ago, zerodha)
    for sym, amt, ago in LUMPS:
        buy(sym, None, ago, cams, amount=amt)
    for sym, amt, months in SIPS:
        for k in range(months, 0, -1):
            buy(sym, None, k * 30, cams, amount=amt)
    for sym, qty, ago in ETFS:
        buy(sym, qty, ago, zerodha)
    gold = by_sym.get("GOLD")
    if gold and (p := _price_on(db, gold, today - dt.timedelta(days=700))):
        d, px = p
        pfs.add_position(db, pf, gold, 20.0, round(px / 10 * 0.916 / 0.999, 2), d, locker, meta={"purity": 0.916,
                         "form": "physical"}, source="demo", notes="22K coins (demo)")
        n += 1
    fd = by_sym.get("FD")
    if fd:
        start = today - dt.timedelta(days=400)
        pfs.add_fd(db, pf, fd, 200000, 7.1, start, start + dt.timedelta(days=730), "quarterly", "HDFC Bank", bank)
        n += 1
    db.commit()
    return n
