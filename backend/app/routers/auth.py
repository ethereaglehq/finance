from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import DEFAULT_PREFS, Portfolio, User, utcnow
from ..security import (
    audit,
    clear_session_cookies,
    get_current_user,
    get_optional_user,
    hash_password,
    rate_limit,
    set_session_cookies,
    verify_password,
)
from ..services import demo as demosvc
from ..services import scheduler

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(default="", max_length=120)
    accept_terms: bool


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


def user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "is_demo": u.is_demo,
            "preferences": {**DEFAULT_PREFS, **(u.preferences or {})}, "consent_llm": u.consent_llm,
            "created_at": u.created_at.isoformat() + "Z"}


def _password_ok(pw: str) -> None:
    if pw.lower() == pw or pw.upper() == pw or not any(c.isdigit() for c in pw):
        raise HTTPException(400, "Password must mix upper- and lower-case letters and include a number.")


@router.post("/register", dependencies=[Depends(rate_limit("register", 10, 3600))])
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    if not body.accept_terms:
        raise HTTPException(400, "Please accept the terms to continue.")
    _password_ok(body.password)
    email = body.email.lower()
    if db.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise HTTPException(409, "An account with this email already exists.")
    u = User(email=email, name=body.name.strip(), password_hash=hash_password(body.password),
             preferences=dict(DEFAULT_PREFS), consent_terms_at=utcnow(), last_login_at=utcnow())
    db.add(u)
    db.flush()
    db.add(Portfolio(user_id=u.id, name="My Portfolio"))
    audit(db, u.id, "register", "user", u.id, request)
    db.commit()
    csrf = set_session_cookies(response, u)
    return {"user": user_out(u), "csrf": csrf}


@router.post("/login", dependencies=[Depends(rate_limit("login", 20, 900))])
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    u = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if not u or not verify_password(body.password, u.password_hash):
        audit(db, u.id if u else None, "login_failed", "user", u.id if u else "", request)
        db.commit()
        raise HTTPException(401, "Incorrect email or password.")
    u.last_login_at = utcnow()
    audit(db, u.id, "login", "user", u.id, request)
    db.commit()
    csrf = set_session_cookies(response, u)
    return {"user": user_out(u), "csrf": csrf}


@router.post("/logout")
def logout(request: Request, response: Response, user: User | None = Depends(get_optional_user),
           db: Session = Depends(get_db)) -> dict:
    if user:
        audit(db, user.id, "logout", "user", user.id, request)
        db.commit()
    clear_session_cookies(response)
    return {"ok": True}


@router.get("/me")
def me(user: User | None = Depends(get_optional_user)) -> dict:
    return {"user": user_out(user) if user else None}


@router.post("/demo", dependencies=[Depends(rate_limit("demo", 10, 3600))])
def demo(request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    st = scheduler.status()
    if not st["prices_ready"]:
        raise HTTPException(503, "Market data is still loading. Please try again in a minute.")
    u = User(email=f"demo-{secrets.token_hex(6)}@demo.finlex.local", name="Demo investor",
             password_hash=hash_password(secrets.token_urlsafe(24)), is_demo=True,
             preferences={**DEFAULT_PREFS, "onboarded": True}, consent_terms_at=utcnow(), last_login_at=utcnow())
    db.add(u)
    db.flush()
    pf = Portfolio(user_id=u.id, name="Demo portfolio (synthetic)")
    db.add(pf)
    db.commit()
    demosvc.build_demo(db, pf)
    audit(db, u.id, "demo_start", "user", u.id, request)
    db.commit()
    csrf = set_session_cookies(response, u)
    return {"user": user_out(u), "csrf": csrf}


@router.post("/change-password")
def change_password(body: ChangePasswordIn, request: Request, response: Response,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    if user.is_demo:
        raise HTTPException(400, "Demo accounts can't set a password. Create a free account instead.")
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect.")
    _password_ok(body.new_password)
    user.password_hash = hash_password(body.new_password)
    user.token_version += 1  # invalidates other sessions
    audit(db, user.id, "password_changed", "user", user.id, request)
    db.commit()
    csrf = set_session_cookies(response, user)
    return {"ok": True, "csrf": csrf}
