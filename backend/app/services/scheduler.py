"""Background jobs: price refresh, forecast scoring/issuance, news ingestion, alerts, cleanup.

A single in-process scheduler thread (disable with FINLEX_SCHEDULER_ENABLED=false when running
several API replicas, and run `python -m app.cli jobs` from cron instead).
"""
from __future__ import annotations

import datetime as dt
import logging
import threading
import time
import traceback

from sqlalchemy import delete, select

from ..config import get_settings
from ..db import SessionLocal
from ..models import JobRun, User, utcnow
from . import alerts, filings, marketdata, news, trackrecord

log = logging.getLogger("finlex.scheduler")
_state = {"bootstrapped": False, "bootstrapping": False, "prices_ready": False, "last": {}}
_stop = threading.Event()


def _run(job: str, fn) -> str:
    db = SessionLocal()
    run = JobRun(job=job, started_at=utcnow())
    db.add(run)
    db.commit()
    try:
        detail = fn(db)
        run.status, run.detail = "ok", str(detail)[:4000]
    except Exception as e:  # noqa: BLE001
        db.rollback()
        run.status, run.detail = "error", f"{e}\n{traceback.format_exc()[-1500:]}"
        log.exception("job %s failed", job)
    run.finished_at = utcnow()
    db.merge(run)
    db.commit()
    db.close()
    _state["last"][job] = {"at": utcnow().isoformat() + "Z", "status": run.status}
    return run.status


def job_bootstrap(db) -> dict:
    out = {"market": marketdata.bootstrap_market_data(db)}
    _state["prices_ready"] = True
    out["backtests"] = trackrecord.ensure_backtests(db)
    out["live_forecasts"] = trackrecord.issue_core_forecasts(db)
    out["scored"] = trackrecord.score_matured(db)
    out["news"] = news.ingest(db)
    filings.ensure_sample(db)
    return out


def job_refresh(db) -> dict:
    out = {"market": marketdata.refresh_recent(db)}
    out["scored"] = trackrecord.score_matured(db)
    out["alerts"] = alerts.evaluate_all(db)
    return out


def job_daily(db) -> dict:
    out = {"issued": trackrecord.issue_core_forecasts(db), "scored": trackrecord.score_matured(db)}
    ttl = get_settings().demo_user_ttl_hours
    cutoff = utcnow() - dt.timedelta(hours=ttl)
    old = list(db.scalars(select(User.id).where(User.is_demo.is_(True), User.created_at < cutoff)))
    if old:
        db.execute(delete(User).where(User.id.in_(old)))
        db.commit()
    out["demo_users_removed"] = len(old)
    db.execute(delete(JobRun).where(JobRun.started_at < utcnow() - dt.timedelta(days=30)))
    db.commit()
    return out


def bootstrap_async() -> None:
    if _state["bootstrapping"]:
        return

    def run():
        _state["bootstrapping"] = True
        try:
            _run("bootstrap", job_bootstrap)
        finally:
            _state["bootstrapping"] = False
            _state["bootstrapped"] = True

    threading.Thread(target=run, name="finlex-bootstrap", daemon=True).start()


def _market_hours(now: dt.datetime) -> bool:
    ist = now.astimezone(marketdata.IST)
    return ist.weekday() < 5 and dt.time(9, 0) <= ist.time() <= dt.time(16, 0)


def _loop() -> None:
    s = get_settings()
    last_refresh = last_news = 0.0
    last_daily: dt.date | None = None
    while not _stop.wait(30):
        if _state["bootstrapping"]:
            continue
        now = dt.datetime.now(dt.UTC)
        interval = s.quote_refresh_minutes * 60 if _market_hours(now) else 2 * 3600
        t = time.monotonic()
        if t - last_refresh >= interval:
            _run("refresh", job_refresh)
            last_refresh = time.monotonic()
        if t - last_news >= 30 * 60:
            _run("news", news.ingest)
            last_news = time.monotonic()
        ist = now.astimezone(marketdata.IST)
        if ist.time() >= dt.time(16, 30) and last_daily != ist.date():
            _run("daily", job_daily)
            last_daily = ist.date()


def start() -> None:
    if get_settings().scheduler_enabled:
        threading.Thread(target=_loop, name="finlex-scheduler", daemon=True).start()


def stop() -> None:
    _stop.set()


def status() -> dict:
    return {"bootstrapped": _state["bootstrapped"], "bootstrapping": _state["bootstrapping"],
            "prices_ready": _state["prices_ready"], "last": _state["last"]}
