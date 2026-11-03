"""Plan: rule-based expert system + constraint-satisfaction allocation explorer (CSP + A* search).

The planner answers: "Which asset-class mixes satisfy MY constraints, and which of them is closest to
what I hold today?" It does not recommend securities or tell users what to do. Expected-risk figures
come from historical proxy series and are labelled as such.
"""
from __future__ import annotations

import heapq
import itertools
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Instrument
from . import marketdata as md

CLASSES = ["equity_large", "equity_midsmall", "debt", "gold", "silver", "cash"]
CLASS_LABELS = {"equity_large": "Large-cap equity", "equity_midsmall": "Mid/small-cap equity",
                "debt": "Debt & FDs", "gold": "Gold", "silver": "Silver", "cash": "Cash"}
PROXIES = {"equity_large": "NIFTY50", "equity_midsmall": "MF118989", "debt": "MF119091", "gold": "GOLD",
           "silver": "SILVER", "cash": None}
RISK_VOL_CAP = {"conservative": 8.0, "moderate": 13.0, "aggressive": 20.0}
EQUITY_RANGE = {"conservative": (10, 40), "moderate": (30, 70), "aggressive": (50, 90)}


# ------------------------------------------------------------------ portfolio → classes
def current_classes(valuation: dict, exposure: dict | None = None) -> dict[str, float]:
    tot = valuation["totals"]["value"] or 0.0
    out = {c: 0.0 for c in CLASSES}
    if not tot:
        return out
    for h in valuation["holdings"]:
        if h["closed"] or not h["value"]:
            continue
        i, v = h["instrument"], h["value"]
        cls, cat = i["asset_class"], (i.get("category") or "")
        if cls == "equity":
            out["equity_large" if cat in ("Large cap", None, "") else "equity_midsmall"] += v
        elif cls == "mf":
            if cat in ("Liquid",):
                out["debt"] += v
            elif cat in ("Mid Cap", "Small Cap"):
                out["equity_midsmall"] += v
            elif cat == "Balanced Advantage":
                out["equity_large"] += v * 0.55
                out["debt"] += v * 0.45
            else:
                out["equity_large"] += v
        elif cls == "etf":
            u = i.get("sector")
            out["gold" if u == "Gold" else "silver" if u == "Silver" else "equity_large"] += v
        elif cls in ("gold", "silver"):
            out[cls] += v
        elif cls == "fd":
            out["debt"] += v
        else:
            out["cash"] += v
    return {k: v / tot * 100 for k, v in out.items()}


# ------------------------------------------------------------------ expert system
@dataclass
class Rule:
    id: str
    title: str
    condition: str
    fired: bool = False
    facts: dict = field(default_factory=dict)
    explanation: str = ""
    severity: str = "info"


