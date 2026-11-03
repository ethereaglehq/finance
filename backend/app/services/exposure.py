"""True Exposure: mutual-fund look-through, overlap matrix, sector & company concentration.

Indirect exposure to company X = user's current value in fund F x F's disclosed weight in X.
Direct holdings of X are added. Undisclosed / not-itemised fund residuals are kept in an explicit
"not itemised" bucket instead of being spread across companies.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import re
from collections import defaultdict

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import FundHoldingSnapshot, Instrument, Portfolio
from ..seed import fund_holdings as fh
from . import dataquality
from .portfolio import valuation

GOLD_KEYS = {"gold": "Gold", "silver": "Silver"}


def _norm(name: str) -> str:
    n = name.lower()
    n = re.sub(r"\b(ltd|limited|inc|corp|corporation|the|co|company|plc)\b\.?", "", n)
    return re.sub(r"[^a-z0-9]+", " ", n).strip()


# ------------------------------------------------------------------ seed
def seed_fund_holdings(db: Session) -> None:
    by_symbol = {i.symbol: i for i in db.scalars(select(Instrument))}
    seeded_schemes = set(db.scalars(select(FundHoldingSnapshot.scheme_id).distinct()))

    def add(scheme: Instrument, rows: list[tuple]) -> None:
        if scheme.id in seeded_schemes:
            return
        for sym, name, sector, asset_type, w in rows:
            under = by_symbol.get(sym) if sym else None
            db.add(FundHoldingSnapshot(
                scheme_id=scheme.id, underlying_instrument_id=under.id if under else None,
                underlying_name=under.name if under else name, underlying_isin=under.isin if under else None,
                sector=(under.sector if under else sector), asset_type=asset_type, weight=w,
                disclosure_date=fh.DISCLOSURE_DATE, source=fh.SOURCE))

    nifty_rows = [(s, None, None, "equity", w) for s, w in fh.NIFTY50_WEIGHTS.items()]
    resid = round(100 - sum(fh.NIFTY50_WEIGHTS.values()), 2)
    if resid > 0:
        nifty_rows.append((None, "Cash & equivalents", None, "cash", resid))
    for code, rows in fh.FUNDS.items():
        if (s := by_symbol.get(f"MF{code}")):
            add(s, rows)
    for code in fh.INDEX_TRACKERS:
        if (s := by_symbol.get(f"MF{code}")):
            add(s, nifty_rows)
    for sym, kind in fh.ETF_LOOKTHROUGH.items():
        if (s := by_symbol.get(sym)):
            if kind == "nifty50":
                add(s, nifty_rows)
            else:
                add(s, [(None, GOLD_KEYS[kind] + " (physical bullion held by ETF)", GOLD_KEYS[kind], kind, 100.0)])
    db.commit()


def load_disclosure_csv(db: Session, scheme: Instrument, content: bytes, disclosure_date: dt.date,
                        source: str) -> dict:
    """Replace a scheme's snapshot with an uploaded CSV: name,isin,symbol,sector,asset_type,weight."""
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    required = {"name", "weight"}
    if not reader.fieldnames or not required.issubset({f.strip().lower() for f in reader.fieldnames}):
        raise ValueError("CSV must contain at least 'name' and 'weight' columns")
    by_symbol = {i.symbol: i for i in db.scalars(select(Instrument))}
    by_isin = {i.isin: i for i in by_symbol.values() if i.isin}
    rows, errors = [], []
    for n, raw in enumerate(reader, start=2):
        r = {k.strip().lower(): (v or "").strip() for k, v in raw.items() if k}
        try:
            w = float(r["weight"].rstrip("%"))
        except ValueError:
            errors.append(f"line {n}: weight '{r.get('weight')}' is not a number")
            continue
        under = by_symbol.get(r.get("symbol", "").upper()) or by_isin.get(r.get("isin", ""))
        rows.append(FundHoldingSnapshot(
            scheme_id=scheme.id, underlying_instrument_id=under.id if under else None,
            underlying_name=under.name if under else r["name"], underlying_isin=r.get("isin") or None,
            sector=(under.sector if under else r.get("sector") or None),
            asset_type=(r.get("asset_type") or "equity").lower(), weight=w, disclosure_date=disclosure_date,
            source=source[:160]))
    if errors and not rows:
        raise ValueError("; ".join(errors[:5]))
    db.execute(delete(FundHoldingSnapshot).where(FundHoldingSnapshot.scheme_id == scheme.id))
    db.add_all(rows)
    db.commit()
    return {"rows": len(rows), "errors": errors, "weight_sum": round(sum(r.weight for r in rows), 2)}


