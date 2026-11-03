"""Financial-headline tone classification.

Default engine: a transparent finance lexicon (Loughran–McDonald-style positive/negative word lists
extended with Indian-market phrasing) with negation and intensifier handling. If the optional
``transformers`` package and the ProsusAI/finbert weights are installed and FINLEX_USE_FINBERT=1,
FinBERT is used instead. Output is a *language-tone* signal, not a price prediction.
"""
from __future__ import annotations

import importlib.util
import os
import re
import threading

POS = {
    "gain", "gains", "gained", "rise", "rises", "rising", "rose", "jump", "jumps", "jumped", "surge", "surges",
    "surged", "rally", "rallies", "rallied", "soar", "soars", "soared", "climb", "climbs", "climbed", "record",
    "high", "highs", "beat", "beats", "outperform", "outperforms", "upgrade", "upgraded", "strong", "stronger",
    "robust", "growth", "grows", "grew", "profit", "profits", "boost", "boosts", "boosted", "recover",
    "recovers", "recovery", "rebound", "rebounds", "rebounded", "positive", "optimism", "optimistic", "bullish",
    "inflows", "inflow", "buyback", "dividend", "expansion", "expands", "approval", "approves", "approved", "wins",
    "win", "order", "orders", "advance", "advances", "advanced", "upbeat", "improve", "improves", "improved",
    "improvement", "accelerate", "accelerates", "highest", "best", "steady", "resilient", "upside", "green",
    "eases", "easing", "cut", "cuts",  # rate cuts are usually read positively by markets
}
NEG = {
    "fall", "falls", "fell", "falling", "drop", "drops", "dropped", "decline", "declines", "declined", "slump",
    "slumps", "slumped", "plunge", "plunges", "plunged", "tumble", "tumbles", "tumbled", "crash", "crashes",
    "slide", "slides", "slid", "sink", "sinks", "sank", "loss", "losses", "lose", "loses", "weak", "weaker",
    "weakness", "miss", "misses", "missed", "downgrade", "downgraded", "cut", "concern", "concerns", "worry",
    "worries", "fear", "fears", "risk", "risks", "selloff", "sell-off", "outflows", "outflow", "pressure",
    "volatile", "volatility", "slowdown", "slows", "slowing", "bearish", "probe", "penalty", "fraud", "default",
    "lowest", "low", "lows", "red", "drag", "drags", "dragged", "warning", "warns", "uncertainty", "headwinds",
    "inflation", "tariff", "tariffs", "war", "tension", "tensions", "downside", "layoffs", "resigns", "raid",
    "slips", "slipped", "slip", "dip", "dips", "dipped", "shed", "sheds", "erodes", "erase", "erases", "wiped",
}
POS_PHRASES = {"record high": 2.0, "all-time high": 2.0, "beats estimates": 2.0, "rate cut": 1.0,
               "fii buying": 1.5, "upper circuit": 1.5, "net profit rises": 2.0, "order win": 1.5}
NEG_PHRASES = {"lower circuit": 1.5, "fii selling": 1.5, "misses estimates": 2.0, "profit falls": 2.0,
               "rate hike": 1.0, "52-week low": 1.5, "profit booking": 1.0}
NEGATORS = {"not", "no", "never", "without", "despite", "fails", "failed", "unable"}
INTENS = {"sharply": 1.5, "significantly": 1.4, "steeply": 1.5, "heavily": 1.4, "marginally": 0.5, "slightly": 0.5}
AMBIG = {"cut", "cuts"}  # 'rate cut' positive, 'job cuts' / 'cuts forecast' negative

