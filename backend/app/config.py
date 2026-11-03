"""Runtime configuration, read from environment variables (prefix FINLEX_)."""
from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FINLEX_", env_file=".env", extra="ignore")

    env: str = "development"  # development | production | test
    database_url: str = f"sqlite:///{BASE_DIR / 'finlex.db'}"
    secret_key: str = ""  # MUST be set in production; random per-process otherwise
    session_hours: int = 24 * 7
    cookie_secure: bool = False  # set true behind HTTPS
    cors_origins: str = ""  # comma separated; empty = same-origin only

    # Market data: "auto" tries live providers and falls back to synthetic per instrument,
    # "live" never fabricates, "synthetic" never calls the network (tests / offline demo).
    market_data_mode: str = "auto"
    history_years: int = 5
    quote_refresh_minutes: int = 15
    http_timeout: float = 20.0

    # News feeds (RSS). Empty string disables live news and uses clearly-labelled samples.
    news_feeds: str = (
        "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms,"
        "https://www.moneycontrol.com/rss/marketreports.xml"
    )

    # LLM (Anthropic Claude). If no key is configured the assistant uses the local
    # deterministic engine. Users must also consent in Settings before data is sent.
    anthropic_api_key: str = ""
    llm_model: str = "claude-opus-5-5"
    llm_effort: str = "medium"

    # Background scheduler
    scheduler_enabled: bool = True
    bootstrap_on_start: bool = True

    admin_emails: str = ""  # comma separated; may upload fund-holdings disclosures
    max_upload_mb: int = 5
    static_dir: str = str(BASE_DIR.parent / "frontend" / "dist")
    demo_user_ttl_hours: int = 24

    @property
    def is_production(self) -> bool:
        return self.env == "production"


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if not s.secret_key:
        if s.is_production:
            raise RuntimeError("FINLEX_SECRET_KEY must be set in production")
        s.secret_key = secrets.token_urlsafe(48)
    return s
