"""Learn centre content: glossary + short lessons with knowledge checks (educational only)."""
from __future__ import annotations

GLOSSARY = [
    {"term": "XIRR", "category": "Returns", "aliases": ["extended internal rate of return", "irr"],
     "definition": "An annualised return that accounts for when each rupee went in or came out. Useful for SIPs and "
                   "irregular investments, where a simple percentage gain is misleading.",
     "example": "₹10,000 invested in January and ₹10,000 in July, worth ₹22,000 in December, has a higher XIRR "
                "than the same ₹2,000 gain on a single January investment, because half the money was invested for "
                "only six months."},
    {"term": "CAGR", "category": "Returns", "aliases": ["compound annual growth rate"],
     "definition": "The constant yearly growth rate that would take a starting value to an ending value over a period.",
     "example": "₹100 growing to ₹161 in 5 years is a CAGR of about 10%."},
    {"term": "Absolute return", "category": "Returns", "aliases": ["total return"],
     "definition": "The simple percentage change from what you invested to what it is worth now, ignoring time."},
    {"term": "Time-weighted return", "category": "Returns", "aliases": ["twr"],
     "definition": "Return that removes the effect of deposits and withdrawals, showing how the investments themselves "
                   "performed. Good for comparing with an index."},
    {"term": "Expense ratio", "category": "Mutual funds", "aliases": ["ter", "total expense ratio"],
     "definition": "The annual fee a mutual fund charges, as a percentage of your investment, deducted from the NAV daily.",
     "example": "A 1% expense ratio on ₹1,00,000 costs about ₹1,000 a year."},
    {"term": "NAV", "category": "Mutual funds", "aliases": ["net asset value"],
     "definition": "The per-unit value of a mutual fund, published by AMFI after each business day."},
    {"term": "Direct vs regular plan", "category": "Mutual funds", "aliases": ["direct plan", "regular plan"],
     "definition": "The same fund in two versions: direct plans have no distributor commission and so a lower expense ratio."},
    {"term": "SIP", "category": "Mutual funds", "aliases": ["systematic investment plan"],
     "definition": "Investing a fixed amount at regular intervals (usually monthly) instead of a lump sum."},
    {"term": "Portfolio overlap", "category": "Exposure", "aliases": ["overlap", "fund overlap"],
     "definition": "How much two funds hold the same stocks. FinLex measures it as the sum, over shared stocks, of the "
                   "smaller of the two funds' weights.",
     "example": "If Fund A holds 9% HDFC Bank and Fund B 7%, that stock adds 7 percentage points of overlap."},
    {"term": "True exposure", "category": "Exposure", "aliases": ["look-through", "look through exposure"],
     "definition": "Your combined holding of a company once direct shares and the company's weight inside each of your "
                   "funds are added together."},
    {"term": "Concentration", "category": "Risk", "aliases": [],
     "definition": "How much of your portfolio depends on a single company, sector or asset class."},
    {"term": "Diversification", "category": "Risk", "aliases": [],
     "definition": "Spreading money across holdings that don't all move together, so one bad outcome hurts less."},
    {"term": "Volatility", "category": "Risk", "aliases": ["standard deviation", "vol"],
     "definition": "How much returns typically swing around their average. FinLex shows it annualised: daily "
                   "standard deviation × √252."},
    {"term": "Drawdown", "category": "Risk", "aliases": ["max drawdown", "maximum drawdown"],
     "definition": "The fall from a previous peak to a later low. Maximum drawdown is the worst such fall in a period.",
     "example": "A fund that rose to ₹120 and later fell to ₹90 had a 25% drawdown."},
    {"term": "Correlation", "category": "Risk", "aliases": [],
     "definition": "A number from −1 to +1 describing how two assets' daily returns move together. Gold has often had "
                   "low correlation with Indian equities."},
    {"term": "Benchmark", "category": "Markets", "aliases": ["index"],
     "definition": "A reference, such as NIFTY 50, used to judge whether a fund or portfolio did better or worse."},
    {"term": "NIFTY 50", "category": "Markets", "aliases": ["nifty"],
     "definition": "An index of 50 large Indian companies listed on the NSE, weighted by free-float market cap."},
    {"term": "Market capitalisation", "category": "Markets", "aliases": ["market cap", "large cap", "mid cap", "small cap"],
     "definition": "Share price × number of shares. SEBI classifies the top 100 companies as large cap, 101–250 as mid "
                   "cap and the rest as small cap."},
    {"term": "ETF", "category": "Markets", "aliases": ["exchange traded fund"],
     "definition": "A fund that trades on the stock exchange like a share, usually tracking an index or a commodity "
                   "such as gold."},
    {"term": "Gold reference price", "category": "Markets", "aliases": ["spot gold", "gold price"],
     "definition": "FinLex's gold series converts the international COMEX price to INR. Indian retail prices are higher "
                   "because of import duty, GST and dealer premiums."},
    {"term": "Fixed deposit", "category": "Debt", "aliases": ["fd"],
     "definition": "A bank deposit for a fixed term at a fixed interest rate. Interest is taxable at your slab rate."},
    {"term": "CAMS / KFintech CAS", "category": "Data", "aliases": ["cams", "cas", "consolidated account statement", "cdsl", "nsdl"],
     "definition": "A consolidated account statement listing your mutual-fund folios and transactions (CAMS/KFintech) "
                   "or demat holdings (CDSL/NSDL). FinLex can read the CAMS/KFintech PDF locally."},
    {"term": "Prediction interval", "category": "Forecasting", "aliases": ["forecast range", "interval", "range"],
     "definition": "A range expected to contain the future value with a stated probability. An 80% interval should "
                   "contain the outcome about 8 times in 10 — and miss about 2 times in 10."},
    {"term": "Interval coverage", "category": "Forecasting", "aliases": ["coverage", "hit rate", "calibration"],
     "definition": "The share of past forecasts whose actual outcome fell inside the stated interval. For an honest "
                   "80% interval, coverage should be close to 80%: much lower means overconfident, much higher means "
                   "too wide to be useful.",
     "example": "If 100 past 80% ranges contained the outcome 77 times, coverage is 77%."},
    {"term": "Baseline (naïve) model", "category": "Forecasting", "aliases": ["naive", "baseline", "random walk"],
     "definition": "A trivial forecast such as \"no change\". If a model can't beat it out of sample, its forecasts add "
                   "little value — and FinLex says so."},
    {"term": "Walk-forward validation", "category": "Forecasting", "aliases": ["walk forward", "rolling origin", "backtest"],
     "definition": "Testing a model by repeatedly training on the past and forecasting the next unseen period, moving "
                   "forward in time, just as it would be used live."},
    {"term": "Look-ahead bias", "category": "Forecasting", "aliases": ["leakage", "data leakage"],
     "definition": "Accidentally using information that wouldn't have been available at forecast time, which makes "
                   "backtests look better than reality."},
    {"term": "MAE / RMSE", "category": "Forecasting", "aliases": ["mae", "rmse", "mean absolute error"],
     "definition": "Average size of forecast errors. RMSE penalises large misses more than MAE."},
    {"term": "Conformal prediction", "category": "Forecasting", "aliases": ["conformal", "split conformal"],
     "definition": "A way to build intervals from a model's errors on held-back recent data, so stated coverage is "
                   "backed by evidence rather than assumptions."},
    {"term": "Ridge regression", "category": "Models", "aliases": ["ridge"],
     "definition": "A linear model with a penalty that keeps coefficients small, reducing overfitting. Its coefficients "
                   "show which features it associates with returns."},
    {"term": "XGBoost", "category": "Models", "aliases": ["gradient boosting"],
     "definition": "An ensemble of small decision trees, each correcting the previous ones' errors; can capture "
                   "non-linear patterns but can also overfit noise."},
    {"term": "Chronos", "category": "Models", "aliases": [],
     "definition": "A pretrained transformer for time-series forecasting. Optional in FinLex and only shown once it is "
                   "benchmarked against simpler baselines."},
    {"term": "VAE", "category": "Models", "aliases": ["variational autoencoder", "scenarios"],
     "definition": "A generative neural network that learns the shape of historical return paths and samples new, "
                   "synthetic ones for what-if exploration. Scenarios are not predictions."},
    {"term": "Autoencoder", "category": "Models", "aliases": [],
     "definition": "A neural network trained to reconstruct its input. Inputs it reconstructs poorly look unusual — "
                   "FinLex uses this to flag suspicious fund-holdings data for review."},
    {"term": "Sentiment (tone)", "category": "Models", "aliases": ["finbert", "news sentiment", "sentiment"],
     "definition": "Whether a headline's wording is positive, negative or neutral. It describes language, not where a "
                   "price will go."},
    {"term": "Constraint satisfaction", "category": "Models", "aliases": ["csp"],
     "definition": "Finding values (here, allocation percentages) that satisfy all the rules you set, such as \"gold at "
                   "most 20%\"."},
    {"term": "A* search", "category": "Models", "aliases": ["a star", "astar"],
     "definition": "A search algorithm that explores the most promising options first using a cost-so-far plus a "
                   "never-overestimating guess of the remaining cost. FinLex uses it to find constraint-satisfying "
                   "mixes closest to your current one."},
    {"term": "SEBI", "category": "Regulation", "aliases": ["securities and exchange board of india", "investment adviser", "ria"],
     "definition": "India's securities-market regulator. Personalised investment advice requires SEBI registration as an "
                   "investment adviser — which is why FinLex does not give buy/sell/hold calls."},
]

