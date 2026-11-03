"""Instrument master seed.

NIFTY 50 constituents and industry classification follow the niftyindices.com constituent list
(ind_nifty50list.csv, retrieved Nov 2026). Mutual-fund scheme codes are AMFI scheme codes
(portal.amfiindia.com NAVAll.txt). ``ref_price`` values are only used to anchor the
*synthetic* offline price generator; live mode always uses provider prices.
"""
from __future__ import annotations

NIFTY50 = [
    # symbol, company, industry, isin, ref_price
    ("ADANIENT", "Adani Enterprises Ltd.", "Metals & Mining", "INE423A01024", 2450),
    ("ADANIPORTS", "Adani Ports and Special Economic Zone Ltd.", "Services", "INE742F01042", 1420),
    ("APOLLOHOSP", "Apollo Hospitals Enterprise Ltd.", "Healthcare", "INE437A01024", 7400),
    ("ASIANPAINT", "Asian Paints Ltd.", "Consumer Durables", "INE021A01026", 2450),
    ("AXISBANK", "Axis Bank Ltd.", "Financial Services", "INE238A01034", 1180),
    ("BSE", "BSE Ltd.", "Financial Services", "INE118H01025", 3660),
    ("BAJAJ-AUTO", "Bajaj Auto Ltd.", "Automobile and Auto Components", "INE917I01010", 10540),
    ("BAJFINANCE", "Bajaj Finance Ltd.", "Financial Services", "INE296A01032", 1020),
    ("BAJAJFINSV", "Bajaj Finserv Ltd.", "Financial Services", "INE918I01026", 2050),
    ("BEL", "Bharat Electronics Ltd.", "Capital Goods", "INE263A01024", 410),
    ("BHARTIARTL", "Bharti Airtel Ltd.", "Telecommunication", "INE397D01024", 2050),
    ("CIPLA", "Cipla Ltd.", "Healthcare", "INE059A01026", 1540),
    ("COALINDIA", "Coal India Ltd.", "Oil Gas & Consumable Fuels", "INE522F01014", 390),
    ("DRREDDY", "Dr. Reddy's Laboratories Ltd.", "Healthcare", "INE089A01031", 1250),
    ("EICHERMOT", "Eicher Motors Ltd.", "Automobile and Auto Components", "INE066A01021", 6900),
    ("ETERNAL", "Eternal Ltd.", "Consumer Services", "INE758T01015", 349),
    ("GRASIM", "Grasim Industries Ltd.", "Construction Materials", "INE047A01021", 2800),
    ("HCLTECH", "HCL Technologies Ltd.", "Information Technology", "INE860A01027", 1530),
    ("HDFCBANK", "HDFC Bank Ltd.", "Financial Services", "INE040A01034", 1000),
    ("HDFCLIFE", "HDFC Life Insurance Company Ltd.", "Financial Services", "INE795G01014", 760),
    ("HINDALCO", "Hindalco Industries Ltd.", "Metals & Mining", "INE038A01020", 820),
    ("HINDUNILVR", "Hindustan Unilever Ltd.", "Fast Moving Consumer Goods", "INE030A01027", 2480),
    ("ICICIBANK", "ICICI Bank Ltd.", "Financial Services", "INE090A01021", 1380),
    ("ITC", "ITC Ltd.", "Fast Moving Consumer Goods", "INE154A01025", 410),
    ("INFY", "Infosys Ltd.", "Information Technology", "INE009A01021", 1490),
    ("INDIGO", "InterGlobe Aviation Ltd.", "Services", "INE646L01027", 5600),
    ("JSWSTEEL", "JSW Steel Ltd.", "Metals & Mining", "INE019A01038", 1150),
    ("JIOFIN", "Jio Financial Services Ltd.", "Financial Services", "INE758E01017", 214),
    ("KOTAKBANK", "Kotak Mahindra Bank Ltd.", "Financial Services", "INE237A01036", 2100),
    ("LT", "Larsen & Toubro Ltd.", "Construction", "INE018A01030", 3900),
    ("M&M", "Mahindra & Mahindra Ltd.", "Automobile and Auto Components", "INE101A01026", 2908),
    ("MARUTI", "Maruti Suzuki India Ltd.", "Automobile and Auto Components", "INE585B01010", 15800),
    ("MAXHEALTH", "Max Healthcare Institute Ltd.", "Healthcare", "INE027H01010", 1150),
    ("NTPC", "NTPC Ltd.", "Power", "INE733E01010", 340),
    ("NESTLEIND", "Nestle India Ltd.", "Fast Moving Consumer Goods", "INE239A01024", 1250),
    ("ONGC", "Oil & Natural Gas Corporation Ltd.", "Oil Gas & Consumable Fuels", "INE213A01029", 250),
    ("POWERGRID", "Power Grid Corporation of India Ltd.", "Power", "INE752E01010", 290),
    ("RELIANCE", "Reliance Industries Ltd.", "Oil Gas & Consumable Fuels", "INE002A01018", 1480),
    ("SBILIFE", "SBI Life Insurance Company Ltd.", "Financial Services", "INE123W01016", 1850),
    ("SHRIRAMFIN", "Shriram Finance Ltd.", "Financial Services", "INE721A01047", 680),
    ("SBIN", "State Bank of India", "Financial Services", "INE062A01020", 880),
    ("SUNPHARMA", "Sun Pharmaceutical Industries Ltd.", "Healthcare", "INE044A01036", 1700),
    ("TCS", "Tata Consultancy Services Ltd.", "Information Technology", "INE467B01029", 3050),
    ("TATACONSUM", "Tata Consumer Products Ltd.", "Fast Moving Consumer Goods", "INE192A01025", 1150),
    ("TMPV", "Tata Motors Passenger Vehicles Ltd.", "Automobile and Auto Components", "INE155A01022", 277),
    ("TATASTEEL", "Tata Steel Ltd.", "Metals & Mining", "INE081A01020", 170),
    ("TECHM", "Tech Mahindra Ltd.", "Information Technology", "INE669C01036", 1480),
    ("TITAN", "Titan Company Ltd.", "Consumer Durables", "INE280A01028", 3600),
    ("TRENT", "Trent Ltd.", "Consumer Services", "INE849A01020", 4800),
    ("ULTRACEMCO", "UltraTech Cement Ltd.", "Construction Materials", "INE481G01011", 12100),
]

