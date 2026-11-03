"""Market Pulse: daily brief built only from verified, timestamped price data."""
from __future__ import annotations

import json
from collections import defaultdict

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Instrument
from . import llm
from . import marketdata as md
from . import news as newsvc

BRIEF_INDICES = ["NIFTY50", "SENSEX", "BANKNIFTY", "NIFTYIT"]
BRIEF_METALS = ["GOLD", "SILVER", "GOLDBEES", "SILVERBEES"]


def _row(db: Session, inst: Instrument) -> dict | None:
    q = md.latest_quote(db, inst)
    if not q:
        return None
    s = md.get_series(db, inst.id, adjusted=False).iloc[-60:]
    week = None
    if len(s) > 6:
        week = (float(s.iloc[-1]) / float(s.iloc[-6]) - 1) * 100
    spark = [round(float(v), 4) for v in s.iloc[-30:].values]
    return {"id": inst.id, "symbol": inst.symbol, "name": inst.name, "asset_class": inst.asset_class,
            "unit": inst.unit, "sector": inst.sector, **q, "week_change_pct": week, "spark": spark}


def brief(db: Session, use_llm: bool = False) -> dict:
    by_sym = {i.symbol: i for i in db.scalars(select(Instrument))}
    indices = [r for s in BRIEF_INDICES if (i := by_sym.get(s)) and (r := _row(db, i))]
    metals = [r for s in BRIEF_METALS if (i := by_sym.get(s)) and (r := _row(db, i))]
    nifty = [i for i in by_sym.values() if (i.meta or {}).get("nifty50")]
    movers = []
    for i in nifty:
        q = md.latest_quote(db, i)
        if q:
            movers.append({"id": i.id, "symbol": i.symbol, "name": i.name, "sector": i.sector, **q})
    movers.sort(key=lambda r: r["change_pct"])
    sectors: dict[str, list[float]] = defaultdict(list)
    for m in movers:
        sectors[m["sector"] or "Other"].append(m["change_pct"])
    sector_moves = sorted(({"sector": k, "avg_change_pct": float(np.mean(v)), "n": len(v)} for k, v in sectors.items()),
                          key=lambda x: -x["avg_change_pct"])
    adv = sum(1 for m in movers if m["change_pct"] > 0)
    dec = sum(1 for m in movers if m["change_pct"] < 0)
    items = newsvc.recent(db, hours=48)
    mood = newsvc.mood(items)
    synthetic = any(r["synthetic"] for r in indices + metals)
    as_of = max((r["as_of"] for r in indices + metals), default=None)

    def word(p: float) -> str:
        return "rose" if p > 0.05 else "fell" if p < -0.05 else "was little changed"

    lines = []
    n50 = next((r for r in indices if r["symbol"] == "NIFTY50"), None)
    if n50:
        lines.append(f"NIFTY 50 {word(n50['change_pct'])} {abs(n50['change_pct']):.2f}% to {n50['price']:,.2f}"
                     + (f" ({n50['week_change_pct']:+.2f}% over 5 sessions)." if n50["week_change_pct"] is not None else "."))
    for sym in ("BANKNIFTY", "NIFTYIT"):
        r = next((x for x in indices if x["symbol"] == sym), None)
        if r:
            lines.append(f"{r['name']} {word(r['change_pct'])} {abs(r['change_pct']):.2f}%.")
    for sym, label in (("GOLD", "Gold (INR reference, per 10 g)"), ("SILVER", "Silver (INR reference, per kg)")):
        r = next((x for x in metals if x["symbol"] == sym), None)
        if r:
            lines.append(f"{label} {word(r['change_pct'])} {abs(r['change_pct']):.2f}% to ₹{r['price']:,.0f}.")
    if movers:
        lines.append(f"Within NIFTY 50, {adv} stocks advanced and {dec} declined.")
        if sector_moves:
            top, bot = sector_moves[0], sector_moves[-1]
            lines.append(f"{top['sector']} was the strongest sector on average ({top['avg_change_pct']:+.2f}%), "
                         f"{bot['sector']} the weakest ({bot['avg_change_pct']:+.2f}%).")
    if mood["n"]:
        lines.append(f"Headline tone over the last 48 hours was {mood['label']} across {mood['n']} headlines "
                     f"({mood['counts']['positive']} positive, {mood['counts']['negative']} negative) — "
                     "a language signal, not a price prediction.")
    template_text = " ".join(lines)
    ai_text = None
    if use_llm and lines:
        facts = {"indices": [{k: r[k] for k in ("name", "price", "change_pct", "week_change_pct")} for r in indices],
                 "metals": [{k: r[k] for k in ("name", "price", "change_pct", "week_change_pct")} for r in metals],
                 "advancers": adv, "decliners": dec, "sectors": sector_moves, "news_mood": mood,
                 "top_gainers": [{k: m[k] for k in ("name", "change_pct")} for m in movers[-3:]],
                 "top_losers": [{k: m[k] for k in ("name", "change_pct")} for m in movers[:3]]}
        ai_text = llm.summarise_facts(
            "You write a calm, factual daily Indian market recap. Use only the given facts; round to 2 decimals. "
            "Never suggest buying or selling, never predict, never assert causes that the facts don't state.",
            json.dumps(facts, default=str), "Write a 4-6 sentence plain-English recap.")
    return {
        "as_of": as_of,
        "synthetic": synthetic,
        "summary": ai_text or template_text,
        "summary_engine": "claude (number-validated)" if ai_text else "template",
        "indices": indices,
        "metals": metals,
        "gainers": list(reversed(movers[-5:])),
        "losers": movers[:5],
        "sectors": sector_moves,
        "breadth": {"advancers": adv, "decliners": dec, "unchanged": len(movers) - adv - dec},
        "news_mood": mood,
        "notes": ["Prices are delayed and sourced as labelled on each row.",
                  "Describes what moved; does not explain why or suggest any action."],
    }
