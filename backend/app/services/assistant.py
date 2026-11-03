"""Ask FinLex: a guarded assistant grounded in the user's own data and FinLex's computed results.

Two engines share the same tools and guardrails:
* ``claude`` - Anthropic Messages API with tool use (manual loop), used only when an API key is
               configured and the user has consented to sending their portfolio data to the LLM.
* ``local``  - deterministic intent router + templates over the same tools (always available).

Guardrails: an advice-request classifier runs before any engine; advice-like phrasing in model
output is caught by a post-check. Every answer carries citations of the tools/data used.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import re
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models import ChatMessage, Filing, Instrument, Portfolio, User
from ..seed.learn import GLOSSARY
from . import compare as cmp
from . import exposure as expo
from . import forecasting as fx
from . import llm
from . import marketdata as md
from . import planner
from . import portfolio as pfs
from . import pulse as pulsesvc
from . import trackrecord as tr

log = logging.getLogger("finlex.assistant")

ADVICE_PATTERNS = [
    r"\b(should|shall|must|can)\s+i\s+(buy|sell|hold|invest|exit|book|switch|redeem|add|accumulate|average|short)\b",
    r"\b(buy|sell|hold)\s*(,|or|/)\s*(sell|hold|buy)\b",
    r"\b(which|what|best|top|good|great)\b[^?]{0,40}\b(stock|share|fund|mutual fund|sip|ipo|etf|scheme)s?\b[^?]{0,40}"
    r"\b(buy|invest|pick|own|for me|purchase|add)\b",
    r"\b(tips?|multibagger|target price|price target|stop ?loss|intraday call|guaranteed returns?|sure ?shot|jackpot)\b",
    r"\b(recommend|suggest)\w*\b[^?]{0,40}\b(stock|fund|share|investment|scheme|etf|ipo)s?\b",
    r"\bgood time to (buy|sell|invest|enter|exit)\b",
    r"\bis\s+\w+(\s+\w+)?\s+a\s+(good|safe|bad)\s+(buy|investment|bet)\b",
    r"\b(where|how much)\s+should\s+i\s+(invest|put)\b",
]
OUTPUT_ADVICE = re.compile(r"\byou should (buy|sell|hold|invest in|exit|switch)\b|\bi (would )?recommend (buying|selling|"
                           r"holding|investing)\b|\b(strong )?(buy|sell) (rating|call|signal)\b", re.I)

REFUSAL = ("I can't tell you what to buy, sell or hold, or suggest price targets. FinLex is an educational tool, "
           "not a SEBI-registered investment adviser, and personalised recommendations legally require one. "
           "What I can do is lay out the facts neutrally.")


def is_advice_request(text: str) -> bool:
    low = text.lower()
    return any(re.search(p, low) for p in ADVICE_PATTERNS)


# ------------------------------------------------------------------ instrument resolution
def resolve_instrument(db: Session, text: str) -> Instrument | None:
    low = text.lower()
    aliases = {"nifty 50": "NIFTY50", "nifty": "NIFTY50", "sensex": "SENSEX", "bank nifty": "BANKNIFTY",
               "nifty bank": "BANKNIFTY", "nifty it": "NIFTYIT", "gold": "GOLD", "silver": "SILVER",
               "reliance": "RELIANCE", "infosys": "INFY", "hdfc bank": "HDFCBANK", "icici bank": "ICICIBANK",
               "sbi": "SBIN", "airtel": "BHARTIARTL", "tcs": "TCS", "itc": "ITC", "l&t": "LT", "zomato": "ETERNAL"}
    for k in sorted(aliases, key=len, reverse=True):
        if re.search(rf"(?<![a-z]){re.escape(k)}(?![a-z])", low):
            return db.scalar(select(Instrument).where(Instrument.symbol == aliases[k]))
    for tok in re.findall(r"\b[A-Z][A-Z&\-]{1,15}\b", text):
        inst = db.scalar(select(Instrument).where(Instrument.symbol == tok))
        if inst:
            return inst
    words = [w for w in re.findall(r"[a-z]{4,}", low) if w not in {"what", "which", "show", "fund", "stock", "price",
                                                                     "forecast", "range", "compare", "with", "much"}]
    for w in words:
        inst = db.scalar(select(Instrument).where(Instrument.name.ilike(f"{w}%")).limit(1))
        if inst:
            return inst
    return None


# ------------------------------------------------------------------ tools
class Tools:
    def __init__(self, db: Session, user: User, pf: Portfolio):
        self.db, self.user, self.pf = db, user, pf
        self._val = None
        self._exp = None
        self.citations: list[dict] = []

    def _cite(self, tool: str, detail: str, as_of: str | None = None) -> None:
        self.citations.append({"tool": tool, "detail": detail, "as_of": as_of})

    @property
    def val(self) -> dict:
        if self._val is None:
            self._val = pfs.valuation(self.db, self.pf)
        return self._val

    @property
    def exp(self) -> dict:
        if self._exp is None:
            self._exp = expo.compute_exposure(self.db, self.pf, self.user.preferences or {})
        return self._exp

    def portfolio_summary(self) -> dict:
        v = self.val
        t = v["totals"]
        self._cite("portfolio_summary", f"{t['holdings']} holdings valued", t.get("valued_at"))
        top = sorted([h for h in v["holdings"] if not h["closed"] and h["value"]], key=lambda h: -h["value"])[:8]
        return {"totals": t, "by_type": v["allocation"]["by_type"], "by_account": v["allocation"]["by_account"],
                "top_holdings": [{"name": h["instrument"]["name"], "type": h["type_label"], "value": h["value"],
                                  "weight_pct": h["weight"], "pnl_pct": h["pnl_pct"], "xirr_pct": h["xirr"]}
                                 for h in top],
                "data_issues": [i["message"] for i in v["issues"]][:5]}

    def exposure(self, query: str | None = None) -> dict:
        e = self.exp
        self._cite("exposure", "fund look-through (estimates as of each fund's disclosure date)")
        out: dict[str, Any] = {"top_companies": [{"name": c["name"], "pct": c["pct"], "value": c["total"],
                                                  "direct": c["direct"], "via_funds": c["indirect"],
                                                  "sources": [x["via"] for x in c["contributors"][:5]]}
                                                 for c in e["companies"][:10]],
                               "sectors": e["sectors"][:10], "asset_mix": e["asset_mix"],
                               "not_itemised_pct": e["unitemised_pct"], "flags": [f["message"] for f in e["flags"]]}
        if query:
            q = query.lower()
            if any(k in q for k in ("bank", "financ")):
                q = "financial services"
            sec = [s for s in e["sectors"] if q in s["sector"].lower()]
            comp = [c for c in e["companies"] if q in c["name"].lower() or q == (c["symbol"] or "").lower()]
            out["match"] = {"sectors": sec, "companies": [{"name": c["name"], "pct": c["pct"], "value": c["total"],
                                                           "contributors": c["contributors"][:6]} for c in comp[:5]]}
        return out

    def fund_overlap(self) -> dict:
        e = self.exp
        self._cite("fund_overlap", f"{len(e['overlap']['funds'])} funds with look-through data")
        return {"pairs": [{"a": p["a"], "b": p["b"], "overlap_pct": p["overlap_pct"], "n_common": p["n_common"],
                           "top_common": [c["name"] for c in p["common"][:5]]} for p in e["overlap"]["pairs"][:6]],
                "coverage": e["coverage"]}

    def value_change(self, period: str = "1M") -> dict:
        period = period if period in ("1W", "1M", "3M", "6M", "1Y") else "1M"
        days = {"1W": 7, "1M": 31, "3M": 92, "6M": 183, "1Y": 366}[period]
        hist = pfs.value_history(self.db, self.pf, "1Y" if days <= 366 else "ALL")
        pts = hist["points"]
        if not pts:
            return {"error": "No holdings with transactions yet."}
        cutoff = (dt.date.fromisoformat(pts[-1]["date"]) - dt.timedelta(days=days)).isoformat()
        start = next((p for p in pts if p["date"] >= cutoff), pts[0])
        end = pts[-1]
        contrib = []
        for h in self.val["holdings"]:
            if h["closed"] or not h["value"] or h["instrument"]["asset_class"] == "fd":
                continue
            s = md.get_series(self.db, h["instrument"]["id"], adjusted=False)
            s = s[s.index >= cutoff]
            if len(s) > 1 and h["instrument"]["exchange"] != "REF":
                chg = (float(s.iloc[-1]) - float(s.iloc[0])) * h["quantity"]
                contrib.append({"name": h["instrument"]["name"], "change": chg,
                                "price_change_pct": (float(s.iloc[-1]) / float(s.iloc[0]) - 1) * 100})
        contrib.sort(key=lambda x: -abs(x["change"]))
        self._cite("value_change", f"value history {start['date']} → {end['date']}", end["date"])
        return {"period": period, "start": start, "end": end, "change": end["value"] - start["value"],
                "net_invested_change": end["invested"] - start["invested"],
                "market_driven_change": (end["value"] - start["value"]) - (end["invested"] - start["invested"]),
                "largest_contributors": contrib[:6]}

    def market_brief(self) -> dict:
        b = pulsesvc.brief(self.db)
        self._cite("market_brief", "daily brief from stored prices", b.get("as_of"))
        return {"summary": b["summary"], "indices": [{k: r[k] for k in ("name", "price", "change_pct", "as_of", "source")}
                                                     for r in b["indices"]],
                "metals": [{k: r[k] for k in ("name", "price", "change_pct", "as_of")} for r in b["metals"]],
                "news_mood": b["news_mood"]}

    def compare_instruments(self, symbols: list[str], period: str = "1Y") -> dict:
        ids = []
        for s in symbols[:5]:
            inst = self.db.scalar(select(Instrument).where(Instrument.symbol == s.upper())) or resolve_instrument(self.db, s)
            if inst:
                ids.append(inst.id)
        if not ids:
            return {"error": "No matching instruments"}
        r = cmp.compare(self.db, ids, period if period in cmp.PERIOD_DAYS else "1Y")
        self._cite("compare", f"{len(ids)} instruments over {r['period']}")
        return {"period": r["period"], "series": [{"name": s["instrument"]["name"], **{k: s["metrics"].get(k) for k in (
            "total_return_pct", "cagr_pct", "ann_vol_pct", "max_drawdown_pct", "start", "end")}, "source": s["source"]}
            for s in r["series"]], "warnings": r["warnings"]}

    def forecast(self, symbol: str, horizon_days: int = 21, model: str = "ridge") -> dict:
        inst = self.db.scalar(select(Instrument).where(Instrument.symbol == symbol.upper())) or \
            resolve_instrument(self.db, symbol)
        if not inst:
            return {"error": f"Unknown instrument {symbol}"}
        h = horizon_days if horizon_days in fx.HORIZONS else 21
        model = model if model in ("ridge", "xgboost", "drift", "naive") else "ridge"
        f = fx.forecast(self.db, inst, h, model)
        tr.log_forecast(self.db, f, "live")
        ev = fx.evaluation(self.db, inst, h)
        m = ev["metrics"].get(model, {})
        self._cite("forecast", f"{f['model_name']} {f['horizon_label']} for {inst.name}", f["cutoff_date"])
        return {"instrument": inst.name, "model": f["model_name"], "horizon": f["horizon_label"],
                "cutoff_date": f["cutoff_date"], "target_date": f["target_date"],
                "point_return_pct": f["point_return"], "range80_pct": f["interval80"], "range50_pct": f["interval50"],
                "price_range80": f["price_interval80"], "base_price": f["base_price"],
                "walk_forward": {"coverage80": m.get("coverage80"), "mae": m.get("mae"),
                                 "skill_vs_naive": m.get("skill_vs_naive"), "beats_naive": m.get("beats_naive"),
                                 "n": m.get("n"), "test_period": [ev.get("test_start"), ev.get("test_end")]},
                "disclaimer": f["disclaimer"]}

    def track_record(self) -> dict:
        live = tr.report(self.db, "live", page_size=1)
        bt = tr.report(self.db, "backtest", page_size=1)
        self._cite("track_record", "forecast log summary")
        return {"live": live["summary"], "backtest": bt["summary"], "chain_ok": live["chain"]["ok"]}

    def glossary(self, term: str) -> dict:
        t = term.lower().strip()
        hits = [g for g in GLOSSARY if t in g["term"].lower() or any(t in a for a in g.get("aliases", []))]
        if not hits:
            hits = [g for g in GLOSSARY if any(w in g["term"].lower() for w in t.split() if len(w) > 3)]
        self._cite("glossary", term)
        return {"matches": hits[:3]}

    def risk_review(self) -> dict:
        r = planner.expert_review(self.val, self.exp, self.user.preferences or {})
        self._cite("expert_review", f"{r['fired']} rules fired")
        return {"fired_rules": [{"id": x["id"], "title": x["title"], "explanation": x["explanation"], "facts": x["facts"]}
                                for x in r["rules"] if x["fired"]], "current_allocation": r["current_allocation"],
                "profile": r["profile"]}

    def latest_filing(self, issuer: str | None = None) -> dict:
        q = select(Filing).where(or_(Filing.user_id == self.user.id, Filing.user_id.is_(None)))
        if issuer:
            q = q.where(Filing.issuer.ilike(f"%{issuer}%"))
        f = self.db.scalar(q.order_by(Filing.created_at.desc()).limit(1))
        if not f:
            return {"error": "No filings found. Upload a results document on the Market Pulse page."}
        self._cite("filing", f"{f.issuer} {f.period}")
        return {"issuer": f.issuer, "period": f.period, "facts": f.facts["metrics"], "unit": f.facts.get("unit"),
                "risk_mentions": [r["term"] for r in f.facts.get("risk_mentions", [])],
                "reported_summary": f.summary.get("reported"), "is_sample": f.is_sample}


TOOL_SPECS = [
    {"name": "portfolio_summary", "description": "User's portfolio totals (value, invested, P&L, XIRR), allocation and top holdings.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "exposure", "description": "Look-through exposure to companies and sectors across direct stocks and funds. "
                                        "Optional query filters by company or sector name (e.g. 'bank', 'Reliance').",
     "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "additionalProperties": False}},
    {"name": "fund_overlap", "description": "Pairwise overlap between the user's mutual funds and their common holdings.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "value_change", "description": "Change in portfolio value over a period with the largest contributors.",
     "input_schema": {"type": "object", "properties": {"period": {"type": "string", "enum": ["1W", "1M", "3M", "6M", "1Y"]}},
                      "additionalProperties": False}},
    {"name": "market_brief", "description": "Today's factual Indian market recap (indices, gold, silver, news tone).",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "compare_instruments", "description": "Compare returns, volatility and drawdown of instruments in INR.",
     "input_schema": {"type": "object", "properties": {"symbols": {"type": "array", "items": {"type": "string"}},
                                                       "period": {"type": "string", "enum": ["1M", "3M", "6M", "1Y", "3Y", "5Y"]}},
                      "required": ["symbols"], "additionalProperties": False}},
    {"name": "forecast", "description": "Experimental calibrated return range for an instrument with its walk-forward track record.",
     "input_schema": {"type": "object", "properties": {"symbol": {"type": "string"},
                                                       "horizon_days": {"type": "integer", "enum": [1, 5, 21]},
                                                       "model": {"type": "string", "enum": ["ridge", "xgboost", "drift", "naive"]}},
                      "required": ["symbol"], "additionalProperties": False}},
    {"name": "track_record", "description": "Summary of FinLex's logged forecasts vs outcomes (hits and misses).",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "glossary", "description": "Plain-language definition of a financial or modelling term.",
     "input_schema": {"type": "object", "properties": {"term": {"type": "string"}}, "required": ["term"], "additionalProperties": False}},
    {"name": "risk_review", "description": "Rule-based (expert system) observations on concentration, allocation and data freshness.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "latest_filing", "description": "Extracted facts from the latest uploaded or sample quarterly-results filing.",
     "input_schema": {"type": "object", "properties": {"issuer": {"type": "string"}}, "additionalProperties": False}},
]

SYSTEM_PROMPT = """You are Ask FinLex, an assistant inside FinLex, an educational portfolio-understanding app for Indian retail investors.

