from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import Filing, Instrument, User
from ..security import audit, get_current_user, rate_limit
from ..services import filings as fl
from ..services import llm
from ..services import news as newsvc
from ..services import pulse as pulsesvc
from ..services import sentiment

router = APIRouter(prefix="/api/pulse", tags=["pulse"])


@router.get("/brief")
def brief(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    # The brief contains only public market data, but LLM phrasing still respects the user's consent setting.
    return pulsesvc.brief(db, use_llm=llm.configured() and user.consent_llm)


@router.get("/news")
def news(symbol: str | None = None, hours: int = Query(72, ge=1, le=24 * 14), limit: int = Query(60, le=200),
         _: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    items = newsvc.recent(db, hours, symbol, limit)
    return {"items": [newsvc.news_dict(n) for n in items], "mood": newsvc.mood(items),
            "model": sentiment.classify("x")["model"],
            "note": "Tone describes headline wording, not a prediction of price direction."}


@router.get("/sentiment-eval")
def sentiment_eval(_: User = Depends(get_current_user)) -> dict:
    return sentiment.evaluate()


@router.get("/filings")
def list_filings(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(Filing).where(or_(Filing.user_id == user.id, Filing.user_id.is_(None)))
                      .order_by(Filing.created_at.desc()).limit(50))
    return [fl.filing_dict(f) for f in rows]


@router.get("/filings/{filing_id}")
def get_filing(filing_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    f = db.get(Filing, filing_id)
    if not f or (f.user_id is not None and f.user_id != user.id):
        raise HTTPException(404, "Filing not found")
    return fl.filing_dict(f, full=True)


@router.post("/filings", dependencies=[Depends(rate_limit("filing", 20, 3600))])
def upload_filing(request: Request, issuer: str = Form(..., min_length=2, max_length=200), period: str = Form(""),
                  source_uri: str = Form(""), instrument_id: int | None = Form(None), text: str = Form(""),
                  file: UploadFile | None = File(None), user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)) -> dict:
    if source_uri and not source_uri.startswith(("https://", "http://")):
        raise HTTPException(400, "Source link must be an http(s) URL.")
    if file is not None and file.filename:
        limit = get_settings().max_upload_mb * 1024 * 1024
        data = file.file.read(limit + 1)
        if len(data) > limit:
            raise HTTPException(413, "File too large")
        try:
            content = fl.extract_text(data, file.filename)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
    elif text.strip():
        content = text[:200_000]
    else:
        raise HTTPException(400, "Upload a PDF/text file or paste the results text.")
    inst = db.get(Instrument, instrument_id) if instrument_id else None
    f = fl.analyse(db, user_id=user.id, issuer=issuer, text=content, source_uri=source_uri, period=period,
                   instrument=inst, use_llm=llm.configured() and user.consent_llm)
    audit(db, user.id, "filing_upload", "filing", f.id, request)
    db.commit()
    return fl.filing_dict(f, full=True)


@router.delete("/filings/{filing_id}")
def delete_filing(filing_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    f = db.get(Filing, filing_id)
    if not f or f.user_id != user.id:
        raise HTTPException(404, "Filing not found (sample filings can't be deleted)")
    db.delete(f)
    db.commit()
    return {"ok": True}
