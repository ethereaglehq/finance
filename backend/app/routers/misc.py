from __future__ import annotations

import datetime as dt
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import (
    DEFAULT_PREFS,
    Alert,
    AlertEvent,
    AuditEvent,
    ChatMessage,
    Holding,
    ImportBatch,
    Instrument,
    LearnProgress,
    Portfolio,
    SourceStatus,
    User,
)
from ..security import audit, clear_session_cookies, get_current_user, get_portfolio, rate_limit, verify_password
from ..seed.learn import GLOSSARY, LESSONS
from ..services import alerts as alertsvc
from ..services import assistant as asst
from ..services import exposure as expo
from ..services import llm
from ..services import marketdata as md
from ..services import portfolio as pfs
from ..services import pulse as pulsesvc
from ..services import scheduler
from .auth import user_out

router = APIRouter(prefix="/api", tags=["misc"])
VERSION = "1.0.0"


# ------------------------------------------------------------------ system
@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    db.execute(select(1))
    return {"ok": True, "version": VERSION}


@router.get("/status")
def status(db: Session = Depends(get_db)) -> dict:
    s = get_settings()
    n_prices = db.scalar(select(func.count(func.distinct(md.PriceObservation.instrument_id))))
    return {"version": VERSION, "market_data_mode": s.market_data_mode, "llm_configured": llm.configured(),
            "llm_model": s.llm_model if llm.configured() else None, "scheduler": scheduler.status(),
            "instruments_with_prices": n_prices, "env": s.env}


# ------------------------------------------------------------------ dashboard
@router.get("/dashboard")
def dashboard(user: User = Depends(get_current_user), pf: Portfolio = Depends(get_portfolio),
              db: Session = Depends(get_db)) -> dict:
    val = pfs.valuation(db, pf)
    ex = expo.compute_exposure(db, pf, user.preferences or {}) if val["holdings"] else None
    b = pulsesvc.brief(db)
    unread = db.scalar(select(func.count()).select_from(AlertEvent).where(AlertEvent.user_id == user.id,
                                                                          AlertEvent.read.is_(False)))
    top = sorted([h for h in val["holdings"] if not h["closed"] and h["value"]], key=lambda h: -h["value"])[:6]
    movers = sorted([h for h in val["holdings"] if not h["closed"] and h["day_change_pct"] is not None],
                    key=lambda h: -abs(h["day_change_pct"]))[:5]
    return {
        "totals": val["totals"], "allocation": val["allocation"], "issues": val["issues"][:6],
        "top_holdings": top, "movers": movers,
        "exposure": None if not ex else {"companies": ex["companies"][:6], "sectors": ex["sectors"][:6],
                                         "flags": ex["flags"][:4], "asset_mix": ex["asset_mix"],
                                         "top_overlap": ex["overlap"]["pairs"][:1]},
        "market": {"indices": b["indices"], "metals": b["metals"], "summary": b["summary"], "as_of": b["as_of"],
                   "synthetic": b["synthetic"], "news_mood": b["news_mood"]},
        "unread_alerts": unread,
    }


# ------------------------------------------------------------------ assistant
class AskIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


@router.post("/ask", dependencies=[Depends(rate_limit("ask", 60, 3600))])
def ask(body: AskIn, user: User = Depends(get_current_user), pf: Portfolio = Depends(get_portfolio),
        db: Session = Depends(get_db)) -> dict:
    return asst.ask(db, user, pf, body.message)