Rules you must follow:
- Answer ONLY from tool results. Never invent holdings, prices, filing figures or model performance. If a tool returns an error or lacks data, say so.
- Never give buy/sell/hold recommendations, price targets, "picks", or guaranteed-return claims. FinLex is not a SEBI-registered investment adviser. If asked, decline briefly, explain why, and offer neutral facts instead.
- Forecasts are experimental ranges, not predictions to act on; always mention the range, the horizon and the model's historical coverage.
- Mention data freshness (as-of dates) and whether figures are estimates (e.g. fund look-through).
- Ask a clarifying question if the instrument, period or calculation is ambiguous.
- Use INR (₹) with Indian digit grouping where natural. Be concise: short paragraphs or bullet points, under 200 words unless the user asks for detail."""


def _inr(x: float | None) -> str:
    if x is None:
        return "—"
    neg = x < 0
    x = abs(x)
    s = f"{x:,.0f}"
    if x >= 1e5:  # Indian grouping
        intpart = f"{int(round(x))}"
        last3, rest = intpart[-3:], intpart[:-3]
        groups = []
        while len(rest) > 2:
            groups.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            groups.insert(0, rest)
        s = ",".join(groups + [last3])
    return ("-₹" if neg else "₹") + s


def _pct(x: float | None, signed: bool = True) -> str:
    return "—" if x is None else (f"{x:+.2f}%" if signed else f"{x:.2f}%")


# ------------------------------------------------------------------ local engine
def local_answer(tools: Tools, text: str) -> str:
    low = text.lower()
    inst = resolve_instrument(tools.db, text)
    forecast_q = any(k in low for k in ("forecast", "predict", "range", "will ", "next week", "next month", "outlook"))
    if re.search(r"\b(what is|what's|what does|define|meaning|explain the term|what are)\b", low) and not any(
            k in low for k in ("my ", "portfolio", "exposure", "overlap")) and not (forecast_q and inst):
        term = re.sub(r".*?\b(what is|what's|what does|define|meaning of|explain the term|what are)\b", "", low)
        term = re.sub(r"\b(mean|a|an|the)\b|\?", " ", term).strip()
        g = tools.glossary(term or low)
        if g["matches"]:
            m = g["matches"][0]
            out = f"**{m['term']}** — {m['definition']}"
            if m.get("example"):
                out += f"\n\nExample: {m['example']}"
            return out
    if any(k in low for k in ("overlap", "share the most", "common holdings", "same stocks")):
        o = tools.fund_overlap()
        if not o["pairs"]:
            return ("I need at least two mutual funds or ETFs with look-through data to compute overlap. "
                    "Add funds on the Portfolio page.")
        lines = [f"- **{p['a']}** & **{p['b']}**: {p['overlap_pct']:.1f}% overlap ({p['n_common']} common stocks, "
                 f"e.g. {', '.join(p['top_common'][:3])})" for p in o["pairs"][:4]]
        return ("Overlap = sum of the smaller weight of each stock both funds hold (from disclosed portfolios).\n\n"
                + "\n".join(lines) + "\n\nThese are estimates from each fund's last disclosure, not live positions.")
    if any(k in low for k in ("expos", "concentrat", "how much of my", "sector")) or (
            inst and inst.asset_class == "equity" and "my" in low):
        query = None
        for k in ("bank", "financ", "it ", "information technology", "pharma", "health", "auto", "fmcg", "energy",
                  "oil", "metal", "power"):
            if k in low:
                query = {"it ": "information technology", "pharma": "health", "energy": "oil", "fmcg": "consumer goods"}.get(k, k)
                break
        if inst and inst.asset_class == "equity":
            query = inst.name.split()[0]
        e = tools.exposure(query)
        if query and e.get("match"):
            m = e["match"]
            parts = []
            for s in m["sectors"][:2]:
                parts.append(f"**{s['sector']}**: ~{s['pct']:.1f}% of your portfolio ({_inr(s['value'])}), estimated.")
                in_sector = [c for c in tools.exp["companies"] if c["sector"] == s["sector"]][:5]
                if in_sector:
                    parts.append("Largest names in it: " + ", ".join(
                        f"{c['name']} {c['pct']:.1f}%" for c in in_sector) + ".")
            company_q = bool(inst and inst.asset_class == "equity")
            for c in (m["companies"][:3] if company_q else []):
                src = ", ".join(f"{x['via']} {_inr(x['value'])}" for x in c["contributors"][:4])
                parts.append(f"**{c['name']}**: ~{c['pct']:.2f}% ({_inr(c['value'])}) — {src}.")
            if parts:
                return "\n".join(parts) + ("\n\nIndirect amounts = your value in each fund × the fund's disclosed "
                                           f"weight. ~{e['not_itemised_pct']:.1f}% of your portfolio sits in fund "
                                           "holdings that are not itemised in the dataset.")
        lines = [f"- {c['name']}: {c['pct']:.2f}% ({_inr(c['value'])})" for c in e["top_companies"][:6]]
        secs = [f"- {s['sector']}: {s['pct']:.1f}%" for s in e["sectors"][:5]]
        flags = ("\n\n" + "\n".join(f"⚠ {f}" for f in e["flags"][:3])) if e["flags"] else ""
        return ("Your largest look-through company exposures:\n" + "\n".join(lines) +
                "\n\nLargest sectors:\n" + "\n".join(secs) + flags)
    if re.search(r"\b(why|what).*(change|move|drop|fall|rise|gain|up|down)\b", low) and any(
            k in low for k in ("portfolio", "value", "my", "week", "month")):
        period = "1W" if "week" in low else "1M" if "month" in low else "1W"
        v = tools.value_change(period)
        if "error" in v:
            return v["error"]
        lines = [f"- {c['name']}: {_inr(c['change'])} (price {_pct(c['price_change_pct'])})"
                 for c in v["largest_contributors"][:5]]
        return (f"From {v['start']['date']} to {v['end']['date']}, your portfolio value changed by "
                f"**{_inr(v['change'])}**. Of that, {_inr(v['net_invested_change'])} came from money you added or "
                f"withdrew, and **{_inr(v['market_driven_change'])}** from price movements.\n\nLargest contributors:\n"
                + "\n".join(lines) + "\n\nThis shows *what* moved, not *why* prices moved.")
    if any(k in low for k in ("forecast", "predict", "range", "will ", "next week", "next month", "outlook")) and inst:
        h = 5 if "week" in low else 1 if ("tomorrow" in low or "day" in low) else 21
        f = tools.forecast(inst.symbol, h)
        if "error" in f:
            return f["error"]
        wf = f["walk_forward"]
        cov = f"{wf['coverage80'] * 100:.0f}%" if wf.get("coverage80") is not None else "—"
        beat = {"significant": "beat the no-change baseline (statistically significant)",
                "marginal": "beat the no-change baseline only marginally (not significant)",
                "no": "did **not** beat the no-change baseline"}.get(wf.get("beats_naive"), "was not evaluated")
        return (f"FinLex does not predict direction with certainty. The experimental {f['model']} model's "
                f"{f['horizon']} range for **{f['instrument']}** (data to {f['cutoff_date']}):\n\n"
                f"- 80% range: {_pct(f['range80_pct'][0])} to {_pct(f['range80_pct'][1])} "
                f"(≈ {f['price_range80'][0]:,.2f} – {f['price_range80'][1]:,.2f})\n"
                f"- Central estimate: {_pct(f['point_return_pct'])}\n\n"
                f"In walk-forward testing ({wf['n']} out-of-sample checks), its 80% ranges contained the outcome "
                f"{cov} of the time, and it {beat}. {f['disclaimer']}")
    if any(k in low for k in ("track record", "accuracy", "hit rate", "how accurate", "misses")):
        t = tools.track_record()
        live, bt = t["live"], t["backtest"]

        def line(name: str, s: dict) -> str:
            if not s.get("n"):
                return f"- {name}: no scored forecasts yet ({s.get('pending', 0)} pending)."
            return (f"- {name}: {s['n']} scored, 80%-range hit rate {s['coverage80'] * 100:.0f}%, MAE "
                    f"{s['mae']:.2f} pp vs naive {s['naive_mae']:.2f} pp, {s.get('pending', 0)} pending.")
        return ("FinLex's forecast log (misses included):\n" + line("Live", live) + "\n" + line("Backtest replay", bt) +
                f"\n\nHash-chain integrity check: {'passed' if t['chain_ok'] else 'FAILED'}.")
    if any(k in low for k in ("result", "filing", "quarter", "earnings")):
        f = tools.latest_filing(inst.name.split()[0] if inst else None)
        if "error" in f:
            return f["error"]
        return (f"**{f['issuer']}** — {f['period']}{' (synthetic sample)' if f['is_sample'] else ''}\n\n"
                f"{f['reported_summary']}\n\nFigures are extracted from the document text; verify against the filing.")
    if any(k in low for k in ("compare", " vs ", "versus")) and inst:
        syms = [inst.symbol]
        for k in ("gold", "silver", "nifty", "sensex"):
            if k in low:
                i2 = resolve_instrument(tools.db, k)
                if i2 and i2.symbol not in syms:
                    syms.append(i2.symbol)
        c = tools.compare_instruments(syms, "1Y")
        if "error" in c:
            return c["error"]
        lines = [f"- {s['name']}: return {_pct(s['total_return_pct'])}, volatility {_pct(s['ann_vol_pct'], False)}, "
                 f"max drawdown {_pct(s['max_drawdown_pct'])}" for s in c["series"]]
        return "Over the last year (INR):\n" + "\n".join(lines) + "\n\nPast performance does not indicate future results."
    if any(k in low for k in ("market", "today", "nifty", "sensex", "gold", "silver")):
        b = tools.market_brief()
        return b["summary"] or "Market data is still loading."
    if any(k in low for k in ("risk", "diversif", "review", "health", "balanced", "allocation")):
        r = tools.risk_review()
        if not r["fired_rules"]:
            return "None of FinLex's rules fired for your stated profile — no concentration or freshness flags."
        return ("Rule-based observations (each lists the facts it used):\n" +
                "\n".join(f"- **{x['title']}** ({x['id']}): {x['explanation']}" for x in r["fired_rules"]) +
                "\n\nThese are educational observations, not advice.")
    if any(k in low for k in ("xirr", "return", "worth", "total", "value", "portfolio", "invested", "p&l", "profit")):
        s = tools.portfolio_summary()
        t = s["totals"]
        if not t["holdings"]:
            return "Your portfolio is empty. Add holdings manually or import a CSV/CAMS statement on the Portfolio page."
        types = ", ".join(f"{a['label']} {a['pct']:.0f}%" for a in s["by_type"])
        return (f"Your portfolio is worth **{_inr(t['value'])}** against {_inr(t['invested'])} invested "
                f"(unrealised {_inr(t['pnl'])}, {_pct(t['pnl_pct'])}). XIRR: {_pct(t['xirr'], False)}. "
                f"Today's change: {_inr(t['day_change'])}.\n\nAllocation: {types}." +
                (f"\n\nData notes: {s['data_issues'][0]}" if s["data_issues"] else ""))
    return ("I can answer questions about your own portfolio and FinLex's analysis, for example:\n"
            "- \"How much of my portfolio is exposed to banking stocks?\"\n"
            "- \"Which of my mutual funds share the most holdings?\"\n"
            "- \"Why did my portfolio value change this week?\"\n"
            "- \"What is FinLex's forecast range for gold next month?\"\n"
            "- \"Explain the latest quarterly result\" · \"What does interval coverage mean?\"")


def advice_refusal(tools: Tools, text: str) -> str:
    inst = resolve_instrument(tools.db, text)
    extra = ("\n\nYou could ask:\n- \"How concentrated is my portfolio?\"\n- \"Compare gold and NIFTY 50 over 5 years\"\n"
             "- \"What is the forecast range for NIFTY next month, and how accurate has it been?\"")
    if inst:
        extra = (f"\n\nFor **{inst.name}**, I can show its past returns and volatility, an experimental forecast range "
                 "with its historical accuracy, or how much of your portfolio is exposed to it. Just ask.")
    return REFUSAL + extra


# ------------------------------------------------------------------ claude engine
def _run_tool(tools: Tools, name: str, args: dict) -> str:
    fn = getattr(tools, name, None)
    if fn is None or name.startswith("_") or name not in {t["name"] for t in TOOL_SPECS}:
        return json.dumps({"error": f"unknown tool {name}"})
    try:
        return json.dumps(fn(**args), default=str)[:12000]
    except Exception as e:  # noqa: BLE001
        log.warning("tool %s failed: %s", name, e)
        return json.dumps({"error": str(e)})


def claude_answer(tools: Tools, history: list[dict], text: str) -> str | None:
    messages = [*history, {"role": "user", "content": text}]
    for _ in range(6):
        resp = llm.create(SYSTEM_PROMPT, messages, tools=TOOL_SPECS, max_tokens=4000)
        if resp.stop_reason == "refusal":
            return None
        if resp.stop_reason != "tool_use":
            return llm.text_of(resp)
        messages.append({"role": "assistant", "content": resp.content})
        results = []
        for b in resp.content:
            if b.type == "tool_use":
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": _run_tool(tools, b.name, b.input or {})})
        messages.append({"role": "user", "content": results})
    return None


def ask(db: Session, user: User, pf: Portfolio, text: str) -> dict:
    text = text.strip()[:2000]
    tools = Tools(db, user, pf)
    engine = "local"
    guard = None
    if is_advice_request(text):
        answer, guard = advice_refusal(tools, text), "advice_request_declined"
    else:
        answer = None
        if llm.configured() and user.consent_llm:
            hist_rows = list(db.scalars(select(ChatMessage).where(ChatMessage.user_id == user.id)
                                        .order_by(ChatMessage.id.desc()).limit(10)))[::-1]
            history = [{"role": m.role, "content": m.content} for m in hist_rows if m.role in ("user", "assistant")]
            while history and history[0]["role"] != "user":
                history.pop(0)
            try:
                answer = claude_answer(tools, history, text)
                engine = "claude" if answer else "local"
            except Exception as e:  # noqa: BLE001
                log.warning("Claude unavailable, using local engine: %s", e)
        if answer and OUTPUT_ADVICE.search(answer):
            answer, guard = advice_refusal(tools, text), "advice_in_output_blocked"
        if not answer:
            engine = "local"
            try:
                answer = local_answer(tools, text)
            except Exception as e:  # noqa: BLE001
                log.exception("local engine error")
                answer = f"Sorry — I couldn't compute that ({e}). Please try rephrasing."
    meta = {"engine": engine, "citations": tools.citations, "guardrail": guard}
    db.add(ChatMessage(user_id=user.id, role="user", content=text, meta={}))
    db.add(ChatMessage(user_id=user.id, role="assistant", content=answer, meta=meta))
    db.commit()
    return {"answer": answer, **meta}
