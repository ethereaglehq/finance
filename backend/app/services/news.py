"""News ingestion (RSS) with deduplication, entity mapping and tone classification."""
from __future__ import annotations

import calendar
import datetime as dt
import hashlib
import logging
import re

import feedparser
import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Instrument, NewsItem, utcnow
from . import marketdata as md
from . import sentiment

log = logging.getLogger("finlex.news")

PUBLISHERS = {
    "economictimes.indiatimes.com": "The Economic Times",
    "moneycontrol.com": "Moneycontrol",
    "livemint.com": "Mint",
    "business-standard.com": "Business Standard",
}

# Clearly-labelled sample headlines used only when live feeds are disabled/unreachable.
SAMPLE_HEADLINES = [
    ("Benchmark indices end higher as banking stocks rally", "NIFTY50"),
    ("IT shares slip as global technology stocks weaken", "NIFTYIT"),
    ("Gold climbs as investors seek safe-haven assets", "GOLD"),
    ("Silver drops as dollar strengthens", "SILVER"),
    ("Bank Nifty gains for third straight session on credit growth optimism", "BANKNIFTY"),
    ("Markets end flat ahead of inflation data", "NIFTY50"),
    ("Auto stocks advance on strong festive-season demand", None),
    ("Metal stocks fall on weak global cues", None),
]

ALIASES_EXTRA = {
    "nifty": "NIFTY50", "sensex": "SENSEX", "bank nifty": "BANKNIFTY", "nifty bank": "BANKNIFTY",
    "nifty it": "NIFTYIT", "gold": "GOLD", "silver": "SILVER", "ril": "RELIANCE", "sbi": "SBIN",
    "l&t": "LT", "hul": "HINDUNILVR", "m&m": "M&M", "airtel": "BHARTIARTL", "tata motors": "TMPV",
    "zomato": "ETERNAL", "infosys": "INFY", "tcs": "TCS", "hdfc bank": "HDFCBANK", "icici bank": "ICICIBANK",
}


def _aliases(db: Session) -> dict[str, str]:
    out = dict(ALIASES_EXTRA)
    for i in db.scalars(select(Instrument).where(Instrument.asset_class == "equity")):
        base = re.sub(r"\b(ltd|limited|the|co|company|corporation|of india|india|industries)\b\.?", "",
                      i.name.lower())
        base = re.sub(r"[^a-z0-9& ]+", " ", base).strip()
        base = re.sub(r"\s+", " ", base)
        if len(base) >= 4:
            out.setdefault(base, i.symbol)
        if len(i.symbol) >= 4 and i.symbol.isalpha():
            out.setdefault(i.symbol.lower(), i.symbol)
    return out


def map_entities(text: str, aliases: dict[str, str]) -> list[str]:
    low = " " + re.sub(r"[^a-z0-9& ]+", " ", text.lower()) + " "
    found = []
    for alias in sorted(aliases, key=len, reverse=True):
        if f" {alias} " in low:
            sym = aliases[alias]
            if sym not in found:
                found.append(sym)
            low = low.replace(f" {alias} ", " ")
    return found[:6]


def _dedup_key(headline: str) -> str:
    norm = re.sub(r"[^a-z0-9]+", " ", headline.lower()).strip()
    return hashlib.sha256(norm.encode()).hexdigest()[:32]


def _publisher(url: str, fallback: str) -> str:
    for dom, name in PUBLISHERS.items():
        if dom in url:
            return name
    return fallback or "Unknown publisher"