def expert_review(valuation: dict, exposure: dict, prefs: dict) -> dict:
    risk = prefs.get("risk_level", "moderate")
    horizon = float(prefs.get("horizon_years", 5))
    cls = current_classes(valuation)
    eq = cls["equity_large"] + cls["equity_midsmall"]
    lo, hi = EQUITY_RANGE.get(risk, (30, 70))
    rules: list[Rule] = []

    r = Rule("R1", "Equity share vs stated risk level", f"equity% outside {lo}-{hi}% for a {risk} profile")
    r.facts = {"equity_pct": round(eq, 1), "range": [lo, hi], "risk_level": risk}
    if eq > hi:
        r.fired, r.severity = True, "warning"
        r.explanation = (f"About {eq:.0f}% of your portfolio is in equity, above the {lo}-{hi}% band FinLex uses to "
                         f"describe a {risk} profile. Equity-heavy portfolios typically swing more in value.")
    elif eq < lo and valuation["totals"]["value"]:
        r.fired = True
        r.explanation = (f"About {eq:.0f}% is in equity, below the {lo}-{hi}% band used for a {risk} profile. "
                         "This usually means lower volatility, and historically lower long-run growth.")
    rules.append(r)

    top = exposure["companies"][0] if exposure.get("companies") else None
    thr = float(prefs.get("company_threshold_pct", 10))
    r = Rule("R2", "Single-company concentration", f"largest look-through company exposure ≥ {thr:g}%")
    if top:
        r.facts = {"company": top["name"], "pct": round(top["pct"], 2), "sources": top["n_sources"]}
        if top["pct"] >= thr:
            r.fired, r.severity = True, "warning"
            r.explanation = (f"{top['name']} is ~{top['pct']:.1f}% of your portfolio once funds are looked through "
                             f"({top['n_sources']} source(s)). A single company's news can noticeably move your total.")
    rules.append(r)

    sthr = float(prefs.get("sector_threshold_pct", 30))
    secs = [s for s in exposure.get("sectors", []) if s["sector"] not in ("Not itemised", "Unclassified")]
    r = Rule("R3", "Sector concentration", f"largest sector ≥ {sthr:g}%")
    if secs:
        r.facts = {"sector": secs[0]["sector"], "pct": round(secs[0]["pct"], 1)}
        if secs[0]["pct"] >= sthr:
            r.fired, r.severity = True, "warning"
            r.explanation = f"{secs[0]['sector']} accounts for ~{secs[0]['pct']:.0f}% (estimated) of your portfolio."
    rules.append(r)

    pairs = exposure.get("overlap", {}).get("pairs", [])
    r = Rule("R4", "Mutual-fund overlap", "any two funds overlap ≥ 40%")
    if pairs:
        r.facts = {"a": pairs[0]["a"], "b": pairs[0]["b"], "overlap_pct": pairs[0]["overlap_pct"]}
        if pairs[0]["overlap_pct"] >= 40:
            r.fired, r.severity = True, "warning"
            r.explanation = (f"{pairs[0]['a']} and {pairs[0]['b']} share ~{pairs[0]['overlap_pct']:.0f}% of their "
                             "disclosed portfolios, so they add less diversification than two funds might suggest.")
    rules.append(r)

    nfunds = sum(1 for h in valuation["holdings"] if h["instrument"]["asset_class"] == "mf" and not h["closed"])
    r = Rule("R5", "Number of funds", "more than 7 mutual funds")
    r.facts = {"funds": nfunds}
    if nfunds > 7:
        r.fired = True
        r.explanation = f"You hold {nfunds} funds. Beyond a handful, extra funds often repeat the same stocks."
    rules.append(r)

    liquid = cls["debt"] + cls["cash"]
    r = Rule("R6", "Liquidity buffer", "debt + cash < 10% with horizon < 3 years")
    r.facts = {"debt_cash_pct": round(liquid, 1), "horizon_years": horizon}
    if liquid < 10 and horizon < 3 and valuation["totals"]["value"]:
        r.fired, r.severity = True, "warning"
        r.explanation = ("Your stated horizon is short, yet under 10% is in debt/cash, which could mean selling "
                         "volatile assets at a bad time if money is needed.")
    rules.append(r)

    metals = cls["gold"] + cls["silver"]
    r = Rule("R7", "Precious-metal share", "gold + silver > 25%")
    r.facts = {"metals_pct": round(metals, 1)}
    if metals > 25:
        r.fired = True
        r.explanation = f"Gold and silver are ~{metals:.0f}% of your portfolio; they have historically been volatile in INR terms."
    rules.append(r)

    small = cls["equity_midsmall"]
    r = Rule("R8", "Mid/small-cap share vs risk", "mid/small-cap > 30% for conservative or > 50% for moderate")
    r.facts = {"midsmall_pct": round(small, 1), "risk_level": risk}
    if (risk == "conservative" and small > 30) or (risk == "moderate" and small > 50):
        r.fired, r.severity = True, "warning"
        r.explanation = f"Mid/small caps are ~{small:.0f}% of your portfolio; they have historically had deeper drawdowns."
    rules.append(r)

    stale = [i for i in valuation["issues"] if i["code"] in ("stale_price", "synthetic_price", "missing_price")]
    r = Rule("R9", "Data freshness", "any holding with stale, missing or synthetic prices")
    r.facts = {"issues": len(stale)}
    if stale:
        r.fired = True
        r.explanation = f"{len(stale)} holding(s) have stale, missing or simulated prices; totals may be off."
    rules.append(r)

    fired = [x for x in rules if x.fired]
    return {
        "profile": {"risk_level": risk, "horizon_years": horizon},
        "current_allocation": [{"class": k, "label": CLASS_LABELS[k], "pct": round(v, 2)} for k, v in cls.items()],
        "rules": [x.__dict__ for x in rules],
        "fired": len(fired),
        "summary": ("No rules fired — your portfolio is within the ranges FinLex checks for your stated profile."
                    if not fired else f"{len(fired)} of {len(rules)} rules fired. Each explanation lists the facts used."),
        "disclaimer": "Educational observations from fixed rules, not personalised advice.",
    }


