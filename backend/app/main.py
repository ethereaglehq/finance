"""FinLex API application."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .db import SessionLocal, init_db
from .models import ImmutableRecordError
from .routers import analysis, auth, misc, portfolio, pulse
from .services import exposure, filings, marketdata, scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("finlex")


def startup() -> None:
    init_db()
    db = SessionLocal()
    try:
        marketdata.ensure_instruments(db)
        exposure.seed_fund_holdings(db)
        filings.ensure_sample(db)
    finally:
        db.close()
    s = get_settings()
    if s.bootstrap_on_start:
        scheduler.bootstrap_async()
    scheduler.start()


@asynccontextmanager
async def lifespan(_: FastAPI):
    startup()
    yield
    scheduler.stop()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="FinLex API", version=misc.VERSION, lifespan=lifespan,
                  docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    origins = [o.strip() for o in s.cors_origins.split(",") if o.strip()]
    if origins:
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True,
                           allow_methods=["*"], allow_headers=["*"])

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if request.url.path.startswith("/api/"):
            resp.headers.setdefault("Cache-Control", "no-store")
        else:
            resp.headers.setdefault(
                "Content-Security-Policy",
                "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                "font-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
        if s.cookie_secure:
            resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return resp

    @app.exception_handler(ValueError)
    async def value_error(_: Request, exc: ValueError):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.exception_handler(ImmutableRecordError)
    async def immutable(_: Request, exc: ImmutableRecordError):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    for r in (auth.router, portfolio.router, analysis.router, pulse.router, misc.router):
        app.include_router(r)

    static = Path(s.static_dir)
    if static.is_dir() and (static / "index.html").exists():
        if (static / "assets").is_dir():
            app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            if path.startswith("api/"):
                return JSONResponse({"detail": "Not found"}, status_code=404)
            f = (static / path).resolve()
            if path and f.is_file() and static.resolve() in f.parents:
                return FileResponse(f)
            return FileResponse(static / "index.html", headers={"Cache-Control": "no-cache"})
    return app


app = create_app()