# Frequently held outside NIFTY 50 (used in fund look-through and manual entry).
OTHER_EQUITIES = [
    ("DMART", "Avenue Supermarts Ltd.", "Consumer Services", "Large cap", 4100),
    ("PIDILITIND", "Pidilite Industries Ltd.", "Chemicals", "Large cap", 1500),
    ("HAL", "Hindustan Aeronautics Ltd.", "Capital Goods", "Large cap", 4600),
    ("LTM", "LTM Ltd. (formerly LTIMindtree)", "Information Technology", "Large cap", 5600),
    ("DIVISLAB", "Divi's Laboratories Ltd.", "Healthcare", "Large cap", 6300),
    ("BRITANNIA", "Britannia Industries Ltd.", "Fast Moving Consumer Goods", "Large cap", 5800),
    ("HEROMOTOCO", "Hero MotoCorp Ltd.", "Automobile and Auto Components", "Large cap", 5300),
    ("INDUSINDBK", "IndusInd Bank Ltd.", "Financial Services", "Large cap", 780),
    ("BANKBARODA", "Bank of Baroda", "Financial Services", "Large cap", 260),
    ("TATAPOWER", "Tata Power Company Ltd.", "Power", "Large cap", 400),
    ("PFC", "Power Finance Corporation Ltd.", "Financial Services", "Large cap", 410),
    ("CHOLAFIN", "Cholamandalam Investment and Finance Company Ltd.", "Financial Services", "Large cap", 1600),
    ("DIXON", "Dixon Technologies (India) Ltd.", "Consumer Durables", "Mid cap", 16000),
    ("POLYCAB", "Polycab India Ltd.", "Capital Goods", "Mid cap", 7200),
    ("PERSISTENT", "Persistent Systems Ltd.", "Information Technology", "Mid cap", 5700),
    ("COFORGE", "Coforge Ltd.", "Information Technology", "Mid cap", 1750),
    ("MPHASIS", "Mphasis Ltd.", "Information Technology", "Mid cap", 2800),
    ("FEDERALBNK", "The Federal Bank Ltd.", "Financial Services", "Mid cap", 210),
    ("IDFCFIRSTB", "IDFC First Bank Ltd.", "Financial Services", "Mid cap", 72),
    ("AUBANK", "AU Small Finance Bank Ltd.", "Financial Services", "Mid cap", 760),
    ("KPITTECH", "KPIT Technologies Ltd.", "Information Technology", "Mid cap", 1300),
    ("SUZLON", "Suzlon Energy Ltd.", "Capital Goods", "Mid cap", 62),
    ("IRCTC", "Indian Railway Catering and Tourism Corporation Ltd.", "Consumer Services", "Mid cap", 760),
    ("CDSL", "Central Depository Services (India) Ltd.", "Financial Services", "Small cap", 1600),
    ("ANGELONE", "Angel One Ltd.", "Financial Services", "Small cap", 2500),
    ("MCX", "Multi Commodity Exchange of India Ltd.", "Financial Services", "Small cap", 8000),
    ("INDHOTEL", "The Indian Hotels Company Ltd.", "Consumer Services", "Mid cap", 760),
    ("BAJAJHLDNG", "Bajaj Holdings & Investment Ltd.", "Financial Services", "Large cap", 12800),
]