MODEL_NAME = "FinLex finance lexicon v1"


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z][a-z\-']*", text.lower())


def lexicon_score(text: str) -> tuple[str, float, list[str]]:
    low = text.lower()
    score, hits = 0.0, []
    for ph, w in POS_PHRASES.items():
        if ph in low:
            score += w
            hits.append(f"+{ph}")
    for ph, w in NEG_PHRASES.items():
        if ph in low:
            score -= w
            hits.append(f"-{ph}")
    toks = _tokens(text)
    for i, t in enumerate(toks):
        if t in AMBIG:
            ctx = " ".join(toks[max(0, i - 2): i + 3])
            if "rate" in ctx or "repo" in ctx:
                continue  # handled by phrase list
            pol = -1.0
        elif t in POS and t not in NEG:
            pol = 1.0
        elif t in NEG and t not in POS:
            pol = -1.0
        else:
            continue
        window = toks[max(0, i - 3): i]
        if any(w in NEGATORS for w in window):
            pol = -pol * 0.8
        mult = max((INTENS.get(w, 1.0) for w in toks[max(0, i - 2): i + 2]), default=1.0)
        score += pol * mult
        hits.append(("+" if pol > 0 else "-") + t)
    norm = score / (1 + abs(score)) if score else 0.0  # squash to (-1, 1)
    label = "positive" if norm > 0.2 else "negative" if norm < -0.2 else "neutral"
    return label, round(norm, 3), hits[:8]


class _FinBERT:
    pipe = None
    lock = threading.Lock()


def finbert_available() -> bool:
    return (os.getenv("FINLEX_USE_FINBERT") == "1" and importlib.util.find_spec("transformers") is not None
            and importlib.util.find_spec("torch") is not None)


def classify(text: str) -> dict:
    if finbert_available():  # pragma: no cover - optional heavy dependency
        with _FinBERT.lock:
            if _FinBERT.pipe is None:
                from transformers import pipeline

                _FinBERT.pipe = pipeline("text-classification", model="ProsusAI/finbert")
        out = _FinBERT.pipe(text[:512])[0]
        lab = out["label"].lower()
        sc = out["score"] * (1 if lab == "positive" else -1 if lab == "negative" else 0)
        return {"label": lab, "score": round(sc, 3), "model": "ProsusAI/finbert", "evidence": []}
    label, score, hits = lexicon_score(text)
    return {"label": label, "score": score, "model": MODEL_NAME, "evidence": hits}


# Small labelled evaluation set (hand-labelled by tone of the headline wording).
EVAL_SET = [
    ("Sensex surges 900 points as banks rally on strong earnings", "positive"),
    ("Nifty hits record high led by IT and auto stocks", "positive"),
    ("Gold prices climb to fresh high on safe-haven demand", "positive"),
    ("Company's net profit rises 18% on robust demand", "positive"),
    ("Rupee recovers against dollar as crude eases", "positive"),
    ("Markets fall sharply as FII selling continues", "negative"),
    ("Nifty slumps 2% on global sell-off and tariff fears", "negative"),
    ("Bank shares tumble after weak quarterly results", "negative"),
    ("Silver drops as dollar strengthens; inflation concerns weigh", "negative"),
    ("Profit falls 12% as margins come under pressure", "negative"),
    ("RBI keeps repo rate unchanged in policy review", "neutral"),
    ("Company to announce Q2 results on Friday", "neutral"),
    ("SEBI releases consultation paper on mutual fund categorisation", "neutral"),
    ("Markets end flat ahead of inflation data", "neutral"),
    ("Stock does not fall despite weak global cues", "positive"),
    ("Firm reports record losses amid slowdown", "negative"),
    ("IT stocks advance as rupee weakens", "positive"),
    ("Midcaps slip as investors book profits", "negative"),
    ("Board approves dividend and buyback", "positive"),
    ("Exchange schedules mock trading session on Saturday", "neutral"),
]


def evaluate() -> dict:
    correct = 0
    rows = []
    for text, gold in EVAL_SET:
        pred = classify(text)["label"]
        correct += pred == gold
        rows.append({"text": text, "gold": gold, "pred": pred})
    return {"accuracy": correct / len(EVAL_SET), "n": len(EVAL_SET), "model": classify("x")["model"], "rows": rows}
