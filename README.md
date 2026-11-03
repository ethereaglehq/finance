# FinLex — honest money intelligence for Indian investors

FinLex is an India-first, privacy-conscious financial workspace. It brings together your stocks, mutual funds, ETFs, physical gold and silver, and fixed deposits. It looks through your funds to show your true company and sector exposure. It compares NIFTY, gold and silver in ₹ and publishes forecast ranges that are tested against a baseline. It also keeps a tamper-evident record of every forecast, misses included. **It never gives buy, sell or hold tips.**

The UI combines **StockWisp**'s dark, developer-grade dashboard style (navy surfaces, sparkline index cards, sentiment-style score bars and chips, a "Delayed" pill, and the landing-page rhythm) with **Metron**'s consolidated, asset-class-tabbed portfolio view.


## Screenshots

| | |
|---|---|
| ![Landing](docs/screenshots/01-landing.png) | ![Dashboard](docs/screenshots/03-dashboard.png) |
| **Landing page** | **Dashboard**: net worth, markets, value history, allocation, exposure |
| ![Portfolio](docs/screenshots/04-portfolio.png) | ![True exposure](docs/screenshots/05-true-exposure.png) |
| **My Portfolio**: asset-class tabs, P&L, XIRR, weights | **True Exposure**: fund look-through, concentration flags |
| ![Compare](docs/screenshots/06-compare.png) | ![Forecast](docs/screenshots/07-forecast.png) |
| **Compare**: NIFTY vs gold vs silver in ₹ | **Forecast**: calibrated ranges, honest baseline check |
| ![Track record](docs/screenshots/08-track-record.png) | ![Market pulse](docs/screenshots/09-market-pulse.png) |
| **Track Record**: every forecast scored, misses included | **Market Pulse**: factual brief, sector moves, headline tone |
| ![Ask FinLex](docs/screenshots/10-ask-finlex.png) | ![Plan](docs/screenshots/11-plan-allocation.png) |
| **Ask FinLex**: grounded answers, tip requests declined | **Plan**: expert system + CSP/A\* allocation explorer |

<p align="center">
  <img src="docs/screenshots/12-dashboard-light.png" width="62%" alt="Light theme" />
  <img src="docs/screenshots/13-mobile-dashboard.png" width="17%" alt="Mobile dashboard" />
  <img src="docs/screenshots/14-mobile-exposure.png" width="17%" alt="Mobile exposure" />
</p>

---

## Modules

