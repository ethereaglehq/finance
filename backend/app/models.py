"""ORM entities (blueprint §15 Core Data Entities)."""
from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,

    Integer,
    String,
    Text,
    UniqueConstraint,
    event,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC).replace(tzinfo=None)


DEFAULT_PREFS: dict[str, Any] = {
    "risk_level": "moderate",  # conservative | moderate | aggressive
    "horizon_years": 5,
    "company_threshold_pct": 10.0,
    "sector_threshold_pct": 30.0,
    "goals": [],
    "onboarded": False,
}


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    preferences: Mapped[dict] = mapped_column(JSON, default=lambda: dict(DEFAULT_PREFS))
    consent_llm: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_terms_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    last_login_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0)

    portfolios: Mapped[list[Portfolio]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Portfolio(Base):
    __tablename__ = "portfolios"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120), default="My Portfolio")
    base_currency: Mapped[str] = mapped_column(String(3), default="INR")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)

    user: Mapped[User] = relationship(back_populates="portfolios")
    accounts: Mapped[list[Account]] = relationship(back_populates="portfolio", cascade="all, delete-orphan")
    holdings: Mapped[list[Holding]] = relationship(back_populates="portfolio", cascade="all, delete-orphan")


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    portfolio_id: Mapped[int] = mapped_column(ForeignKey("portfolios.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(120))
    account_type: Mapped[str] = mapped_column(String(32), default="broker")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)

    portfolio: Mapped[Portfolio] = relationship(back_populates="accounts")


class Instrument(Base):
    __tablename__ = "instruments"
    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    asset_class: Mapped[str] = mapped_column(String(16), index=True)  # equity|index|mf|etf|gold|silver|fd|cash
    exchange: Mapped[str] = mapped_column(String(16), default="NSE")
    isin: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    amfi_code: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    sector: Mapped[str | None] = mapped_column(String(80), nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)  # e.g. MF category / market-cap bucket
    provider_symbol: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provider: Mapped[str] = mapped_column(String(24), default="yahoo")  # yahoo|mfapi|derived|none
    unit: Mapped[str] = mapped_column(String(24), default="share")
    in_universe: Mapped[bool] = mapped_column(Boolean, default=False)  # forecastable / comparable
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class Holding(Base):
    __tablename__ = "holdings"
    id: Mapped[int] = mapped_column(primary_key=True)
    portfolio_id: Mapped[int] = mapped_column(ForeignKey("portfolios.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id"), index=True)
    quantity: Mapped[float] = mapped_column(Float, default=0.0)
    avg_cost: Mapped[float] = mapped_column(Float, default=0.0)
    realised_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)  # FD terms, purity, etc.
    source: Mapped[str] = mapped_column(String(16), default="manual")
    notes: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    portfolio: Mapped[Portfolio] = relationship(back_populates="holdings")
    instrument: Mapped[Instrument] = relationship()
    account: Mapped[Account | None] = relationship()
    transactions: Mapped[list[Transaction]] = relationship(
        back_populates="holding", cascade="all, delete-orphan", order_by="Transaction.trade_date"
    )