# ------------------------------------------------------------------ risk model
def risk_model(db: Session) -> tuple[np.ndarray, np.ndarray, dict]:
    """Annualised mean/cov of proxy series over the last 3 years (cash = 0 vol)."""
    by_sym = {i.symbol: i for i in db.scalars(select(Instrument))}
    rets = {}
    for c, sym in PROXIES.items():
        if sym and (i := by_sym.get(sym)):
            s = md.get_series(db, i.id).iloc[-756:]
            if len(s) > 60:
                rets[c] = np.log(s).diff()
    df = pd.DataFrame(rets).dropna()
    mu = np.zeros(len(CLASSES))
    cov = np.zeros((len(CLASSES), len(CLASSES)))
    if len(df) > 30:
        m = df.mean() * 252
        cv = df.cov() * 252
        for a, ca in enumerate(CLASSES):
            if ca in df:
                mu[a] = m[ca]
            for b, cb in enumerate(CLASSES):
                if ca in df and cb in df:
                    cov[a, b] = cv.loc[ca, cb]
    mu[CLASSES.index("cash")] = 0.035
    info = {"window": [df.index[0].date().isoformat(), df.index[-1].date().isoformat()] if len(df) else None,
            "proxies": {c: PROXIES[c] for c in CLASSES}}
    return mu, cov, info


def port_stats(w: np.ndarray, mu: np.ndarray, cov: np.ndarray) -> tuple[float, float]:
    return float(w @ mu * 100), float(math.sqrt(max(w @ cov @ w, 0)) * 100)


# ------------------------------------------------------------------ CSP + A*
def check_feasibility(bounds: dict[str, tuple[int, int]], step: int) -> list[str]:
    problems = []
    lo = sum(b[0] for b in bounds.values())
    hi = sum(b[1] for b in bounds.values())
    if lo > 100:
        problems.append(f"Minimums add up to {lo}% (> 100%). Lower at least one minimum.")
    if hi < 100:
        problems.append(f"Maximums add up to only {hi}% (< 100%). Raise at least one maximum.")
    for c, (a, b) in bounds.items():
        if a > b:
            problems.append(f"{CLASS_LABELS[c]}: minimum {a}% exceeds maximum {b}%.")
        if a % step or b % step:
            pass
    return problems


@dataclass(order=True)
class _Node:
    f: float
    g: float
    k: int
    alloc: tuple = field(compare=False)


def astar_allocations(bounds: dict[str, tuple[int, int]], current: dict[str, float], step: int,
                      vol_cap: float | None, mu: np.ndarray, cov: np.ndarray, max_solutions: int = 5,
                      node_limit: int = 200_000) -> dict:
    """A* over partial assignments (one asset class per depth, in `step`% increments).

    g = turnover so far = 0.5 * sum |w_i - current_i| over assigned classes,
    h = admissible lower bound on remaining turnover: 0.5 * |remaining budget - sum of remaining current|
        (moving the remaining mass requires at least that much change) — never overestimates.
    Goal states satisfy all constraints (sum = 100, bounds, optional volatility cap).
    Arc consistency prunes branches where the remaining classes can no longer reach exactly 100%.
    """
    order = CLASSES
    cur = np.array([current.get(c, 0.0) for c in order])
    lows = [bounds[c][0] for c in order]
    highs = [bounds[c][1] for c in order]
    suffix_lo = [sum(lows[i:]) for i in range(len(order) + 1)]
    suffix_hi = [sum(highs[i:]) for i in range(len(order) + 1)]
    suffix_cur = [float(cur[i:].sum()) for i in range(len(order) + 1)]
    counter = itertools.count()
    start = _Node(0.0, 0.0, next(counter), ())
    heap = [start]
    expanded = 0
    pruned_vol = 0
    solutions = []
    while heap and len(solutions) < max_solutions and expanded < node_limit:
        node = heapq.heappop(heap)
        depth = len(node.alloc)
        used = sum(node.alloc)
        if depth == len(order):
            w = np.array(node.alloc) / 100
            ret, vol = port_stats(w, mu, cov)
            if vol_cap is not None and vol > vol_cap + 1e-9:
                pruned_vol += 1
                continue
            solutions.append({"allocation": {c: node.alloc[i] for i, c in enumerate(order)},
                              "turnover_pct": round(node.g, 2), "hist_return_pct": round(ret, 2),
                              "hist_vol_pct": round(vol, 2)})
            continue
        expanded += 1
        for v in range(lows[depth], highs[depth] + 1, step):
            rem = 100 - used - v
            if rem < suffix_lo[depth + 1] or rem > suffix_hi[depth + 1]:
                continue  # arc consistency: remaining classes can't absorb the remainder
            if depth == len(order) - 1 and rem != 0:
                continue
            g = node.g + 0.5 * abs(v - cur[depth])
            h = 0.5 * abs(rem - suffix_cur[depth + 1])
            heapq.heappush(heap, _Node(g + h, g, next(counter), node.alloc + (v,)))
    return {"solutions": solutions, "nodes_expanded": expanded, "rejected_by_vol_cap": pruned_vol,
            "exhausted": not heap}


