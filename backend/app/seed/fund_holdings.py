"""Curated fund look-through snapshots.

IMPORTANT: these are *illustrative, approximate* top-holding snapshots curated for FinLex's
look-through demo. They are NOT official AMC disclosures. Every exposure figure built on them is
labelled as an estimate with this source and disclosure date. Load real AMC monthly portfolio
disclosures with POST /api/exposure/fund-holdings (CSV) to replace them.
"""
from __future__ import annotations

import datetime as dt

DISCLOSURE_DATE = dt.date(2026, 9, 30)
SOURCE = "FinLex curated illustrative snapshot (approximate; verify against AMC monthly portfolio)"

# Approximate NIFTY 50 weights (%) used for index funds / ETFs tracking the index.
NIFTY50_WEIGHTS = {
    "HDFCBANK": 12.6, "ICICIBANK": 8.7, "RELIANCE": 8.4, "INFY": 4.9, "BHARTIARTL": 4.6,
    "LT": 3.9, "ITC": 3.3, "TCS": 3.0, "SBIN": 3.1, "AXISBANK": 3.0, "KOTAKBANK": 2.8,
    "M&M": 2.6, "BAJFINANCE": 2.3, "HINDUNILVR": 1.9, "SUNPHARMA": 1.6, "HCLTECH": 1.6,
    "MARUTI": 1.6, "NTPC": 1.4, "ETERNAL": 1.4, "TITAN": 1.3, "ULTRACEMCO": 1.2,
    "TMPV": 1.0, "BEL": 1.3, "POWERGRID": 1.1, "TATASTEEL": 1.1, "ASIANPAINT": 0.9,
    "BAJAJFINSV": 1.0, "TRENT": 0.9, "INDIGO": 1.0, "JSWSTEEL": 0.9, "BAJAJ-AUTO": 0.8,
    "ADANIPORTS": 0.9, "TECHM": 0.8, "GRASIM": 0.8, "HINDALCO": 0.9, "ONGC": 0.8,
    "SHRIRAMFIN": 0.8, "COALINDIA": 0.7, "CIPLA": 0.7, "NESTLEIND": 0.7, "EICHERMOT": 0.8,
    "JIOFIN": 0.8, "SBILIFE": 0.7, "HDFCLIFE": 0.7, "APOLLOHOSP": 0.6, "MAXHEALTH": 0.7,
    "TATACONSUM": 0.6, "DRREDDY": 0.6, "ADANIENT": 0.5, "BSE": 0.7,
}