def ingest(db: Session) -> dict:
    feeds = [f.strip() for f in get_settings().news_feeds.split(",") if f.strip()]
    aliases = _aliases(db)
    added, errors = 0, []
    if get_settings().market_data_mode == "synthetic":
        feeds = []
    for url in feeds:
        try:
            with httpx.Client(timeout=get_settings().http_timeout, headers=md.UA, follow_redirects=True) as c:
                r = c.get(url)
            r.raise_for_status()
            parsed = feedparser.parse(r.content)
            for e in parsed.entries[:60]:
                title = re.sub(r"\s+", " ", (e.get("title") or "")).strip()
                if not title:
                    continue
                key = _dedup_key(title)
                if db.scalar(select(NewsItem.id).where(NewsItem.dedup_key == key)):
                    continue
                ts = e.get("published_parsed") or e.get("updated_parsed")
                pub = dt.datetime.fromtimestamp(calendar.timegm(ts), dt.UTC).replace(tzinfo=None) if ts else utcnow()
                summary = re.sub(r"<[^>]+>", " ", e.get("summary") or "")
                summary = re.sub(r"\s+", " ", summary).strip()[:600]
                s = sentiment.classify(title)
                db.add(NewsItem(publisher=_publisher(e.get("link", ""), parsed.feed.get("title", "")),
                                headline=title[:500], summary=summary, url=(e.get("link") or "")[:800],
                                published_at=pub, entities=map_entities(f"{title} {summary}", aliases),
                                sentiment_label=s["label"], sentiment_score=s["score"], sentiment_model=s["model"],
                                dedup_key=key, is_sample=False))
                added += 1
            md.mark_source(db, "news", True, added)
        except Exception as ex:  # noqa: BLE001
            errors.append(f"{url}: {ex}")
            md.mark_source(db, "news", False, error=str(ex))
    has_live = db.scalar(select(NewsItem.id).where(NewsItem.is_sample.is_(False)).limit(1))
    if not has_live:
        _ensure_samples(db, aliases)
    db.commit()
    return {"added": added, "errors": errors}


def _ensure_samples(db: Session, aliases: dict[str, str]) -> None:
    if db.scalar(select(NewsItem.id).where(NewsItem.is_sample.is_(True)).limit(1)):
        return
    now = utcnow()
    for k, (title, sym) in enumerate(SAMPLE_HEADLINES):
        s = sentiment.classify(title)
        ents = map_entities(title, aliases)
        if sym and sym not in ents:
            ents.insert(0, sym)
        db.add(NewsItem(publisher="FinLex sample feed", headline=title, summary="Sample headline for offline demo.",
                        url="", published_at=now - dt.timedelta(hours=2 * k), entities=ents,
                        sentiment_label=s["label"], sentiment_score=s["score"], sentiment_model=s["model"],
                        dedup_key=_dedup_key("sample " + title), is_sample=True))


def recent(db: Session, hours: int = 72, symbol: str | None = None, limit: int = 60) -> list[NewsItem]:
    since = utcnow() - dt.timedelta(hours=hours)
    q = select(NewsItem).where(NewsItem.published_at >= since)
    live_exists = db.scalar(select(NewsItem.id).where(NewsItem.is_sample.is_(False)).limit(1))
    if live_exists:
        q = q.where(NewsItem.is_sample.is_(False))
    items = list(db.scalars(q.order_by(NewsItem.published_at.desc()).limit(500)))
    if not items:
        items = list(db.scalars(select(NewsItem).order_by(NewsItem.published_at.desc()).limit(limit)))
    if symbol:
        items = [n for n in items if symbol in (n.entities or [])]
    return items[:limit]


def news_dict(n: NewsItem) -> dict:
    return {"id": n.id, "publisher": n.publisher, "headline": n.headline, "summary": n.summary, "url": n.url,
            "published_at": n.published_at.isoformat() + "Z", "entities": n.entities,
            "sentiment": {"label": n.sentiment_label, "score": n.sentiment_score, "model": n.sentiment_model},
            "is_sample": n.is_sample}


def mood(items: list[NewsItem]) -> dict:
    if not items:
        return {"label": "neutral", "score": 0.0, "n": 0, "counts": {"positive": 0, "neutral": 0, "negative": 0}}
    counts = {"positive": 0, "neutral": 0, "negative": 0}
    for n in items:
        counts[n.sentiment_label] = counts.get(n.sentiment_label, 0) + 1
    avg = sum(n.sentiment_score for n in items) / len(items)
    label = "positive" if avg > 0.1 else "negative" if avg < -0.1 else "neutral"
    return {"label": label, "score": round(avg, 3), "n": len(items), "counts": counts,
            "score_0_100": round((avg + 1) * 50)}