LESSONS = [
    {"id": "what-you-own", "title": "What do you really own?", "minutes": 4, "level": "Beginner",
     "body": [
         "A portfolio is the sum of everything you hold: shares, mutual funds, ETFs, gold, silver and deposits.",
         "Each holding has a cost (what you paid) and a value (what it's worth now). The difference is your unrealised gain or loss.",
         "Because money often goes in at different times, a simple percentage gain can mislead. XIRR adjusts for timing.",
     ],
     "quiz": [
         {"q": "You invested ₹50,000 and it's now worth ₹55,000. What's the unrealised gain?",
          "options": ["₹5,000", "₹55,000", "10% per year, guaranteed"], "answer": 0,
          "explain": "Value minus cost = ₹5,000 (10%). Whether that's good depends on how long it took."},
         {"q": "Why use XIRR for SIPs?", "options": ["It accounts for when each instalment was invested",
                                                   "It always shows a higher number", "It predicts future returns"],
          "answer": 0, "explain": "XIRR weights each cash flow by how long it was invested."},
     ]},
    {"id": "overlap", "title": "Mutual-fund overlap and true exposure", "minutes": 5, "level": "Beginner",
     "body": [
         "Different funds often buy the same large companies. Owning five large-cap funds may mean owning HDFC Bank five times.",
         "True exposure adds your direct shares to your share of each fund's holding: value in fund × fund's weight.",
         "Overlap between two funds is the sum of the smaller weight of every stock they both hold.",
     ],
     "quiz": [
         {"q": "You have ₹1,00,000 in a fund holding 8% Reliance. Your indirect Reliance exposure is…",
          "options": ["₹8,000", "₹80,000", "₹800"], "answer": 0, "explain": "₹1,00,000 × 8% = ₹8,000."},
         {"q": "Fund A holds 9% of a stock, Fund B 6%. That stock's contribution to overlap is…",
          "options": ["6 percentage points", "15 percentage points", "3 percentage points"], "answer": 0,
          "explain": "Overlap counts the smaller of the two weights."},
     ]},
    {"id": "risk", "title": "Volatility, drawdown and diversification", "minutes": 5, "level": "Beginner",
     "body": [
         "Volatility measures how much returns swing. Higher volatility means a wider range of possible outcomes.",
         "Drawdown is the fall from a peak. It shows what a bad period actually felt like.",
         "Diversification works when holdings don't move together — correlation tells you how much they do.",
     ],
     "quiz": [
         {"q": "A fund went from ₹200 to ₹150 before recovering. Its drawdown was…",
          "options": ["25%", "50%", "33%"], "answer": 0, "explain": "(200 − 150) / 200 = 25%."},
         {"q": "Two assets with correlation near 0…", "options": ["tend to move independently", "always move opposite",
                                                                  "always move together"],
          "answer": 0, "explain": "Correlation near zero means little linear relationship between daily returns."},
     ]},
    {"id": "gold-vs-equity", "title": "Gold, silver and equities in rupees", "minutes": 4, "level": "Intermediate",
     "body": [
         "International gold is priced in US dollars per troy ounce. In INR terms, a weaker rupee raises the gold price even if dollar gold is flat.",
         "Gold ETFs track domestic gold prices, which include import duty; FinLex's reference series excludes duty and GST.",
         "Compare assets over the same dates and in the same currency — and remember past returns don't predict future ones.",
     ],
     "quiz": [
         {"q": "If dollar gold is flat and the rupee weakens, INR gold…",
          "options": ["rises", "falls", "is unchanged"], "answer": 0, "explain": "More rupees are needed per dollar."},
     ]},
    {"id": "forecast-honesty", "title": "Reading a forecast honestly", "minutes": 6, "level": "Intermediate",
     "body": [
         "A single number forecast hides uncertainty. FinLex shows a range (interval) with a stated probability.",
         "An 80% interval should miss about 20% of the time. If it misses far more, the model is overconfident.",
         "Every model is compared with a naïve no-change baseline using walk-forward testing. If it doesn't beat the baseline, FinLex says so.",
         "The Track Record page keeps every forecast — hits and misses — and you can verify none were altered.",
     ],
     "quiz": [
         {"q": "Out of 100 past 80% intervals, 79 contained the outcome. This model is…",
          "options": ["well calibrated", "useless", "overconfident"], "answer": 0,
          "explain": "79% observed vs 80% stated is close to calibrated."},
         {"q": "A model's error is larger than the no-change baseline's. FinLex will…",
          "options": ["say it doesn't beat the baseline", "hide the model", "round the numbers up"],
          "answer": 0, "explain": "Honest reporting is a feature."},
     ]},
    {"id": "evaluation", "title": "How models are tested without cheating", "minutes": 6, "level": "Advanced",
     "body": [
         "Time-series data must be split in time order — shuffling lets the model peek at the future.",
         "Walk-forward validation trains on the past, forecasts the next unseen block, then moves forward.",
         "A purge gap removes training rows whose target period overlaps the test period (avoiding label leakage).",
         "Scalers and feature transforms are fit only on training data inside each fold.",
     ],
     "quiz": [
         {"q": "Why not randomly shuffle daily returns before splitting train/test?",
          "options": ["It leaks future information into training", "It is slower", "It changes the units"],
          "answer": 0, "explain": "Shuffling mixes future observations into the training set."},
     ]},
    {"id": "filings", "title": "Reading quarterly results", "minutes": 5, "level": "Intermediate",
     "body": [
         "Results tables usually show the current quarter, the previous quarter and the same quarter last year.",
         "YoY (year-on-year) comparisons remove seasonality; QoQ shows recent momentum.",
         "Exceptional items and impairments can distort profit for a single quarter — read the notes.",
     ],
     "quiz": [
         {"q": "Revenue ₹110 cr this quarter vs ₹100 cr a year ago. YoY growth is…",
          "options": ["10%", "110%", "1%"], "answer": 0, "explain": "(110 − 100) / 100 = 10%."},
     ]},
    {"id": "advice-boundary", "title": "Why FinLex won't give tips", "minutes": 3, "level": "Beginner",
     "body": [
         "In India, personalised investment advice requires SEBI registration as an investment adviser.",
         "FinLex is an educational tool: it explains what you own, what the data says and how uncertain estimates are.",
         "Decisions remain yours — consider a SEBI-registered adviser for personalised advice.",
     ],
     "quiz": [
         {"q": "Which can FinLex do?", "options": ["Show your sector concentration", "Tell you which stock to buy",
                                                   "Guarantee a return"],
          "answer": 0, "explain": "FinLex describes facts and uncertainty; it doesn't recommend trades."},
     ]},
]
