"""Operational CLI: run background jobs from cron when the in-process scheduler is disabled.

    python -m app.cli bootstrap   # load instruments, history, backtests, news
    python -m app.cli refresh     # refresh recent prices, score matured forecasts, evaluate alerts
    python -m app.cli daily       # issue daily core forecasts, purge expired demo users
    python -m app.cli news        # ingest RSS headlines
    python -m app.cli verify      # verify the forecast-log hash chain
"""
from __future__ import annotations

import json
import sys

from .db import SessionLocal, init_db
from .services import exposure, filings, marketdata, news, scheduler, trackrecord


def main(argv: list[str]) -> int:
    if len(argv) != 1 or argv[0] not in {"bootstrap", "refresh", "daily", "news", "verify"}:
        print(__doc__)
        return 2
    init_db()
    db = SessionLocal()
    try:
        marketdata.ensure_instruments(db)
        exposure.seed_fund_holdings(db)
        filings.ensure_sample(db)
        cmd = argv[0]
        if cmd == "verify":
            res = trackrecord.verify_chain(db)
            print(json.dumps(res))
            return 0 if res["ok"] else 1
        fn = {"bootstrap": scheduler.job_bootstrap, "refresh": scheduler.job_refresh,
              "daily": scheduler.job_daily, "news": news.ingest}[cmd]
        print(json.dumps(fn(db), default=str, indent=2))
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