# ------------------------------------------------------------------ computation
def snapshots_for(db: Session, scheme_ids: list[int]) -> dict[int, list[FundHoldingSnapshot]]:
    out: dict[int, list[FundHoldingSnapshot]] = defaultdict(list)
    if scheme_ids:
        for s in db.scalars(select(FundHoldingSnapshot).where(FundHoldingSnapshot.scheme_id.in_(scheme_ids))):
            out[s.scheme_id].append(s)
    return out


def _key(s: FundHoldingSnapshot) -> str:
    if s.underlying_instrument_id:
        return f"i{s.underlying_instrument_id}"
    if s.underlying_isin:
        return f"isin:{s.underlying_isin}"
    return f"n:{_norm(s.underlying_name)}"


def overlap_pct(a: list[FundHoldingSnapshot], b: list[FundHoldingSnapshot]) -> tuple[float, list[dict]]:
    """Portfolio overlap = sum over common equity holdings of min(weight_a, weight_b)."""
    wa = {_key(x): x for x in a if x.asset_type == "equity" and "not itemised" not in x.underlying_name}
    wb = {_key(x): x for x in b if x.asset_type == "equity" and "not itemised" not in x.underlying_name}
    common = []
    for k in wa.keys() & wb.keys():
        common.append({"name": wa[k].underlying_name, "weight_a": wa[k].weight, "weight_b": wb[k].weight,
                       "min": min(wa[k].weight, wb[k].weight)})
    common.sort(key=lambda x: -x["min"])
    return sum(c["min"] for c in common), common


