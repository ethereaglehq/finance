"""Market-data ingestion with provenance.

Providers
---------
* ``yahoo``   - Yahoo Finance chart API (NSE/BSE equities, indices, ETFs, COMEX futures, USD/INR).
                Intraday quotes are delayed (typically up to ~15 min for NSE); daily bars are used.
* ``mfapi``   - mfapi.in mirror of AMFI daily NAV history (end-of-day NAV).
* ``derived`` - Gold/silver INR reference series computed from COMEX futures x USD/INR.
* ``synthetic`` - deterministic simulated series, used only when live data is unavailable or the
                  deployment runs in offline/demo mode. Always labelled "Synthetic" in the UI.

Every stored price row records its source; every quote records an as-of timestamp and delay note.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import logging
import math
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

from urllib.parse import quote

import httpx
import numpy as np
import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Instrument, PriceObservation, Quote, SourceStatus, utcnow
from ..seed import instruments as seed

log = logging.getLogger("finlex.market")
IST = ZoneInfo("Asia/Kolkata")
UA = {"User-Agent": "Mozilla/5.0 (FinLex market-data client)", "Accept": "application/json,text/plain,*/*"}

TROY_OZ_G = 31.1034768

SOURCE_LABELS = {
    "yahoo": "Yahoo Finance (NSE/BSE, delayed)",
    "mfapi": "AMFI NAV via mfapi.in (end of day)",
    "derived": "COMEX futures × USD/INR via Yahoo Finance (international reference)",
    "synthetic": "Synthetic demo series (not market data)",
}
DELAY_NOTES = {
    "yahoo": "Delayed up to ~15 min; daily close after market hours",
    "mfapi": "End-of-day NAV, published next morning",
    "derived": "Delayed; excludes Indian import duty, GST and dealer premium",
    "synthetic": "Simulated — not a real price",
}


def today_ist() -> dt.date:
    return dt.datetime.now(IST).date()


# ------------------------------------------------------------------ instrument master
def ensure_instruments(db: Session) -> None:
    """Idempotently upsert the seed instrument master."""
    existing = {i.symbol: i for i in db.scalars(select(Instrument))}

    def upsert(symbol: str, **kw) -> None:
        inst = existing.get(symbol)
        if inst is None:
            inst = Instrument(symbol=symbol, **kw)
            db.add(inst)
            existing[symbol] = inst
        else:
            for k, v in kw.items():
                if k == "meta":
                    inst.meta = {**(inst.meta or {}), **v}
                else:
                    setattr(inst, k, v)

    for sym, name, industry, isin, ref in seed.NIFTY50:
        upsert(sym, name=name, asset_class="equity", exchange="NSE", isin=isin, sector=industry,
               category="Large cap", provider="yahoo", provider_symbol=f"{sym}.NS", unit="share",
               in_universe=True, meta={"ref_price": ref, "nifty50": True})
    for sym, name, industry, cap, ref in seed.OTHER_EQUITIES:
        upsert(sym, name=name, asset_class="equity", exchange="NSE", sector=industry, category=cap,
               provider="yahoo", provider_symbol=f"{sym}.NS", unit="share", in_universe=True,
               meta={"ref_price": ref})
    for sym, name, ysym, ref in seed.INDICES:
        upsert(sym, name=name, asset_class="index", exchange="NSE" if sym != "SENSEX" else "BSE",
               provider="yahoo", provider_symbol=ysym, unit="points", in_universe=True,
               meta={"ref_price": ref})
    for sym, name, ysym, underlying, ref in seed.ETFS:
        upsert(sym, name=name, asset_class="etf", exchange="NSE", provider="yahoo", provider_symbol=ysym,
               category={"gold": "Gold ETF", "silver": "Silver ETF"}.get(underlying, "Index ETF"),
               sector={"gold": "Gold", "silver": "Silver"}.get(underlying), unit="unit", in_universe=True,
               meta={"ref_price": ref, "underlying": underlying})
    for sym, name, cls, unit, ref in seed.METALS:
        upsert(sym, name=name, asset_class=cls, exchange="REF", provider="derived", provider_symbol=sym,
               unit=unit, sector=cls.title(), in_universe=True, meta={"ref_price": ref})
    for code, name, cat, ref in seed.MUTUAL_FUNDS:
        upsert(f"MF{code}", name=name, asset_class="mf", exchange="AMFI", amfi_code=code, category=cat,
               provider="mfapi", provider_symbol=code, unit="unit", in_universe=False,
               meta={"ref_price": ref})
    upsert("FD", name="Fixed deposit", asset_class="fd", exchange="-", provider="none", unit="INR",
           meta={})
    db.commit()


def create_mf_instrument(db: Session, code: str, name: str, isin: str | None = None,
                         category: str | None = None) -> Instrument:
    sym = f"MF{code}"
    inst = db.scalar(select(Instrument).where(Instrument.symbol == sym))
    if inst:
        return inst
    inst = Instrument(symbol=sym, name=name, asset_class="mf", exchange="AMFI", amfi_code=code, isin=isin,
                      category=category or "Mutual fund", provider="mfapi", provider_symbol=code, unit="unit",
                      meta={"ref_price": 100})
    db.add(inst)
    db.commit()
    return inst


# ------------------------------------------------------------------ providers
def _client() -> httpx.Client:
    return httpx.Client(timeout=get_settings().http_timeout, headers=UA, follow_redirects=True)


def fetch_yahoo(symbol: str, range_: str = "5y") -> pd.DataFrame:
    url = "https://query1.finance.yahoo.com/v8/finance/chart/" + quote(symbol, safe="")
    with _client() as c:
        r = c.get(url, params={"range": range_, "interval": "1d", "includeAdjustedClose": "true"})
    r.raise_for_status()
    data = r.json()["chart"]
    if not data.get("result"):
        raise ValueError(f"Yahoo returned no data for {symbol}: {data.get('error')}")
    res = data["result"][0]
    ts = res.get("timestamp") or []
    tz = ZoneInfo(res["meta"].get("exchangeTimezoneName") or "UTC")
    q = res["indicators"]["quote"][0]
    adj = (res["indicators"].get("adjclose") or [{}])[0].get("adjclose") or q.get("close")
    df = pd.DataFrame({
        "date": [dt.datetime.fromtimestamp(t, tz).date() for t in ts],
        "close": q.get("close"),
        "adj_close": adj,
    }).dropna()
    df = df[(df["close"] > 0)].drop_duplicates("date", keep="last").sort_values("date")
    meta = res["meta"]
    df.attrs["quote"] = {
        "price": meta.get("regularMarketPrice"),
        "time": meta.get("regularMarketTime"),
        "name": meta.get("longName") or meta.get("shortName"),
        "currency": meta.get("currency"),
    }
    return df


def fetch_mfapi(code: str) -> pd.DataFrame:
    with _client() as c:
        r = c.get(f"https://api.mfapi.in/mf/{code}")
    r.raise_for_status()
    payload = r.json()
    rows = payload.get("data") or []
    if not rows:
        raise ValueError(f"mfapi returned no NAVs for {code}")
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"], format="%d-%m-%Y").dt.date
    df["close"] = pd.to_numeric(df["nav"], errors="coerce")
    df = df.dropna(subset=["close"])
    df = df[df["close"] > 0].sort_values("date").drop_duplicates("date", keep="last")
    df["adj_close"] = df["close"]
    cutoff = today_ist() - dt.timedelta(days=365 * get_settings().history_years + 10)
    df = df[df["date"] >= cutoff][["date", "close", "adj_close"]]
    df.attrs["meta"] = payload.get("meta", {})
    return df.reset_index(drop=True)


def fetch_metal(kind: str) -> pd.DataFrame:
    fut = "GC=F" if kind == "GOLD" else "SI=F"
    rng = f"{get_settings().history_years}y"
    f = fetch_yahoo(fut, rng).set_index("date")["close"]
    fx = fetch_yahoo("USDINR=X", rng).set_index("date")["close"]
    idx = sorted(set(f.index))
    fx = fx.reindex(sorted(set(fx.index) | set(idx))).ffill().reindex(idx)
    per_gram = f.reindex(idx) * fx / TROY_OZ_G
    factor = 10.0 if kind == "GOLD" else 1000.0
    s = (per_gram * factor).dropna()
    return pd.DataFrame({"date": s.index, "close": s.values, "adj_close": s.values})


# ------------------------------------------------------------------ synthetic generator
def _bdays(end: dt.date, years: int) -> list[dt.date]:
    start = end - dt.timedelta(days=int(365.25 * years))
    return [d.date() for d in pd.bdate_range(start, end)]


_MARKET_CACHE: dict[tuple, np.ndarray] = {}


def _market_factor(n: int, end: dt.date) -> np.ndarray:
    key = (n, end)
    if key not in _MARKET_CACHE:
        rng = np.random.default_rng(20240601)
        vol = np.empty(n)
        v = 0.012
        for i in range(n):  # persistent volatility regimes
            v = 0.97 * v + 0.03 * 0.011 + 0.002 * rng.standard_normal() * 0.3
            vol[i] = max(0.005, v)
        _MARKET_CACHE[key] = rng.standard_t(5, n) / math.sqrt(5 / 3) * vol
    return _MARKET_CACHE[key]


def synthetic_series(inst: Instrument, end: dt.date | None = None, years: int | None = None) -> pd.DataFrame:
    end = end or today_ist()
    years = years or get_settings().history_years
    dates = _bdays(end, years)
    n = len(dates)
    seed_ = zlib.crc32(inst.symbol.encode())
    rng = np.random.default_rng(seed_)
    cls = inst.asset_class
    if cls == "mf":
        mu, sigma = seed.MF_SYNTH.get(inst.category or "", seed.SYNTH_PARAMS["mf"])
    else:
        mu, sigma = seed.SYNTH_PARAMS.get(cls, (0.1, 0.2))
    mu += rng.normal(0, 0.03) if cls == "equity" else 0.0
    beta = {"equity": rng.uniform(0.7, 1.3), "index": 1.0, "mf": 0.9, "etf": 0.0, "gold": -0.1, "silver": 0.1}.get(cls, 0.5)
    if cls == "etf" and (inst.meta or {}).get("underlying") == "equity":
        beta = 1.0
    if (inst.category or "") == "Liquid":
        beta = 0.0
    mkt = _market_factor(n, end) * beta
    idio_sigma = math.sqrt(max(sigma**2 - (beta * 0.011 * math.sqrt(252)) ** 2, (0.3 * sigma) ** 2)) / math.sqrt(252)
    shocks = rng.standard_t(5, n) / math.sqrt(5 / 3) * idio_sigma
    rets = mu / 252 - 0.5 * (sigma**2) / 252 + mkt + shocks
    rets[0] = 0.0
    path = np.exp(np.cumsum(rets))
    ref = float((inst.meta or {}).get("ref_price") or 100.0)
    prices = path / path[-1] * ref
    return pd.DataFrame({"date": dates, "close": prices, "adj_close": prices})


# ------------------------------------------------------------------ persistence
def _source_key(inst: Instrument) -> str:
    return inst.provider if inst.provider in ("yahoo", "mfapi", "derived") else "synthetic"


def fetch_live(inst: Instrument, range_: str | None = None) -> pd.DataFrame:
    rng = range_ or f"{get_settings().history_years}y"
    if inst.provider == "yahoo":
        return fetch_yahoo(inst.provider_symbol or f"{inst.symbol}.NS", rng)
    if inst.provider == "mfapi":
        return fetch_mfapi(inst.provider_symbol or inst.amfi_code or "")
    if inst.provider == "derived":
        return fetch_metal(inst.symbol)
    raise ValueError(f"No provider for {inst.symbol}")


def store_series(db: Session, inst: Instrument, df: pd.DataFrame, source: str) -> int:
    if df.empty:
        return 0
    label = SOURCE_LABELS[source]
    existing = {
        p.date: p for p in db.scalars(select(PriceObservation).where(PriceObservation.instrument_id == inst.id))
    }
    now = utcnow()
    n = 0
    for row in df.itertuples(index=False):
        p = existing.get(row.date)
        if p is None:
            db.add(PriceObservation(instrument_id=inst.id, date=row.date, close=float(row.close),
                                    adj_close=float(row.adj_close), source=label, fetched_at=now))
            n += 1
        elif p.source != label or abs(p.close - float(row.close)) > 1e-9:
            p.close, p.adj_close, p.source, p.fetched_at = float(row.close), float(row.adj_close), label, now
            n += 1
    # if we replaced synthetic with live data, drop leftover synthetic rows outside the live range
    if source != "synthetic":
        live_dates = set(df["date"])
        for d, p in existing.items():
            if d not in live_dates and p.source == SOURCE_LABELS["synthetic"]:
                db.delete(p)
    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else last
    q = db.get(Quote, inst.id)
    qinfo = df.attrs.get("quote") or {}
    price = float(qinfo.get("price") or last["close"])
    prev_close = float(prev["close"])
    if qinfo.get("time"):
        qt = dt.datetime.fromtimestamp(qinfo["time"], dt.UTC)
        as_of = qt.replace(tzinfo=None)
        if qt.astimezone(IST).date() > last["date"]:  # quote newer than the last daily bar
            prev_close = float(last["close"])
    else:
        # EOD sources: stamp at 15:30 IST (market close) of the bar date
        as_of = (dt.datetime.combine(last["date"], dt.time(15, 30), IST).astimezone(dt.UTC).replace(tzinfo=None))
    vals = dict(price=price, prev_close=prev_close, as_of=as_of, source=label,
                delay_note=DELAY_NOTES[source], fetched_at=now)
    if q is None:
        db.add(Quote(instrument_id=inst.id, **vals))
    else:
        for k, v in vals.items():
            setattr(q, k, v)
    return n


def mark_source(db: Session, key: str, ok: bool, items: int = 0, error: str = "") -> None:
    st = db.get(SourceStatus, key)
    if st is None:
        st = SourceStatus(key=key)
        db.add(st)
        db.flush()
    if ok:
        st.last_success_at = utcnow()
        st.items = items
    else:
        st.last_error_at = utcnow()
        st.last_error = error[:500]


def refresh_instruments(db: Session, instruments: list[Instrument], range_: str | None = None,
                        mode: str | None = None) -> dict:
    """Fetch & store history for instruments. Network calls run in a thread pool."""
    mode = mode or get_settings().market_data_mode
    results: dict[int, tuple[str, pd.DataFrame | None, str]] = {}
    live_targets = [i for i in instruments if i.provider in ("yahoo", "mfapi", "derived")]

    if mode != "synthetic" and live_targets:
        def work(inst: Instrument):
            try:
                return inst.id, ("ok", fetch_live(inst, range_), "")
            except Exception as e:  # noqa: BLE001
                return inst.id, ("err", None, f"{type(e).__name__}: {e}")
        with ThreadPoolExecutor(max_workers=8) as pool:
            for iid, res in pool.map(work, live_targets):
                results[iid] = res

    summary = {"live": 0, "synthetic": 0, "failed": 0, "errors": {}}
    for inst in instruments:
        if inst.provider == "none":
            continue
        status, df, err = results.get(inst.id, ("skip", None, ""))
        if status == "ok" and df is not None and len(df) > 5:
            store_series(db, inst, df, _source_key(inst))
            mark_source(db, _source_key(inst), True, len(df))
            summary["live"] += 1
            continue
        if status == "err":
            summary["errors"][inst.symbol] = err
            mark_source(db, _source_key(inst), False, error=f"{inst.symbol}: {err}")
        if mode == "live":
            summary["failed"] += 1
            continue
        has_live = db.scalar(select(func.count()).select_from(PriceObservation).where(
            PriceObservation.instrument_id == inst.id,
            PriceObservation.source != SOURCE_LABELS["synthetic"]))
        if has_live:
            summary["failed"] += 1  # keep stale live data rather than overwrite with synthetic
            continue
        store_series(db, inst, synthetic_series(inst), "synthetic")
        summary["synthetic"] += 1
    db.commit()
    return summary


_refresh_lock = threading.Lock()


def bootstrap_market_data(db: Session, force: bool = False) -> dict:
    """Load full history for every instrument that has none (or all, if force)."""
    with _refresh_lock:
        insts = list(db.scalars(select(Instrument).where(Instrument.provider != "none")))
        counts = dict(db.execute(select(PriceObservation.instrument_id, func.count())
                                 .group_by(PriceObservation.instrument_id)).all())
        targets = insts if force else [i for i in insts if counts.get(i.id, 0) < 30]
        if not targets:
            return {"live": 0, "synthetic": 0, "failed": 0, "errors": {}}
        return refresh_instruments(db, targets)


def refresh_recent(db: Session, instruments: list[Instrument] | None = None) -> dict:
    """Quote refresh: re-fetch the last month for instruments that use live providers."""
    with _refresh_lock:
        insts = instruments or list(db.scalars(select(Instrument).where(Instrument.provider != "none")))
        mode = get_settings().market_data_mode
        if mode == "synthetic":
            return {"live": 0, "synthetic": 0, "failed": 0, "errors": {}}
        live = []
        for i in insts:
            if i.provider == "derived":
                live.append(i)
                continue
            src = db.scalar(select(PriceObservation.source).where(PriceObservation.instrument_id == i.id)
                            .order_by(PriceObservation.date.desc()).limit(1))
            if src != SOURCE_LABELS["synthetic"]:
                live.append(i)
        rng = "1mo"
        summary = {"live": 0, "synthetic": 0, "failed": 0, "errors": {}}
        derived = [i for i in live if i.provider == "derived"]
        others = [i for i in live if i.provider != "derived"]
        if others:
            s = refresh_instruments(db, others, range_=rng, mode="live")
            for k in ("live", "failed"):
                summary[k] += s[k]
            summary["errors"].update(s["errors"])
        if derived:
            s = refresh_instruments(db, derived, mode="live")
            summary["live"] += s["live"]
        return summary


# ------------------------------------------------------------------ queries
def get_series(db: Session, instrument_id: int, start: dt.date | None = None, adjusted: bool = True) -> pd.Series:
    q = select(PriceObservation.date, PriceObservation.adj_close if adjusted else PriceObservation.close).where(
        PriceObservation.instrument_id == instrument_id)
    if start:
        q = q.where(PriceObservation.date >= start)
    rows = db.execute(q.order_by(PriceObservation.date)).all()
    if not rows:
        return pd.Series(dtype=float)
    s = pd.Series([r[1] for r in rows], index=pd.to_datetime([r[0] for r in rows]), dtype=float)
    return s[~s.index.duplicated(keep="last")]


def series_source(db: Session, instrument_id: int) -> str | None:
    return db.scalar(select(PriceObservation.source).where(PriceObservation.instrument_id == instrument_id)
                     .order_by(PriceObservation.date.desc()).limit(1))


def latest_quote(db: Session, inst: Instrument) -> dict | None:
    q = db.get(Quote, inst.id)
    if q is None:
        last = db.execute(select(PriceObservation).where(PriceObservation.instrument_id == inst.id)
                          .order_by(PriceObservation.date.desc()).limit(2)).scalars().all()
        if not last:
            return None
        price = last[0].close
        prev = last[1].close if len(last) > 1 else price
        as_of = dt.datetime.combine(last[0].date, dt.time(10, 0))
        source, delay = last[0].source, ""
    else:
        price, prev, as_of, source, delay = q.price, q.prev_close or q.price, q.as_of, q.source, q.delay_note
    change = price - prev
    stale_days = (utcnow() - as_of).days
    return {
        "price": price,
        "prev_close": prev,
        "change": change,
        "change_pct": (change / prev * 100) if prev else 0.0,
        "as_of": as_of.isoformat() + "Z",
        "source": source,
        "delay_note": delay,
        "synthetic": source == SOURCE_LABELS["synthetic"],
        "stale": stale_days > 4,
    }


def dataset_hash(s: pd.Series) -> str:
    h = hashlib.sha256()
    h.update(np.asarray(s.index.astype("int64")).tobytes())
    h.update(np.round(s.values.astype(float), 6).tobytes())
    return h.hexdigest()[:16]


# ------------------------------------------------------------------ AMFI scheme search
_AMFI_CACHE: dict = {"at": 0.0, "rows": []}


def amfi_schemes() -> list[dict]:
    if time.time() - _AMFI_CACHE["at"] < 12 * 3600 and _AMFI_CACHE["rows"]:
        return _AMFI_CACHE["rows"]
    rows: list[dict] = []
    if get_settings().market_data_mode != "synthetic":
        try:
            with _client() as c:
                r = c.get("https://portal.amfiindia.com/spages/NAVAll.txt")
            r.raise_for_status()
            for line in r.text.splitlines():
                parts = [p.strip() for p in line.split(";")]
                if len(parts) < 6 or not parts[0].isdigit():
                    continue
                if len(parts) >= 8:  # code;isin_growth;isin_reinv;name;plan;option;nav;date
                    name = " - ".join(p for p in parts[3:-2] if p and p != "-")
                else:  # legacy: code;isin_growth;isin_reinv;name;nav;date
                    name = parts[3]
                isin = next((p for p in parts[1:3] if p and p != "-"), None)
                rows.append({"code": parts[0], "isin": isin, "name": name, "nav": parts[-2], "date": parts[-1]})
        except Exception as e:  # noqa: BLE001
            log.warning("AMFI scheme list unavailable: %s", e)
    if rows:
        _AMFI_CACHE.update(at=time.time(), rows=rows)
    return rows