@router.get("/ask/history")
def ask_history(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = list(db.scalars(select(ChatMessage).where(ChatMessage.user_id == user.id)
                           .order_by(ChatMessage.id.desc()).limit(100)))[::-1]
    return [{"id": m.id, "role": m.role, "content": m.content, "meta": m.meta,
             "created_at": m.created_at.isoformat() + "Z"} for m in rows]


@router.delete("/ask/history")
def clear_history(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    db.execute(delete(ChatMessage).where(ChatMessage.user_id == user.id))
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ learn
@router.get("/learn/glossary")
def glossary() -> list[dict]:
    return GLOSSARY


@router.get("/learn/lessons")
def lessons(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    prog = {p.lesson_id: p for p in db.scalars(select(LearnProgress).where(LearnProgress.user_id == user.id))}
    return [{**l_, "completed": l_["id"] in prog, "score": prog[l_["id"]].score if l_["id"] in prog else None}
            for l_ in LESSONS]


class LessonDone(BaseModel):
    score: float = Field(ge=0, le=1)


@router.post("/learn/lessons/{lesson_id}/complete")
def complete_lesson(lesson_id: str, body: LessonDone, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)) -> dict:
    if lesson_id not in {x["id"] for x in LESSONS}:
        raise HTTPException(404, "Lesson not found")
    p = db.scalar(select(LearnProgress).where(LearnProgress.user_id == user.id, LearnProgress.lesson_id == lesson_id))
    if p is None:
        db.add(LearnProgress(user_id=user.id, lesson_id=lesson_id, score=body.score))
    else:
        p.score = max(p.score, body.score)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ alerts
class AlertIn(BaseModel):
    rule_type: str
    instrument_id: int | None = None
    threshold: float = 0.0
    enabled: bool = True


@router.get("/alerts")
def list_alerts(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(Alert).where(Alert.user_id == user.id).order_by(Alert.id.desc()))
    return {"alerts": [alertsvc.alert_dict(a) for a in rows], "rule_types": alertsvc.RULE_TYPES}


@router.post("/alerts")
def create_alert(body: AlertIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    alertsvc.validate(body.rule_type, body.instrument_id, body.threshold)
    if body.instrument_id and not db.get(Instrument, body.instrument_id):
        raise HTTPException(400, "Unknown instrument")
    if db.scalar(select(func.count()).select_from(Alert).where(Alert.user_id == user.id)) >= 50:
        raise HTTPException(400, "Alert limit reached (50).")
    a = Alert(user_id=user.id, rule_type=body.rule_type, instrument_id=body.instrument_id, threshold=body.threshold,
              enabled=body.enabled)
    db.add(a)
    db.commit()
    db.refresh(a)
    return alertsvc.alert_dict(a)


def _own_alert(db: Session, user: User, alert_id: int) -> Alert:
    a = db.get(Alert, alert_id)
    if not a or a.user_id != user.id:
        raise HTTPException(404, "Alert not found")
    return a


@router.put("/alerts/{alert_id}")
def update_alert(alert_id: int, body: AlertIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    a = _own_alert(db, user, alert_id)
    alertsvc.validate(body.rule_type, body.instrument_id, body.threshold)
    a.rule_type, a.instrument_id, a.threshold, a.enabled = body.rule_type, body.instrument_id, body.threshold, body.enabled
    db.commit()
    return alertsvc.alert_dict(a)


@router.delete("/alerts/{alert_id}")
def delete_alert(alert_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    db.delete(_own_alert(db, user, alert_id))
    db.commit()
    return {"ok": True}


@router.get("/alerts/events")
def alert_events(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(AlertEvent).where(AlertEvent.user_id == user.id).order_by(AlertEvent.id.desc()).limit(100))
    return [{"id": e.id, "alert_id": e.alert_id, "message": e.message, "read": e.read,
             "triggered_at": e.triggered_at.isoformat() + "Z"} for e in rows]


@router.post("/alerts/events/read-all")
def read_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    for e in db.scalars(select(AlertEvent).where(AlertEvent.user_id == user.id, AlertEvent.read.is_(False))):
        e.read = True
    db.commit()
    return {"ok": True}


@router.post("/alerts/evaluate", dependencies=[Depends(rate_limit("alerteval", 30, 3600))])
def evaluate(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    evs = alertsvc.evaluate_user(db, user)
    return {"triggered": len(evs), "messages": [e.message for e in evs]}


# ------------------------------------------------------------------ settings & data
class SettingsIn(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    consent_llm: bool | None = None
    risk_level: str | None = Field(default=None, pattern="^(conservative|moderate|aggressive)$")
    horizon_years: float | None = Field(default=None, ge=0, le=60)
    company_threshold_pct: float | None = Field(default=None, gt=0, le=100)
    sector_threshold_pct: float | None = Field(default=None, gt=0, le=100)
    goals: list[str] | None = None
    onboarded: bool | None = None


@router.get("/settings")
def get_settings_(user: User = Depends(get_current_user)) -> dict:
    return {"user": user_out(user), "llm_configured": llm.configured()}


@router.patch("/settings")
def patch_settings(body: SettingsIn, request: Request, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> dict:
    prefs = {**DEFAULT_PREFS, **(user.preferences or {})}
    for k in ("risk_level", "horizon_years", "company_threshold_pct", "sector_threshold_pct", "onboarded"):
        v = getattr(body, k)
        if v is not None:
            prefs[k] = v
    if body.goals is not None:
        prefs["goals"] = [g[:80] for g in body.goals[:10]]
    user.preferences = prefs
    if body.name is not None:
        user.name = body.name.strip()
    if body.consent_llm is not None and body.consent_llm != user.consent_llm:
        user.consent_llm = body.consent_llm
        audit(db, user.id, "consent_llm_" + ("granted" if body.consent_llm else "revoked"), "user", user.id, request)
    db.commit()
    return {"user": user_out(user)}


@router.get("/settings/export")
def export_data(request: Request, user: User = Depends(get_current_user), pf: Portfolio = Depends(get_portfolio),
                db: Session = Depends(get_db)) -> Response:
    holdings = []
    for h in pfs.load_holdings(db, pf):
        holdings.append({"instrument": {"symbol": h.instrument.symbol, "name": h.instrument.name, "isin": h.instrument.isin,
                                        "amfi_code": h.instrument.amfi_code, "asset_class": h.instrument.asset_class},
                         "account": h.account.label if h.account else None, "meta": h.meta, "notes": h.notes,
                         "transactions": [{"type": t.type, "quantity": t.quantity, "price": t.price, "fees": t.fees,
                                           "trade_date": t.trade_date.isoformat()} for t in h.transactions]})
    payload = {
        "exported_at": dt.datetime.now(dt.UTC).isoformat(), "format": "finlex-export-v1",
        "user": user_out(user), "portfolio": {"name": pf.name, "holdings": holdings},
        "alerts": [alertsvc.alert_dict(a) for a in db.scalars(select(Alert).where(Alert.user_id == user.id))],
        "chat": [{"role": m.role, "content": m.content, "at": m.created_at.isoformat()} for m in
                 db.scalars(select(ChatMessage).where(ChatMessage.user_id == user.id))],
        "learn_progress": [{"lesson": p.lesson_id, "score": p.score} for p in
                           db.scalars(select(LearnProgress).where(LearnProgress.user_id == user.id))],
        "audit_log": [{"action": a.action, "object": f"{a.object_type}:{a.object_id}", "at": a.timestamp.isoformat()}
                      for a in db.scalars(select(AuditEvent).where(AuditEvent.user_id == user.id))],
    }
    audit(db, user.id, "data_export", "user", user.id, request)
    db.commit()
    return Response(json.dumps(payload, indent=2, default=str), media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="finlex-export.json"'})


class DeleteIn(BaseModel):
    password: str = ""
    confirm: str


@router.post("/settings/delete-account", dependencies=[Depends(rate_limit("delete", 10, 3600))])
def delete_account(body: DeleteIn, response: Response, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> dict:
    if body.confirm != "DELETE":
        raise HTTPException(400, "Type DELETE to confirm.")
    if not user.is_demo and not verify_password(body.password, user.password_hash):
        raise HTTPException(400, "Password is incorrect.")
    db.execute(delete(ImportBatch).where(ImportBatch.user_id == user.id))
    db.delete(user)  # cascades: portfolios, holdings, transactions, alerts, chat, audit, filings, progress
    db.commit()
    clear_session_cookies(response)
    return {"ok": True, "deleted": True}


@router.post("/settings/logout-all")
def logout_all(request: Request, response: Response, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)) -> dict:
    user.token_version += 1
    audit(db, user.id, "logout_all", "user", user.id, request)
    db.commit()
    clear_session_cookies(response)
    return {"ok": True}


@router.get("/settings/audit")
def audit_log(page: int = Query(1, ge=1), user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(AuditEvent).where(AuditEvent.user_id == user.id).order_by(AuditEvent.id.desc())
                      .offset((page - 1) * 50).limit(50))
    return [{"id": a.id, "action": a.action, "object": f"{a.object_type}:{a.object_id}" if a.object_type else "",
             "ip": a.ip, "meta": a.meta, "at": a.timestamp.isoformat() + "Z"} for a in rows]


SOURCE_REGISTER = [
    {"key": "yahoo", "domain": "NSE/BSE equities, indices, ETFs", "provider": "Yahoo Finance chart API",
     "licence": "Personal/educational use; verify terms before commercial redistribution", "frequency": "15 min in market hours",
     "delay": "Delayed (typically up to ~15 min)", "limitations": "Unofficial API; corporate actions via adjusted close"},
    {"key": "mfapi", "domain": "Mutual-fund NAV history", "provider": "AMFI via mfapi.in",
     "licence": "Public NAV data published by AMFI", "frequency": "Daily", "delay": "End of day",
     "limitations": "NAVs published after market close; community mirror"},
    {"key": "derived", "domain": "Gold & silver INR reference", "provider": "COMEX futures × USD/INR (Yahoo Finance)",
     "licence": "As Yahoo Finance", "frequency": "15 min", "delay": "Delayed",
     "limitations": "International reference; excludes import duty, GST, premiums"},
    {"key": "fund_holdings", "domain": "Mutual-fund portfolio disclosures", "provider": "FinLex curated illustrative snapshot",
     "licence": "Illustrative; replace with AMC monthly disclosures", "frequency": "Manual", "delay": "Monthly disclosure lag",
     "limitations": "Top holdings only; remainder shown as 'not itemised'"},
    {"key": "news", "domain": "Market headlines", "provider": "Publisher RSS feeds (Economic Times, Moneycontrol)",
     "licence": "Headline + link only, attributed to publisher", "frequency": "30 min", "delay": "Feed dependent",
     "limitations": "Tone classified by lexicon model; deduplicated by headline"},
    {"key": "filings", "domain": "Company results", "provider": "User-uploaded exchange filings (NSE/BSE PDFs)",
     "licence": "Public disclosures", "frequency": "On upload", "delay": "—",
     "limitations": "Text extraction; table column order assumed and labelled"},
    {"key": "statements", "domain": "CAMS/KFintech/NSDL/CDSL statements", "provider": "User upload, parsed in memory (casparser)",
     "licence": "User's own data", "frequency": "On upload", "delay": "—",
     "limitations": "Files never stored; review screen before import"},
]


@router.get("/settings/sources")
def sources(_: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    st = {s.key: s for s in db.scalars(select(SourceStatus))}
    out = []
    for s in SOURCE_REGISTER:
        x = st.get(s["key"])
        out.append({**s, "last_success_at": x.last_success_at.isoformat() + "Z" if x and x.last_success_at else None,
                    "last_error_at": x.last_error_at.isoformat() + "Z" if x and x.last_error_at else None,
                    "last_error": x.last_error if x else "", "mode": get_settings().market_data_mode})
    return out


@router.post("/settings/refresh-prices", dependencies=[Depends(rate_limit("refresh", 6, 3600))])
def refresh_prices(user: User = Depends(get_current_user), pf: Portfolio = Depends(get_portfolio),
                   db: Session = Depends(get_db)) -> dict:
    ids = {h.instrument_id for h in db.scalars(select(Holding).where(Holding.portfolio_id == pf.id))}
    insts = list(db.scalars(select(Instrument).where(Instrument.id.in_(ids), Instrument.provider != "none")))
    for metal in ("GOLD", "SILVER"):
        if any(i.symbol == metal for i in insts):
            continue
    res = md.refresh_recent(db, insts) if insts else {"live": 0}
    return {"refreshed": res.get("live", 0), "errors": res.get("errors", {})}
