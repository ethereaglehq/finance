"""Authentication (httpOnly JWT session cookie + CSRF double-submit), rate limiting, audit."""
from __future__ import annotations

import datetime as dt
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import AuditEvent, Portfolio, User, utcnow

SESSION_COOKIE = "finlex_session"
CSRF_COOKIE = "finlex_csrf"
CSRF_HEADER = "x-csrf-token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


# ---------------------------------------------------------------- passwords
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode()[:72], hashed.encode())
    except ValueError:
        return False


# ---------------------------------------------------------------- sessions
def create_session_token(user: User) -> str:
    s = get_settings()
    now = dt.datetime.now(dt.UTC)
    payload = {
        "sub": str(user.id),
        "tv": user.token_version,
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(hours=s.session_hours)).timestamp()),
    }
    return jwt.encode(payload, s.secret_key, algorithm="HS256")


def set_session_cookies(response: Response, user: User) -> str:
    s = get_settings()
    token = create_session_token(user)
    csrf = secrets.token_urlsafe(32)
    max_age = s.session_hours * 3600
    response.set_cookie(
        SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=s.cookie_secure, samesite="lax", path="/"
    )
    # readable by JS on purpose: double-submit CSRF token
    response.set_cookie(
        CSRF_COOKIE, csrf, max_age=max_age, httponly=False, secure=s.cookie_secure, samesite="lax", path="/"
    )
    return csrf


def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


def _decode(token: str) -> dict | None:
    try:
        return jwt.decode(token, get_settings().secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def get_optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    payload = _decode(token)
    if not payload:
        return None
    user = db.get(User, int(payload["sub"]))
    if not user or user.token_version != payload.get("tv"):
        return None
    return user


def get_current_user(request: Request, user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    if request.method not in SAFE_METHODS:
        header = request.headers.get(CSRF_HEADER, "")
        cookie = request.cookies.get(CSRF_COOKIE, "")
        if not header or not cookie or not hmac.compare_digest(header, cookie):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF token missing or invalid")
    return user


def get_portfolio(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Portfolio:
    """Every user owns exactly one default portfolio; all queries are scoped through it."""
    pf = db.query(Portfolio).filter(Portfolio.user_id == user.id).order_by(Portfolio.id).first()
    if pf is None:
        pf = Portfolio(user_id=user.id, name="My Portfolio")
        db.add(pf)
        db.commit()
    return pf


# ---------------------------------------------------------------- rate limiting
class RateLimiter:
    """Sliding-window in-memory limiter (per process). Use a shared store for multi-instance deploys."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_s: float) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window_s:
                q.popleft()
            if len(q) >= limit:
                retry = int(window_s - (now - q[0])) + 1
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    f"Too many requests. Try again in {retry}s.",
                    headers={"Retry-After": str(retry)},
                )
            q.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(name: str, limit: int, window_s: float):
    def dep(request: Request) -> None:
        env = get_settings().env
        if env == "test":
            return
        # development is lenient (x10) so local testing isn't throttled; production uses the stated limits
        limiter.check(f"{name}:{client_ip(request)}", limit * (10 if env == "development" else 1), window_s)

    return dep


# ---------------------------------------------------------------- audit
def audit(
    db: Session,
    user_id: int | None,
    action: str,
    object_type: str = "",
    object_id: str | int = "",
    request: Request | None = None,
    **meta,
) -> None:
    db.add(
        AuditEvent(
            user_id=user_id,
            action=action,
            object_type=object_type,
            object_id=str(object_id),
            ip=client_ip(request) if request else "",
            meta=meta,
            timestamp=utcnow(),
        )
    )