def compute_exposure(db: Session, pf: Portfolio, prefs: dict) -> dict:
    val = valuation(db, pf)
    holdings = [h for h in val["holdings"] if not h["closed"] and h["value"]]
    total = val["totals"]["value"]
    fund_rows = [h for h in holdings if h["instrument"]["asset_class"] in ("mf", "etf")]
    snaps = snapshots_for(db, [h["instrument"]["id"] for h in fund_rows])
    inst_by_id = {i.id: i for i in db.scalars(select(Instrument))}

    companies: dict[str, dict] = {}
    asset_mix: dict[str, float] = defaultdict(float)
    sectors: dict[str, float] = defaultdict(float)
    unitemised = 0.0
    coverage = []

    def bump(key: str, name: str, sector: str | None, symbol: str | None, value: float, via: str, kind: str) -> None:
        c = companies.setdefault(key, {"key": key, "name": name, "symbol": symbol, "sector": sector or "Unclassified",
                                       "direct": 0.0, "indirect": 0.0, "contributors": []})
        c["direct" if kind == "direct" else "indirect"] += value
        c["contributors"].append({"via": via, "value": value, "kind": kind})

    for h in holdings:
        inst = h["instrument"]
        cls = inst["asset_class"]
        v = h["value"]
        if cls == "equity":
            bump(f"i{inst['id']}", inst["name"], inst["sector"], inst["symbol"], v, "Direct holding", "direct")
            asset_mix["Equity"] += v
            sectors[inst["sector"] or "Unclassified"] += v
        elif cls in ("mf", "etf"):
            rows = snaps.get(inst["id"], [])
            if not rows:
                coverage.append({"holding_id": h["id"], "name": inst["name"], "covered": False,
                                 "disclosure_date": None, "source": None})
                label = "Gold" if inst.get("sector") == "Gold" else "Silver" if inst.get("sector") == "Silver" else \
                    "Debt & cash" if (inst.get("category") or "").startswith("Liquid") else "Fund (no look-through data)"
                asset_mix[label] += v
                unitemised += v if label.startswith("Fund") else 0
                continue
            wsum = sum(r.weight for r in rows)
            scale = 100.0 / wsum if wsum > 100.5 else 1.0  # never let exposure exceed holding value
            coverage.append({"holding_id": h["id"], "name": inst["name"], "covered": True,
                             "disclosure_date": rows[0].disclosure_date.isoformat(), "source": rows[0].source,
                             "weight_sum": round(wsum, 2)})
            for r in rows:
                part = v * r.weight / 100.0 * scale
                at = r.asset_type
                if at == "equity":
                    asset_mix["Equity"] += part
                    if "not itemised" in r.underlying_name:
                        unitemised += part
                        sectors["Not itemised"] += part
                        continue
                    under = inst_by_id.get(r.underlying_instrument_id) if r.underlying_instrument_id else None
                    bump(_key(r), r.underlying_name, r.sector, under.symbol if under else None, part,
                         inst["name"], "indirect")
                    sectors[r.sector or "Unclassified"] += part
                elif at in ("gold", "silver"):
                    asset_mix[at.title()] += part
                elif at == "debt":
                    asset_mix["Debt & cash"] += part
                else:
                    asset_mix["Debt & cash"] += part
            remainder = 100.0 - min(wsum, 100.0)
            if remainder > 0.01:
                asset_mix["Fund (undisclosed remainder)"] += v * remainder / 100.0
        elif cls in ("gold", "silver"):
            asset_mix[cls.title()] += v
        elif cls == "fd":
            asset_mix["Debt & cash"] += v
        else:
            asset_mix["Other"] += v

    comp_list = []
    for c in companies.values():
        c["total"] = c["direct"] + c["indirect"]
        c["pct"] = c["total"] / total * 100 if total else 0.0
        c["n_sources"] = len(c["contributors"])
        c["contributors"].sort(key=lambda x: -x["value"])
        comp_list.append(c)
    comp_list.sort(key=lambda x: -x["total"])
    sec_list = sorted(({"sector": k, "value": v, "pct": v / total * 100 if total else 0} for k, v in sectors.items()),
                      key=lambda x: -x["value"])
    mix = sorted(({"label": k, "value": v, "pct": v / total * 100 if total else 0} for k, v in asset_mix.items()),
                 key=lambda x: -x["value"])

    # overlap matrix among held funds with look-through data
    funds = [h for h in fund_rows if snaps.get(h["instrument"]["id"])]
    matrix, pairs = [], []
    for i, a in enumerate(funds):
        row = []
        for j, b in enumerate(funds):
            if i == j:
                row.append(100.0)
                continue
            pct, common = overlap_pct(snaps[a["instrument"]["id"]], snaps[b["instrument"]["id"]])
            row.append(round(pct, 2))
            if j > i:
                pairs.append({"a": a["instrument"]["name"], "b": b["instrument"]["name"], "overlap_pct": round(pct, 2),
                              "common": common[:10], "n_common": len(common)})
        matrix.append(row)
    pairs.sort(key=lambda x: -x["overlap_pct"])

    c_thr = float(prefs.get("company_threshold_pct", 10))
    s_thr = float(prefs.get("sector_threshold_pct", 30))
    flags = []
    for c in comp_list:
        if c["pct"] >= c_thr:
            flags.append({"type": "company", "name": c["name"], "pct": c["pct"], "threshold": c_thr,
                          "message": f"You effectively hold {c['pct']:.1f}% of your portfolio in {c['name']} "
                                     f"(direct + via {c['n_sources']} source(s)), above your {c_thr:g}% threshold."})
    for s in sec_list:
        if s["sector"] not in ("Not itemised", "Unclassified") and s["pct"] >= s_thr:
            flags.append({"type": "sector", "name": s["sector"], "pct": s["pct"], "threshold": s_thr,
                          "message": f"{s['sector']} is {s['pct']:.1f}% of your portfolio (estimated), above your "
                                     f"{s_thr:g}% sector threshold."})
    dq = dataquality.check_snapshots(db, {h["instrument"]["id"]: snaps[h["instrument"]["id"]] for h in funds})
    return {
        "total_value": total,
        "companies": comp_list[:100],
        "sectors": sec_list,
        "asset_mix": mix,
        "unitemised_value": unitemised,
        "unitemised_pct": unitemised / total * 100 if total else 0,
        "overlap": {"funds": [f["instrument"]["name"] for f in funds], "matrix": matrix, "pairs": pairs},
        "coverage": coverage,
        "flags": flags,
        "data_quality": dq,
        "thresholds": {"company_pct": c_thr, "sector_pct": s_thr},
        "method": ("Indirect exposure = your value in each fund x the fund's disclosed weight. Estimates are "
                   "snapshots as of each fund's disclosure date, not real-time positions."),
    }