class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[int] = mapped_column(primary_key=True)
    holding_id: Mapped[int] = mapped_column(ForeignKey("holdings.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(8))  # BUY | SELL
    quantity: Mapped[float] = mapped_column(Float)
    price: Mapped[float] = mapped_column(Float)
    fees: Mapped[float] = mapped_column(Float, default=0.0)
    trade_date: Mapped[dt.date] = mapped_column(Date)
    source: Mapped[str] = mapped_column(String(16), default="manual")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)

    holding: Mapped[Holding] = relationship(back_populates="transactions")


class PriceObservation(Base):
    __tablename__ = "prices"
    __table_args__ = (UniqueConstraint("instrument_id", "date", name="uq_price_inst_date"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"), index=True)
    date: Mapped[dt.date] = mapped_column(Date, index=True)
    close: Mapped[float] = mapped_column(Float)
    adj_close: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(120))
    fetched_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class Quote(Base):
    __tablename__ = "quotes"
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"), primary_key=True)
    price: Mapped[float] = mapped_column(Float)
    prev_close: Mapped[float | None] = mapped_column(Float, nullable=True)
    as_of: Mapped[dt.datetime] = mapped_column(DateTime)
    source: Mapped[str] = mapped_column(String(120))
    delay_note: Mapped[str] = mapped_column(String(160), default="")
    fetched_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class FundHoldingSnapshot(Base):
    __tablename__ = "fund_holdings"
    id: Mapped[int] = mapped_column(primary_key=True)
    scheme_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"), index=True)
    underlying_instrument_id: Mapped[int | None] = mapped_column(ForeignKey("instruments.id"), nullable=True)
    underlying_name: Mapped[str] = mapped_column(String(255))
    underlying_isin: Mapped[str | None] = mapped_column(String(16), nullable=True)
    sector: Mapped[str | None] = mapped_column(String(80), nullable=True)
    asset_type: Mapped[str] = mapped_column(String(16), default="equity")  # equity|debt|cash|gold|other
    weight: Mapped[float] = mapped_column(Float)  # percent of fund NAV
    disclosure_date: Mapped[dt.date] = mapped_column(Date)
    source: Mapped[str] = mapped_column(String(160))


class ModelRun(Base):
    __tablename__ = "model_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"), index=True)
    model: Mapped[str] = mapped_column(String(32))
    model_version: Mapped[str] = mapped_column(String(32))
    horizon_days: Mapped[int] = mapped_column(Integer)
    data_cutoff: Mapped[dt.date] = mapped_column(Date)
    dataset_hash: Mapped[str] = mapped_column(String(64))
    code_version: Mapped[str] = mapped_column(String(32))
    seed: Mapped[int] = mapped_column(Integer, default=42)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class ForecastLog(Base):
    """Append-only, hash-chained forecast record. Never updated or deleted (blueprint §9)."""

    __tablename__ = "forecast_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, index=True)
    origin: Mapped[str] = mapped_column(String(12), default="live")  # live | backtest
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id"), index=True)
    model: Mapped[str] = mapped_column(String(32))
    model_version: Mapped[str] = mapped_column(String(32))
    horizon_days: Mapped[int] = mapped_column(Integer)
    cutoff_date: Mapped[dt.date] = mapped_column(Date)
    target_date: Mapped[dt.date] = mapped_column(Date, index=True)
    base_price: Mapped[float] = mapped_column(Float)
    point_return: Mapped[float] = mapped_column(Float)  # log-return forecast in % terms
    lower80: Mapped[float] = mapped_column(Float)
    upper80: Mapped[float] = mapped_column(Float)
    lower50: Mapped[float] = mapped_column(Float)
    upper50: Mapped[float] = mapped_column(Float)
    interval_method: Mapped[str] = mapped_column(String(120))
    eval_protocol: Mapped[str] = mapped_column(String(120))
    data_version: Mapped[str] = mapped_column(String(64))
    prev_hash: Mapped[str] = mapped_column(String(64))
    record_hash: Mapped[str] = mapped_column(String(64), unique=True)

    instrument: Mapped[Instrument] = relationship()
    outcome: Mapped[ForecastOutcome | None] = relationship(back_populates="forecast", uselist=False)


class ForecastOutcome(Base):
    __tablename__ = "forecast_outcomes"
    id: Mapped[int] = mapped_column(primary_key=True)
    forecast_id: Mapped[int] = mapped_column(ForeignKey("forecast_log.id"), unique=True)
    observed_date: Mapped[dt.date] = mapped_column(Date)
    observed_price: Mapped[float] = mapped_column(Float)
    realised_return: Mapped[float] = mapped_column(Float)  # %
    error: Mapped[float] = mapped_column(Float)  # realised - point (pp)
    inside80: Mapped[bool] = mapped_column(Boolean)
    inside50: Mapped[bool] = mapped_column(Boolean)
    direction_hit: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    naive_abs_error: Mapped[float] = mapped_column(Float)
    evaluated_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    note: Mapped[str] = mapped_column(String(255), default="")

    forecast: Mapped[ForecastLog] = relationship(back_populates="outcome")