def plan(db: Session, valuation: dict, constraints: dict, prefs: dict) -> dict:
    step = int(constraints.get("step", 5))
    if step not in (1, 2, 5, 10):
        raise ValueError("step must be 1, 2, 5 or 10")
    bounds: dict[str, tuple[int, int]] = {}
    for c in CLASSES:
        b = (constraints.get("bounds") or {}).get(c, {})
        lo, hi = int(b.get("min", 0)), int(b.get("max", 100))
        if not (0 <= lo <= 100 and 0 <= hi <= 100):
            raise ValueError(f"{CLASS_LABELS[c]}: bounds must be within 0-100%")
        bounds[c] = (int(math.ceil(lo / step) * step), int(math.floor(hi / step) * step))
    problems = check_feasibility(bounds, step)
    risk = constraints.get("risk_level") or prefs.get("risk_level", "moderate")
    vol_cap = constraints.get("max_vol_pct")
    if vol_cap is None and constraints.get("use_risk_cap", True):
        vol_cap = RISK_VOL_CAP.get(risk)
    current = current_classes(valuation)
    mu, cov, info = risk_model(db)
    w_now = np.array([current[c] / 100 for c in CLASSES])
    now_ret, now_vol = port_stats(w_now, mu, cov) if w_now.sum() else (None, None)
    violations = [f"{CLASS_LABELS[c]} is {current[c]:.1f}% (allowed {lo}-{hi}%)"
                  for c, (lo, hi) in bounds.items() if not (lo - 1e-6 <= current[c] <= hi + 1e-6)]
    if problems:
        return {"feasible": False, "problems": problems, "current": current, "solutions": [],
                "violations_now": violations}
    res = astar_allocations(bounds, current, step, vol_cap, mu, cov)
    if not res["solutions"]:
        problems.append("No allocation satisfies all constraints" +
                        (f" with historical volatility ≤ {vol_cap:.1f}%." if vol_cap else ".") +
                        " Try widening a range or raising the volatility cap.")
    return {
        "feasible": bool(res["solutions"]),
        "problems": problems,
        "bounds": {c: list(b) for c, b in bounds.items()},
        "vol_cap_pct": vol_cap,
        "risk_level": risk,
        "current": {c: round(v, 2) for c, v in current.items()},
        "current_stats": {"hist_return_pct": now_ret, "hist_vol_pct": now_vol},
        "violations_now": violations,
        "solutions": res["solutions"],
        "search": {"algorithm": "A* (g = turnover, admissible h = budget mismatch) with arc-consistency pruning",
                   "nodes_expanded": res["nodes_expanded"], "rejected_by_vol_cap": res["rejected_by_vol_cap"],
                   "step_pct": step},
        "risk_model": {**info, "note": "Historical annualised return/volatility of proxy series over ~3 years; "
                                       "past behaviour, not expected future returns."},
        "labels": CLASS_LABELS,
        "disclaimer": ("These are hypothetical mixes that satisfy the constraints you entered, ordered by how little "
                       "they differ from your current mix. They are not recommendations to buy or sell anything."),
    }
