"""Company results / filing analysis.

Facts are extracted deterministically from the document text (with the matching source line kept
as evidence). Interpretation is generated separately — by Claude when configured and consented,
validated so it cannot introduce numbers absent from the extracted facts — otherwise by a template.
Missing figures are reported as missing, never invented.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import re

from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Filing, Instrument, utcnow
from . import llm

METRICS = [
    ("revenue", "Revenue from operations", [r"revenue\s+from\s+operations", r"net\s+sales", r"total\s+revenue"]),
    ("total_income", "Total income", [r"total\s+income"]),
    ("ebitda", "EBITDA", [r"\bebitda\b"]),
    ("pbt", "Profit before tax", [r"profit\s*/?\s*\(?loss\)?\s+before\s+tax", r"profit\s+before\s+tax"]),
    ("net_profit", "Net profit", [r"net\s+profit", r"profit\s+after\s+tax", r"profit\s*/?\s*\(?loss\)?\s+for\s+the\s+(period|quarter)",
                                   r"profit\s+for\s+the\s+(period|quarter)"]),
    ("eps", "Basic EPS", [r"basic\s+(eps|earnings\s+per\s+share)", r"earnings\s+per\s+share.*basic", r"\beps\b"]),
]
NUM = re.compile(r"\(?-?\d[\d,]*\.?\d*\)?")
RISK_WORDS = ["exceptional item", "impairment", "litigation", "contingent liabilit", "going concern", "qualified opinion",
              "provision", "default", "write-off", "write off", "penalty", "regulatory action"]


def extract_text(content: bytes, filename: str) -> str:
    if content[:5] == b"%PDF-":
        reader = PdfReader(io.BytesIO(content))
        if reader.is_encrypted:
            raise ValueError("Encrypted PDFs are not supported for filings; upload the exchange copy.")
        pages = [p.extract_text() or "" for p in reader.pages[:40]]
        text = "\n".join(pages)
        if len(text.strip()) < 50:
            raise ValueError("Could not extract text from this PDF (it may be a scanned image).")
        return text
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError as e:
        raise ValueError("Upload a PDF or plain-text file") from e


def _num(tok: str) -> float | None:
    neg = tok.startswith("(") and tok.endswith(")")
    t = tok.strip("()").replace(",", "")
    try:
        v = float(t)
    except ValueError:
        return None
    return -v if neg else v


def detect_unit(text: str) -> str:
    low = text.lower()
    for pat, unit in [(r"in\s+(₹|rs\.?|inr)?\s*crores?", "₹ crore"), (r"(₹|rs\.?|inr)\s*(in\s+)?crores?", "₹ crore"),
                      (r"in\s+(₹|rs\.?|inr)?\s*lakhs?", "₹ lakh"), (r"(₹|rs\.?|inr)\s*(in\s+)?lakhs?", "₹ lakh"),
                      (r"in\s+(₹|rs\.?|inr)?\s*millions?", "₹ million")]:
        if re.search(pat, low):
            return unit
    return "as reported (unit not detected)"


def extract_facts(text: str) -> dict:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    facts: dict[str, dict] = {}
    for key, label, pats in METRICS:
        for ln in lines:
            low = ln.lower()
            if any(re.search(p, low) for p in pats):
                label_end = max((m.end() for p in pats for m in [re.search(p, low)] if m), default=0)
                nums = [v for v in (_num(t) for t in NUM.findall(ln[label_end:])) if v is not None]
                nums = [v for v in nums if not (1900 <= abs(v) <= 2100 and float(v).is_integer() and len(nums) > 3)]
                if len(nums) >= 1:
                    facts[key] = {"label": label, "current": nums[0],
                                  "previous_quarter": nums[1] if len(nums) > 1 else None,
                                  "year_ago_quarter": nums[2] if len(nums) > 2 else None,
                                  "evidence": ln[:240]}
                    break
    for f in facts.values():
        c, p, y = f["current"], f["previous_quarter"], f["year_ago_quarter"]
        f["qoq_pct"] = round((c - p) / abs(p) * 100, 1) if p not in (None, 0) else None
        f["yoy_pct"] = round((c - y) / abs(y) * 100, 1) if y not in (None, 0) else None
    risks = []
    low = text.lower()
    for w in RISK_WORDS:
        i = low.find(w)
        if i >= 0:
            s = text[max(0, i - 80): i + 160].replace("\n", " ")
            risks.append({"term": w, "snippet": re.sub(r"\s+", " ", s).strip()})
    margin = None
    if "net_profit" in facts and "revenue" in facts and facts["revenue"]["current"]:
        margin = round(facts["net_profit"]["current"] / facts["revenue"]["current"] * 100, 1)
    period = None
    m = re.search(r"(quarter|three months|half year|year)\s+ended\s+([0-9]{1,2}(st|nd|rd|th)?\s+\w+,?\s+\d{4}|\w+\s+\d{1,2},?\s+\d{4})",
                  text, re.I)
    if m:
        period = m.group(0)
    return {"metrics": facts, "risk_mentions": risks[:6], "net_margin_pct": margin, "unit": detect_unit(text),
            "period": period,
            "column_assumption": "Numbers read left-to-right as: current quarter, previous quarter, "
                                 "year-ago quarter. Verify against the source table.",
            "missing": [lbl for k, lbl, _ in METRICS if k not in facts]}


def template_summary(issuer: str, facts: dict) -> str:
    m = facts["metrics"]
    parts = []
    unit = facts["unit"]
    for key in ("revenue", "net_profit", "eps"):
        f = m.get(key)
        if not f:
            continue
        s = f"{f['label']} was {f['current']:,.2f} ({unit if key != 'eps' else '₹ per share'})"
        ch = []
        if f["yoy_pct"] is not None:
            ch.append(f"{'up' if f['yoy_pct'] >= 0 else 'down'} {abs(f['yoy_pct']):.1f}% from the year-ago quarter")
        if f["qoq_pct"] is not None:
            ch.append(f"{'up' if f['qoq_pct'] >= 0 else 'down'} {abs(f['qoq_pct']):.1f}% from the previous quarter")
        parts.append(s + (", " + " and ".join(ch) if ch else "") + ".")
    if facts.get("net_margin_pct") is not None:
        parts.append(f"Net profit was {facts['net_margin_pct']:.1f}% of revenue this quarter.")
    if facts["risk_mentions"]:
        parts.append("The document mentions: " + ", ".join(sorted({r["term"] for r in facts["risk_mentions"]})) +
                     " — read those sections in the source for context.")
    if facts["missing"]:
        parts.append("Not found in the document text: " + ", ".join(facts["missing"]) + ".")
    if not parts:
        return f"FinLex could not find standard result line items in this {issuer} document."
    return " ".join(parts)


SYSTEM = ("You explain Indian company quarterly results in plain English for retail investors. Use ONLY the "
          "facts provided. Do not add numbers that are not in the facts. Do not give buy/sell/hold views, price "
          "targets or predictions. Keep it under 150 words, neutral tone, and mention that figures should be "
          "verified against the source filing.")


def analyse(db: Session, *, user_id: int | None, issuer: str, text: str, source_uri: str = "",
            period: str = "", instrument: Instrument | None = None, use_llm: bool = False,
            is_sample: bool = False) -> Filing:
    checksum = hashlib.sha256(text.encode()).hexdigest()
    existing = db.scalar(select(Filing).where(Filing.checksum == checksum, Filing.user_id == user_id))
    if existing:
        return existing
    facts = extract_facts(text)
    tmpl = template_summary(issuer, facts)
    ai = None
    if use_llm:
        ai = llm.summarise_facts(SYSTEM, json.dumps({"issuer": issuer, **facts}, default=str),
                                 "Write a short plain-language explanation of these results.")
    f = Filing(user_id=user_id, instrument_id=instrument.id if instrument else None, issuer=issuer[:255],
               period=(period or facts.get("period") or "")[:64], published_at=utcnow(), source_uri=source_uri[:500],
               checksum=checksum, text=text[:200_000], facts=facts,
               summary={"reported": tmpl, "interpretation": ai, "interpretation_engine": "claude" if ai else None,
                        "generated_at": dt.datetime.now(dt.UTC).isoformat()},
               is_sample=is_sample)
    db.add(f)
    db.commit()
    return f


SAMPLE_TEXT = """DEMO INDUSTRIES LIMITED  (synthetic sample document — not a real company or filing)
Statement of Standalone Unaudited Financial Results for the Quarter ended 30 September 2026
(Rs. in Crores)
Particulars  Quarter ended 30.09.2026  Quarter ended 30.06.2026  Quarter ended 30.09.2025
Revenue from operations  4,820.50  4,512.30  4,210.75
Other income  85.20  70.10  66.40
Total income  4,905.70  4,582.40  4,277.15
EBITDA  912.40  861.05  780.30
Profit before tax  702.15  655.80  598.60
Net profit for the period  525.30  488.90  452.10
Basic EPS (Rs.)  13.13  12.22  11.30
Notes: An exceptional item relating to impairment of an investment in a subsidiary of Rs. 12.40 crore was
recognised during the quarter. The company is party to litigation in the ordinary course of business; no
material contingent liabilities are expected.
"""


def ensure_sample(db: Session) -> None:
    if db.scalar(select(Filing.id).where(Filing.is_sample.is_(True)).limit(1)):
        return
    analyse(db, user_id=None, issuer="Demo Industries Ltd (synthetic sample)", text=SAMPLE_TEXT,
            source_uri="", period="Q2 FY27 (sample)", is_sample=True)


def filing_dict(f: Filing, full: bool = False) -> dict:
    d = {"id": f.id, "issuer": f.issuer, "exchange": f.exchange, "filing_type": f.filing_type, "period": f.period,
         "published_at": f.published_at.isoformat() + "Z" if f.published_at else None, "source_uri": f.source_uri,
         "checksum": f.checksum, "facts": f.facts, "summary": f.summary, "is_sample": f.is_sample,
         "instrument_id": f.instrument_id, "private": f.user_id is not None}
    if full:
        d["text_excerpt"] = f.text[:4000]
    return d
