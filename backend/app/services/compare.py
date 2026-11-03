"""Compare: INR-denominated normalised performance and risk metrics across instruments."""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Instrument
from . import marketdata as md

PERIOD_DAYS = {"1M": 31, "3M": 92, "6M": 183, "1Y": 366, "3Y": 366 * 3, "5Y": 366 * 5}


def max_drawdown(prices: pd.Series) -> tuple[float, str | None, str | None]:
    if prices.empty:
        return 0.0, None, None
    peak = prices.cummax()
    dd = prices / peak - 1
    trough = dd.idxmin()
    peak_date = prices.loc[:trough].idxmax()
    return float(dd.min() * 100), peak_date.date().isoformat(), trough.date().isoformat()


def metrics(prices: pd.Series) -> dict:
    if len(prices) < 2:
        return {}
    rets = np.log(prices).diff().dropna()
    years = (prices.index[-1] - prices.index[0]).days / 365.25
    total = prices.iloc[-1] / prices.iloc[0] - 1
    mdd, peak, trough = max_drawdown(prices)
    ann_vol = float(rets.std(ddof=1) * np.sqrt(252)) * 100 if len(rets) > 2 else None
    return {
        "start": prices.index[0].date().isoformat(),
        "end": prices.index[-1].date().isoformat(),
        "start_price": float(prices.iloc[0]),
        "end_price": float(prices.iloc[-1]),
        "abs_change": float(prices.iloc[-1] - prices.iloc[0]),
        "total_return_pct": float(total * 100),
        "cagr_pct": float(((1 + total) ** (1 / years) - 1) * 100) if years >= 1 else None,
        "ann_vol_pct": ann_vol,
        "max_drawdown_pct": mdd,
        "drawdown_peak": peak,
        "drawdown_trough": trough,
        "best_day_pct": float((np.exp(rets.max()) - 1) * 100) if len(rets) else None,
        "worst_day_pct": float((np.exp(rets.min()) - 1) * 100) if len(rets) else None,
        "n_obs": int(len(prices)),
    }


def compare(db: Session, instrument_ids: list[int], period: str = "1Y") -> dict:
    if not instrument_ids:
        raise ValueError("Select at least one instrument")
    if len(instrument_ids) > 6:
        raise ValueError("Compare up to 6 instruments at a time")
    insts = {i.id: i for i in db.scalars(select(Instrument).where(Instrument.id.in_(instrument_ids)))}
    missing = [i for i in instrument_ids if i not in insts]
    if missing:
        raise ValueError(f"Unknown instrument id(s): {missing}")
    start = md.today_ist() - dt.timedelta(days=PERIOD_DAYS.get(period, 366))
    raw: dict[int, pd.Series] = {}
    warnings: list[str] = []
    for iid in instrument_ids:
        s = md.get_series(db, iid, start - dt.timedelta(days=7))
        if s.empty:
            warnings.append(f"No price history for {insts[iid].name}.")
            continue
        raw[iid] = s
    if not raw:
        raise ValueError("No price history available for the selection")
    # align on the union of dates; forward-fill gaps (e.g. COMEX-derived metals trade on a different calendar)
    union = sorted(set().union(*[set(s.index) for s in raw.values()]))
    union = [d for d in union if d >= pd.Timestamp(start)]
    frame = pd.DataFrame({iid: s.reindex(sorted(set(s.index) | set(union))).ffill().reindex(union)
                          for iid, s in raw.items()})
    filled = {iid: int(frame[iid].notna().sum() - raw[iid].reindex(union).notna().sum()) for iid in raw}
    frame = frame.dropna()
    if frame.empty:
        raise ValueError("Selected instruments have no overlapping dates in this period")
    for iid, n in filled.items():
        if n > 5:
            warnings.append(f"{insts[iid].name}: {n} non-trading dates forward-filled to align calendars.")
    norm = frame / frame.iloc[0] * 100
    rets = np.log(frame).diff().dropna()
    corr = rets.corr().round(3) if len(rets) > 5 else None
    series = []
    for iid in frame.columns:
        inst = insts[iid]
        src = md.series_source(db, iid)
        series.append({
            "instrument": {"id": inst.id, "symbol": inst.symbol, "name": inst.name, "asset_class": inst.asset_class,
                           "unit": inst.unit},
            "metrics": metrics(frame[iid]),
            "source": src,
            "synthetic": src == md.SOURCE_LABELS["synthetic"],
            "quote": md.latest_quote(db, inst),
        })
    # rolling 1M return (21 sessions) for each series
    roll = (frame / frame.shift(21) - 1) * 100
    step = max(1, len(norm) // 400)
    points = []
    for idx in range(0, len(norm), step):
        d = norm.index[idx]
        p = {"date": d.date().isoformat()}
        for iid in frame.columns:
            p[str(iid)] = round(float(norm.iloc[idx][iid]), 3)
            rv = roll.iloc[idx][iid]
            p[f"r{iid}"] = None if pd.isna(rv) else round(float(rv), 3)
        points.append(p)
    if points and points[-1]["date"] != norm.index[-1].date().isoformat():
        d = norm.index[-1]
        p = {"date": d.date().isoformat()}
        for iid in frame.columns:
            p[str(iid)] = round(float(norm.iloc[-1][iid]), 3)
            rv = roll.iloc[-1][iid]
            p[f"r{iid}"] = None if pd.isna(rv) else round(float(rv), 3)
        points.append(p)
    return {
        "period": period,
        "series": series,
        "points": points,
        "correlation": {"ids": [int(c) for c in corr.columns], "matrix": corr.values.tolist()} if corr is not None else None,
        "warnings": warnings,
        "notes": [
            "All values in INR. Indices are price indices (dividends excluded); ETFs/NAVs are market prices.",
            "Gold/silver reference series are international prices converted to INR and differ from Indian retail rates.",
            "Past performance does not indicate future results.",
        ],
    }