# Each entry: (symbol or None, display name, sector, asset_type, weight %)
FUNDS: dict[str, list[tuple]] = {
    "122639": [  # Parag Parikh Flexi Cap
        ("HDFCBANK", None, None, "equity", 8.1), ("POWERGRID", None, None, "equity", 6.0),
        ("BAJAJHLDNG", None, None, "equity", 5.8), ("ITC", None, None, "equity", 5.2),
        ("COALINDIA", None, None, "equity", 5.0), ("ICICIBANK", None, None, "equity", 4.9),
        (None, "Alphabet Inc (Class A)", "Communication Services (foreign)", "equity", 4.1),
        (None, "Microsoft Corp", "Information Technology (foreign)", "equity", 3.2),
        (None, "Amazon.com Inc", "Consumer Discretionary (foreign)", "equity", 2.9),
        (None, "Meta Platforms Inc", "Communication Services (foreign)", "equity", 2.6),
        ("MARUTI", None, None, "equity", 3.1), ("HCLTECH", None, None, "equity", 2.6),
        ("KOTAKBANK", None, None, "equity", 2.5), ("INFY", None, None, "equity", 2.0),
        (None, "Other equity holdings (not itemised)", None, "equity", 26.0),
        (None, "Debt & money market", None, "debt", 9.0), (None, "Cash & equivalents", None, "cash", 6.0),
    ],
    "118955": [  # HDFC Flexi Cap
        ("ICICIBANK", None, None, "equity", 9.4), ("HDFCBANK", None, None, "equity", 9.1),
        ("AXISBANK", None, None, "equity", 8.3), ("KOTAKBANK", None, None, "equity", 4.6),
        ("CIPLA", None, None, "equity", 4.2), ("HCLTECH", None, None, "equity", 4.0),
        ("SBILIFE", None, None, "equity", 3.6), ("BHARTIARTL", None, None, "equity", 3.5),
        ("SBIN", None, None, "equity", 3.0), ("MARUTI", None, None, "equity", 2.9),
        ("ETERNAL", None, None, "equity", 2.4), ("RELIANCE", None, None, "equity", 2.2),
        (None, "Other equity holdings (not itemised)", None, "equity", 35.8),
        (None, "Cash & equivalents", None, "cash", 7.0),
    ],
    "120586": [  # ICICI Prudential Large Cap
        ("ICICIBANK", None, None, "equity", 9.3), ("HDFCBANK", None, None, "equity", 8.8),
        ("RELIANCE", None, None, "equity", 6.6), ("LT", None, None, "equity", 6.1),
        ("MARUTI", None, None, "equity", 4.6), ("AXISBANK", None, None, "equity", 4.4),
        ("INFY", None, None, "equity", 3.9), ("ULTRACEMCO", None, None, "equity", 3.5),
        ("BHARTIARTL", None, None, "equity", 3.3), ("SUNPHARMA", None, None, "equity", 2.6),
        ("SBIN", None, None, "equity", 2.4), ("NTPC", None, None, "equity", 2.0),
        (None, "Other equity holdings (not itemised)", None, "equity", 34.2),
        (None, "Cash & equivalents", None, "cash", 8.3),
    ],
    "118825": [  # Mirae Asset Large Cap
        ("HDFCBANK", None, None, "equity", 9.7), ("ICICIBANK", None, None, "equity", 8.1),
        ("RELIANCE", None, None, "equity", 6.0), ("INFY", None, None, "equity", 5.4),
        ("AXISBANK", None, None, "equity", 4.1), ("LT", None, None, "equity", 3.7),
        ("BHARTIARTL", None, None, "equity", 3.6), ("SBIN", None, None, "equity", 3.4),
        ("TCS", None, None, "equity", 3.0), ("ITC", None, None, "equity", 2.9),
        ("KOTAKBANK", None, None, "equity", 2.8), ("M&M", None, None, "equity", 2.4),
        (None, "Other equity holdings (not itemised)", None, "equity", 42.4),
        (None, "Cash & equivalents", None, "cash", 2.5),
    ],
    "119598": [  # SBI Large Cap
        ("HDFCBANK", None, None, "equity", 9.4), ("ICICIBANK", None, None, "equity", 7.4),
        ("RELIANCE", None, None, "equity", 6.1), ("LT", None, None, "equity", 5.0),
        ("INFY", None, None, "equity", 4.4), ("KOTAKBANK", None, None, "equity", 4.0),
        ("AXISBANK", None, None, "equity", 3.6), ("ITC", None, None, "equity", 3.1),
        ("TCS", None, None, "equity", 2.9), ("MARUTI", None, None, "equity", 2.9),
        ("DIVISLAB", None, None, "equity", 2.2), ("BRITANNIA", None, None, "equity", 2.0),
        (None, "Other equity holdings (not itemised)", None, "equity", 41.5),
        (None, "Cash & equivalents", None, "cash", 5.5),
    ],
    "118632": [  # Nippon India Large Cap
        ("HDFCBANK", None, None, "equity", 8.9), ("RELIANCE", None, None, "equity", 7.1),
        ("ICICIBANK", None, None, "equity", 5.8), ("AXISBANK", None, None, "equity", 4.3),
        ("LT", None, None, "equity", 4.0), ("SBIN", None, None, "equity", 3.9),
        ("BAJFINANCE", None, None, "equity", 3.5), ("ITC", None, None, "equity", 3.4),
        ("INFY", None, None, "equity", 3.2), ("NTPC", None, None, "equity", 2.6),
        ("TATAPOWER", None, None, "equity", 2.0), ("DMART", None, None, "equity", 1.9),
        (None, "Other equity holdings (not itemised)", None, "equity", 46.4),
        (None, "Cash & equivalents", None, "cash", 3.0),
    ],
    "120465": [  # Axis Large Cap
        ("HDFCBANK", None, None, "equity", 9.5), ("ICICIBANK", None, None, "equity", 8.6),
        ("BAJFINANCE", None, None, "equity", 5.1), ("RELIANCE", None, None, "equity", 5.0),
        ("INFY", None, None, "equity", 4.5), ("BHARTIARTL", None, None, "equity", 4.0),
        ("TCS", None, None, "equity", 3.9), ("LT", None, None, "equity", 3.5),
        ("M&M", None, None, "equity", 3.1), ("SUNPHARMA", None, None, "equity", 3.0),
        ("PIDILITIND", None, None, "equity", 2.2), ("HAL", None, None, "equity", 1.8),
        (None, "Other equity holdings (not itemised)", None, "equity", 40.8),
        (None, "Cash & equivalents", None, "cash", 5.0),
    ],
    "118989": [  # HDFC Mid Cap
        ("MAXHEALTH", None, None, "equity", 4.1), ("INDHOTEL", None, None, "equity", 3.7),
        ("COFORGE", None, None, "equity", 3.5), ("PERSISTENT", None, None, "equity", 3.1),
        ("FEDERALBNK", None, None, "equity", 3.2), ("AUBANK", None, None, "equity", 2.8),
        ("IDFCFIRSTB", None, None, "equity", 2.4), ("POLYCAB", None, None, "equity", 2.2),
        ("MPHASIS", None, None, "equity", 2.1), ("BANKBARODA", None, None, "equity", 1.9),
        (None, "Hindustan Petroleum Corporation Ltd.", "Oil Gas & Consumable Fuels", "equity", 2.6),
        (None, "Balkrishna Industries Ltd.", "Automobile and Auto Components", "equity", 2.3),
        (None, "Other equity holdings (not itemised)", None, "equity", 58.1),
        (None, "Cash & equivalents", None, "cash", 6.0),
    ],
    "118778": [  # Nippon India Small Cap
        ("MCX", None, None, "equity", 2.4), ("HDFCBANK", None, None, "equity", 1.9),
        ("KPITTECH", None, None, "equity", 1.5), ("DIXON", None, None, "equity", 1.2),
        ("CDSL", None, None, "equity", 1.1), ("SBIN", None, None, "equity", 1.0),
        (None, "Karur Vysya Bank Ltd.", "Financial Services", "equity", 1.6),
        (None, "Tube Investments of India Ltd.", "Automobile and Auto Components", "equity", 1.5),
        (None, "Apar Industries Ltd.", "Capital Goods", "equity", 1.4),
        (None, "Kirloskar Brothers Ltd.", "Capital Goods", "equity", 1.0),
        (None, "Other equity holdings (not itemised)", None, "equity", 80.4),
        (None, "Cash & equivalents", None, "cash", 5.0),
    ],
    "120594": [  # ICICI Prudential Technology
        ("INFY", None, None, "equity", 19.8), ("TCS", None, None, "equity", 11.2),
        ("BHARTIARTL", None, None, "equity", 9.1), ("HCLTECH", None, None, "equity", 8.2),
        ("TECHM", None, None, "equity", 6.1), ("LTM", None, None, "equity", 4.9),
        ("ETERNAL", None, None, "equity", 4.2), ("PERSISTENT", None, None, "equity", 3.6),
        ("COFORGE", None, None, "equity", 3.0), ("KPITTECH", None, None, "equity", 2.1),
        (None, "Other equity holdings (not itemised)", None, "equity", 24.8),
        (None, "Cash & equivalents", None, "cash", 3.0),
    ],
    "148986": [  # HDFC Banking & Financial Services
        ("HDFCBANK", None, None, "equity", 19.2), ("ICICIBANK", None, None, "equity", 17.6),
        ("AXISBANK", None, None, "equity", 8.1), ("SBIN", None, None, "equity", 7.0),
        ("KOTAKBANK", None, None, "equity", 5.2), ("BAJFINANCE", None, None, "equity", 4.1),
        ("SBILIFE", None, None, "equity", 3.2), ("HDFCLIFE", None, None, "equity", 3.0),
        ("SHRIRAMFIN", None, None, "equity", 3.0), ("CHOLAFIN", None, None, "equity", 2.6),
        ("IDFCFIRSTB", None, None, "equity", 2.0),
        (None, "Other equity holdings (not itemised)", None, "equity", 21.0),
        (None, "Cash & equivalents", None, "cash", 4.0),
    ],
    "118968": [  # HDFC Balanced Advantage
        ("HDFCBANK", None, None, "equity", 5.1), ("ICICIBANK", None, None, "equity", 4.4),
        ("RELIANCE", None, None, "equity", 3.4), ("NTPC", None, None, "equity", 3.1),
        ("COALINDIA", None, None, "equity", 2.9), ("SBIN", None, None, "equity", 2.9),
        ("LT", None, None, "equity", 2.5), ("INFY", None, None, "equity", 2.4),
        ("ITC", None, None, "equity", 2.1), ("BHARTIARTL", None, None, "equity", 2.0),
        (None, "Other equity holdings (not itemised)", None, "equity", 25.2),
        (None, "Government securities & bonds", None, "debt", 31.0),
        (None, "Cash & equivalents", None, "cash", 13.0),
    ],
    "119091": [  # HDFC Liquid
        (None, "Treasury bills & money market", None, "debt", 92.0),
        (None, "Cash & equivalents", None, "cash", 8.0),
    ],
}

INDEX_TRACKERS = ["120716", "119063"]  # Nifty 50 index funds
ETF_LOOKTHROUGH = {
    "NIFTYBEES": "nifty50",
    "GOLDBEES": "gold",
    "SILVERBEES": "silver",
}