class ImmutableRecordError(RuntimeError):
    pass


@event.listens_for(ForecastLog, "before_update")
@event.listens_for(ForecastLog, "before_delete")
@event.listens_for(ForecastOutcome, "before_update")
@event.listens_for(ForecastOutcome, "before_delete")
def _block_mutation(mapper, connection, target):  # noqa: ANN001
    raise ImmutableRecordError(f"{type(target).__name__} records are append-only")


class Filing(Base):
    __tablename__ = "filings"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    instrument_id: Mapped[int | None] = mapped_column(ForeignKey("instruments.id"), nullable=True)
    issuer: Mapped[str] = mapped_column(String(255))
    exchange: Mapped[str] = mapped_column(String(16), default="NSE")
    filing_type: Mapped[str] = mapped_column(String(64), default="Quarterly results")
    period: Mapped[str] = mapped_column(String(64), default="")
    published_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    source_uri: Mapped[str] = mapped_column(String(500), default="")
    checksum: Mapped[str] = mapped_column(String(64))
    text: Mapped[str] = mapped_column(Text, default="")
    facts: Mapped[dict] = mapped_column(JSON, default=dict)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class NewsItem(Base):
    __tablename__ = "news"
    id: Mapped[int] = mapped_column(primary_key=True)
    publisher: Mapped[str] = mapped_column(String(120))
    headline: Mapped[str] = mapped_column(String(500))
    summary: Mapped[str] = mapped_column(Text, default="")
    url: Mapped[str] = mapped_column(String(800), default="")
    published_at: Mapped[dt.datetime] = mapped_column(DateTime, index=True)
    entities: Mapped[list] = mapped_column(JSON, default=list)
    sentiment_label: Mapped[str] = mapped_column(String(12))
    sentiment_score: Mapped[float] = mapped_column(Float)
    sentiment_model: Mapped[str] = mapped_column(String(48))
    dedup_key: Mapped[str] = mapped_column(String(64), unique=True)
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False)
    fetched_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    rule_type: Mapped[str] = mapped_column(String(24))  # price_move|concentration|sector|new_filing|data_stale
    instrument_id: Mapped[int | None] = mapped_column(ForeignKey("instruments.id"), nullable=True)
    threshold: Mapped[float] = mapped_column(Float, default=0.0)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_triggered_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)

    instrument: Mapped[Instrument | None] = relationship()


class AlertEvent(Base):
    __tablename__ = "alert_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    alert_id: Mapped[int | None] = mapped_column(ForeignKey("alerts.id", ondelete="SET NULL"), nullable=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    message: Mapped[str] = mapped_column(String(500))
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    triggered_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(64))
    object_type: Mapped[str] = mapped_column(String(48), default="")
    object_id: Mapped[str] = mapped_column(String(64), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    timestamp: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow, index=True)


class ImportBatch(Base):
    __tablename__ = "import_batches"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # csv | cams
    filename: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    rows: Mapped[list] = mapped_column(JSON, default=list)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(12))
    content: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class LearnProgress(Base):
    __tablename__ = "learn_progress"
    __table_args__ = (UniqueConstraint("user_id", "lesson_id", name="uq_learn_user_lesson"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    lesson_id: Mapped[str] = mapped_column(String(48))
    score: Mapped[float] = mapped_column(Float, default=0.0)
    completed_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class SourceStatus(Base):
    __tablename__ = "source_status"
    key: Mapped[str] = mapped_column(String(48), primary_key=True)
    last_success_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    last_error_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str] = mapped_column(String(500), default="")
    items: Mapped[int] = mapped_column(Integer, default=0)


class JobRun(Base):
    __tablename__ = "job_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    job: Mapped[str] = mapped_column(String(48), index=True)
    started_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="running")
    detail: Mapped[str] = mapped_column(Text, default="")