INDICES = [
    ("NIFTY50", "NIFTY 50", "^NSEI", 23800),
    ("SENSEX", "S&P BSE SENSEX", "^BSESN", 76900),
    ("BANKNIFTY", "NIFTY Bank", "^NSEBANK", 55500),
    ("NIFTYIT", "NIFTY IT", "^CNXIT", 32500),
]

ETFS = [
    ("GOLDBEES", "Nippon India ETF Gold BeES", "GOLDBEES.NS", "gold", 112),
    ("SILVERBEES", "Nippon India Silver ETF", "SILVERBEES.NS", "silver", 166),
    ("NIFTYBEES", "Nippon India ETF Nifty 50 BeES", "NIFTYBEES.NS", "equity", 270),
]

# Reference precious-metal series derived from COMEX futures x USD/INR (international reference,
# excludes Indian import duty, GST and dealer premiums).
METALS = [
    ("GOLD", "Gold reference (INR per 10 g, 24K)", "gold", "INR/10g", 120000),
    ("SILVER", "Silver reference (INR per kg)", "silver", "INR/kg", 150000),
]

# AMFI scheme code, name, category, ref NAV
MUTUAL_FUNDS = [
    ("122639", "Parag Parikh Flexi Cap Fund - Direct Plan - Growth", "Flexi Cap", 89.7),
    ("118955", "HDFC Flexi Cap Fund - Direct Plan - Growth", "Flexi Cap", 2207),
    ("120586", "ICICI Prudential Large Cap Fund - Direct Plan - Growth", "Large Cap", 115),
    ("118825", "Mirae Asset Large Cap Fund - Direct Plan - Growth", "Large Cap", 123),
    ("119598", "SBI Large Cap Fund - Direct Plan - Growth", "Large Cap", 100),
    ("118632", "Nippon India Large Cap Fund - Direct Plan - Growth", "Large Cap", 97),
    ("120465", "Axis Large Cap Fund - Direct Plan - Growth", "Large Cap", 68),
    ("120716", "UTI Nifty 50 Index Fund - Direct Plan - Growth", "Index Fund", 165),
    ("119063", "HDFC Nifty 50 Index Fund - Direct Plan - Growth", "Index Fund", 229),
    ("118989", "HDFC Mid Cap Fund - Direct Plan - Growth", "Mid Cap", 218),
    ("118778", "Nippon India Small Cap Fund - Direct Plan - Growth", "Small Cap", 195),
    ("120594", "ICICI Prudential Technology Fund - Direct Plan - Growth", "Sectoral - Technology", 207),
    ("148986", "HDFC Banking & Financial Services Fund - Direct Plan - Growth", "Sectoral - Banking & FS", 18),
    ("118968", "HDFC Balanced Advantage Fund - Direct Plan - Growth", "Balanced Advantage", 553),
    ("119091", "HDFC Liquid Fund - Direct Plan - Growth", "Liquid", 5621),
]

# Synthetic-generator parameters by asset class: (annual drift, annual vol)
SYNTH_PARAMS = {
    "index": (0.11, 0.15),
    "equity": (0.13, 0.27),
    "mf": (0.12, 0.16),
    "etf": (0.10, 0.15),
    "gold": (0.10, 0.14),
    "silver": (0.11, 0.26),
}
MF_SYNTH = {
    "Liquid": (0.065, 0.004),
    "Balanced Advantage": (0.10, 0.09),
    "Small Cap": (0.16, 0.24),
    "Mid Cap": (0.15, 0.21),
}