| Module | What it does | Where |
|---|---|---|
| **My Portfolio** | Manual entry, CSV import and CAMS/KFintech/NSDL/CDSL statement import, all with a review step before anything is saved. Covers multiple accounts, average-cost holdings from transactions, realised and unrealised P&L, XIRR (overall and per holding), time-weighted value history, allocation by type, sector and account, and data-quality notices. | `services/portfolio.py`, `services/imports.py` |
| **True Exposure** | Mutual-fund and ETF look-through (your value in the fund × the fund's disclosed weight, plus direct holdings), company and sector concentration against your own thresholds, a fund-overlap matrix (Σ min weight), disclosure dates and coverage. Data checks: deterministic rules plus an experimental **autoencoder**. | `services/exposure.py`, `services/dataquality.py` |
| **Compare** | Normalised INR performance for indices, stocks, ETFs and gold/silver reference series, aligned across calendars. Shows return, CAGR, volatility, max drawdown with dates, best/worst day, correlation, and rolling 1-month returns. | `services/compare.py` |
| **Forecast** | Naïve and drift baselines, **Ridge** and **XGBoost** models, and an optional **Chronos** adapter. Uses leakage-safe features, walk-forward evaluation with purging, and split-conformal 50%/80% intervals. Every result is benchmarked against the baseline, and the page says plainly when a model doesn't beat it. **VAE** what-if scenarios are compared with a block bootstrap and evaluated against held-out data. | `services/forecasting.py`, `services/scenarios.py` |
| **Track Record** | An append-only, SHA-256 hash-chained forecast log with automatic scoring at the horizon. Reports hit rate against the stated coverage, MAE versus the naïve baseline, directional accuracy, a calibration chart and segments. Misses are always shown. Live records and point-in-time backtest replays are kept separate. | `services/trackrecord.py` |
| **Market Pulse** | A daily brief built only from verified, timestamped prices; RSS headlines with lexicon-based tone scores (FinBERT optional) that are deduplicated and mapped to entities; quarterly-results analysis (extracted facts with evidence lines, QoQ/YoY, risk mentions) kept separate from interpretation. | `services/pulse.py`, `services/news.py`, `services/sentiment.py`, `services/filings.py` |
| **Ask FinLex** | An assistant grounded in your own data, with tools and citations. Claude (Anthropic API) is used only when it is configured **and** you have consented; otherwise a deterministic local engine answers. An advice-request classifier and an output check enforce the no-tips rule. | `services/assistant.py`, `services/llm.py` |
| **Plan** | A rule-based **expert system** covering concentration, overlap, liquidity and data freshness, where each rule lists the facts it fired on. An allocation explorer uses **CSP + A\*** search to find the constraint-satisfying mixes closest to what you hold now. | `services/planner.py` |
| **Learn** | A glossary of 38 terms and 8 lessons with knowledge checks and progress tracking. | `seed/learn.py` |
| **Alerts, Settings & Data** | Price-move/level, concentration, sector, new-filing and stale-data alerts; profile and thresholds; AI consent; a data-source register with live status; JSON export; account deletion; sign out everywhere; audit log. | `services/alerts.py`, `routers/misc.py` |

### AI/ML techniques mapped to the course syllabus

| Course topic | Where it's used |
|---|---|
| Search (A\*) | Allocation explorer. g = turnover; the heuristic h = ½·\|remaining budget − remaining current\| is admissible. |
| Constraint satisfaction | Per-class min/max bounds, sum = 100%, volatility cap, arc-consistency pruning |
| Expert systems | Nine rules (R1–R9) with explanations and the facts each one used |
| Generative AI (VAE) | NumPy VAE (21→32→z4→32→21, Adam, KL warm-up, Gaussian observation noise) for scenarios |
| Autoencoder | MLP autoencoder over fund-snapshot features. Its detection rate is measured on synthetic corruptions; it only flags data for review. |
| Supervised ML | Ridge (scikit-learn Pipeline) and XGBoost on causal price features |
| Transformers | Optional Chronos adapter (`pip install chronos-forecasting torch`) |
| NLP | Finance lexicon tone model (labelled eval set ≥ 80% accuracy); FinBERT optional (`FINLEX_USE_FINBERT=1`) |
| LLMs | Ask FinLex tool use; number-grounded summaries (generated numbers must appear in the facts) |
| Evaluation | Walk-forward evaluation, purge gaps, naïve baselines, MAE/RMSE, interval coverage, t-test against baseline, track record |

---

## Architecture

```
frontend/  React 18 + TypeScript + Vite + Tailwind + TanStack Query + Recharts
backend/   FastAPI + SQLAlchemy 2 (SQLite by default, PostgreSQL in production)
           numpy / pandas / scikit-learn / xgboost; casparser for statements; anthropic SDK (optional)
```

- **One deployable**: FastAPI serves `/api/*` and the built SPA, with a CSP, security headers and gzip.
- **Auth**: an httpOnly JWT session cookie plus a double-submit CSRF token, bcrypt passwords, per-IP rate limits, and token versioning so you can sign out everywhere. Every query is scoped to the owner's portfolio, and cross-user isolation is covered by tests.
- **Background jobs**: an in-process scheduler handles bootstrap, a 15-minute price refresh during market hours, forecast scoring, alerts, news every 30 minutes, daily forecasts and demo-user cleanup. For multi-replica deployments, set `FINLEX_SCHEDULER_ENABLED=false` and run `python -m app.cli refresh|daily|news` from cron.
- **Data flow**: ingestion stores timestamped prices with their source → the portfolio engine values holdings → the look-through engine estimates exposure → the feature pipeline builds leakage-safe inputs → the forecast service logs every forecast immutably → the scorer evaluates matured forecasts → Pulse and Ask FinLex read only stored, sourced data.

### Data sources (shown on every screen)

| Data | Source | Notes |
|---|---|---|
| NSE/BSE equities, indices, ETFs | Yahoo Finance chart API | Delayed up to about 15 minutes; dividend- and split-adjusted closes are used for returns |
| Mutual-fund NAVs | AMFI via mfapi.in | End of day; any AMFI scheme can be added by code or search |
| Gold/silver ₹ reference | COMEX futures × USD/INR | International reference; excludes import duty, GST and dealer premiums |
| Fund holdings | Curated **illustrative** snapshot for 15 popular schemes plus NIFTY 50 trackers | Replace with real AMC disclosures through the admin CSV upload (`POST /api/exposure/fund-holdings/{id}`) |
| News | Publisher RSS (Economic Times, Moneycontrol) | Headline, link and attribution only |
| Statements | Your own CAMS/KFintech/NSDL/CDSL PDFs | Parsed in memory with casparser and never stored |

`FINLEX_MARKET_DATA_MODE=auto` falls back, per instrument, to a deterministic **synthetic** series when a live source fails. Synthetic data is always labelled "Synthetic demo data". Use `live` to never fabricate, or `synthetic` for fully offline demos and tests.

> Before any public launch, check each provider's terms for commercial redistribution. Have Indian securities-regulatory counsel review the product. A disclaimer alone does not establish SEBI compliance.

---

## Quick start (local)

Prerequisites: Python 3.12+ and Node 20+.

```bash
make setup
```

```bash
make dev-api
```

```bash
make dev-web
```

`make dev-api` runs the API on :8000 and loads about 100 instruments with 5 years of history in roughly 30–60 s. `make dev-web` runs the web app on :5173 and proxies `/api` to the API.

Open http://localhost:5173 and click **Try the live demo**. This creates a sandbox portfolio priced with real market data that is deleted after 24 hours. You can also register a real account.

To run a single production-style process:

```bash
make run
```

This builds the SPA and serves everything on :8000.

### Docker (with PostgreSQL)

```bash
cp .env.example .env
```

Edit `.env` to set FINLEX_SECRET_KEY and POSTGRES_PASSWORD (and FINLEX_COOKIE_SECURE=false if you use plain http). Then:

```bash
docker compose up --build
```

The app is then available at http://localhost:8000.

### Configuration

All settings are environment variables prefixed `FINLEX_`; see `.env.example`. The main ones:

| Variable | Default | Purpose |
|---|---|---|
| `FINLEX_SECRET_KEY` | random per process (dev) | **Required in production.** Signs session tokens. |
| `FINLEX_DATABASE_URL` | `sqlite:///backend/finlex.db` | e.g. `postgresql+psycopg://user:pass@host/db` |
| `FINLEX_COOKIE_SECURE` | `false` | Set `true` behind HTTPS (also enables HSTS) |
| `FINLEX_MARKET_DATA_MODE` | `auto` | `auto` / `live` / `synthetic` |
| `FINLEX_ANTHROPIC_API_KEY` | – | Enables Claude for Ask FinLex and summaries (users must also opt in) |
| `FINLEX_LLM_MODEL` | `claude-opus-5-5` | Model id; uses server-side refusal fallbacks |
| `FINLEX_SCHEDULER_ENABLED` | `true` | Disable when running more than one replica; use the CLI from cron instead |
| `FINLEX_ADMIN_EMAILS` | – | Users allowed to upload AMC fund disclosures |

---

## Testing

```bash
make test
```

This runs the backend tests (pytest) and the frontend type check.

To run the backend tests against PostgreSQL:

```bash
FINLEX_TEST_DATABASE_URL=postgresql+psycopg://user@host/finlex_test backend/.venv/bin/python -m pytest backend/tests
```

The backend suite (44 tests) passes on both SQLite and PostgreSQL, and `.github/workflows/ci.yml` runs both plus the frontend build. It covers:

- **Calculations**: XIRR against spreadsheet values, average cost and realised P&L, overselling rejected, FD compounding, overlap as Σ min weight, and a hand-computed look-through exposure.
- **ML hygiene**: features are causal (changing future prices leaves past features unchanged), training labels end before every walk-forward origin, conformal coverage on i.i.d. data, and no "significant" edge claimed on a random walk.
- **Trust**: forecast records can't be updated or deleted, raw-SQL tampering breaks the hash chain, matured forecasts are scored correctly, and backtest misses stay visible.
- **Security and privacy**: CSRF enforcement, cross-user isolation, password rules, upload limits and file-type checks, admin-only disclosures, security headers, and that export and delete actually remove data.
- **Assistant**: tip requests are declined, answers carry citations, and the LLM grounding check rejects invented numbers. The Claude tool-use loop is tested against a mocked Messages API: no data is sent without consent, advice in model output is blocked, and a refusal falls back to the local engine.
- **Product flows**: CSV import review and confirm, planner constraints and A\* ordering, alert cooldowns, and the demo session.

---

## API

Interactive docs are at `/api/docs`. The main groups:

- `/api/auth/*`: register, login, logout, me, demo, change-password
- `/api/portfolio`, `/api/portfolio/history`, `/api/holdings*`, `/api/transactions/*`, `/api/accounts*`, `/api/instruments*`
- `/api/imports/csv|cas`, `/api/imports/{id}/confirm`, `/api/imports/template.csv`
- `/api/exposure`, `/api/market/compare|forecast|evaluation|scenarios|models|universe`, `/api/track-record`
- `/api/pulse/brief|news|filings|sentiment-eval`, `/api/ask`, `/api/plan/review|allocate`, `/api/learn/*`, `/api/alerts*`, `/api/settings*`
- `/api/health`, `/api/status`, `/api/dashboard`

## Suggested demo script

1. **Try the live demo** opens a consolidated portfolio of 20 holdings across stocks, funds, ETFs, gold and an FD, all priced from live data.
2. **True Exposure** shows that HDFC Bank is about 10% of the portfolio once funds are looked through, and the overlap matrix shows two NIFTY trackers with ~99% overlap.
3. **Compare** NIFTY 50, gold and silver in ₹ over 5 years, then open **Forecast** for NIFTY at 1 month. The page shows the 80% range and states honestly whether the model beats the no-change baseline.
4. **Track Record** shows 80%-range coverage close to nominal, with misses listed and the hash chain verified.
5. **Ask FinLex** "Should I buy Reliance?" is declined with the reason. "How much of my portfolio is in banking stocks?" gets a grounded answer with citations.
6. **Plan**: apply the "max 20% gold" preset. A\* returns the nearest constraint-satisfying mixes, and the expert-system rules explain the current portfolio.
7. **Market Pulse** shows the daily brief, headline tone and a quarterly-results summary with its facts kept separate from interpretation.

## Limitations

- Fund look-through uses an illustrative curated snapshot until real AMC disclosures are loaded. Exposure figures are estimates as of each disclosure date.
- The forecasts often fail to beat the naïve baseline, which is expected for liquid markets. FinLex reports this rather than hiding it.
- Statement parsing relies on casparser. Statement formats change over time, which is why there is a review screen before import.
- Schema changes use `create_all` (new tables only). Add Alembic migrations before evolving the schema in production.
- Physical gold and silver use the international reference rate, not Indian retail prices.
