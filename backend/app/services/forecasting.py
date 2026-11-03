"""Leakage-safe return forecasting with calibrated intervals and walk-forward evaluation.

Target: h-session forward log return, y_t = 100 * ln(P_{t+h} / P_t).
Features at t use only prices up to and including t.

Protocol (blueprint §8):
* chronological splits only; rolling-origin (walk-forward) evaluation, refit every 63 sessions;
* purge: a training row t is used only if its label end t+h <= origin;
* scalers/model fit inside each fold (sklearn Pipeline); conformal residual quantiles from a
  held-back, purged calibration slice at the end of each training window;
* every model is compared with naive baselines (zero change / random walk, historical drift);
* metadata (dataset hash, code version, seed, params) is stored with each evaluation run.
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import math
import threading
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Instrument, ModelRun
from . import marketdata as md

CODE_VERSION = "fx-1.2.0"
SEED = 42
HORIZONS = {1: "1 session (~1 day)", 5: "5 sessions (~1 week)", 21: "21 sessions (~1 month)"}
MODELS = ["naive", "drift", "ridge", "xgboost", "chronos"]
MODEL_INFO = {
    "naive": {"name": "Naïve (no change)", "kind": "baseline",
              "desc": "Predicts zero return — the random-walk benchmark every model must beat."},
    "drift": {"name": "Historical drift", "kind": "baseline",
              "desc": "Predicts the average h-session return of the training window."},
    "ridge": {"name": "Ridge regression", "kind": "model", "version": "ridge-a10",
              "desc": "Regularised linear model on engineered price features; interpretable coefficients."},
    "xgboost": {"name": "XGBoost", "kind": "model", "version": "xgb-d2-n200",
                "desc": "Shallow gradient-boosted trees capturing non-linear feature interactions."},
    "chronos": {"name": "Chronos (pretrained transformer)", "kind": "experimental", "version": "chronos-t5-tiny",
                "desc": "Pretrained time-series foundation model. Optional; runs only if the 'chronos' "
                        "package and model weights are installed."},
}
FEATURE_LABELS = {
    "r1": "Last session's return", "r5": "1-week momentum", "r10": "2-week momentum",
    "r21": "1-month momentum", "r63": "3-month momentum", "vol10": "2-week volatility",
    "vol21": "1-month volatility", "vol_ratio": "Short vs long volatility ratio",
    "ma_gap50": "Distance from 50-session average", "rsi14": "14-session RSI",
}
REFIT_EVERY = 63
TEST_SESSIONS = 504
MIN_TRAIN = 252
CAL_FRAC = 0.25


def chronos_available() -> bool:
    return importlib.util.find_spec("chronos") is not None and importlib.util.find_spec("torch") is not None


# ------------------------------------------------------------------ features
def build_features(prices: pd.Series) -> pd.DataFrame:
    p = prices.astype(float)
    lr = np.log(p).diff()
    f = pd.DataFrame(index=p.index)
    for k in (1, 5, 10, 21, 63):
        f[f"r{k}"] = np.log(p / p.shift(k)) * 100
    f["vol10"] = lr.rolling(10).std() * np.sqrt(252) * 100
    f["vol21"] = lr.rolling(21).std() * np.sqrt(252) * 100
    f["vol_ratio"] = lr.rolling(10).std() / lr.rolling(63).std()
    f["ma_gap50"] = np.log(p / p.rolling(50).mean()) * 100
    delta = p.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    f["rsi14"] = 100 - 100 / (1 + rs)
    return f


def build_target(prices: pd.Series, h: int) -> pd.Series:
    p = prices.astype(float)
    return np.log(p.shift(-h) / p) * 100


# ------------------------------------------------------------------ model wrappers
class _Fitted:
    def __init__(self, name: str, est=None, drift: float = 0.0, cols=None):
        self.name, self.est, self.drift, self.cols = name, est, drift, cols

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        if self.name == "naive":
            return np.zeros(len(X))
        if self.name == "drift":
            return np.full(len(X), self.drift)
        return self.est.predict(X[self.cols].values)

    def importances(self) -> list[dict]:
        if self.name == "ridge":
            coefs = self.est.named_steps["ridge"].coef_
            tot = np.sum(np.abs(coefs)) or 1.0
            return sorted(({"feature": c, "label": FEATURE_LABELS.get(c, c), "weight": float(abs(w) / tot),
                            "sign": "+" if w > 0 else "-"} for c, w in zip(self.cols, coefs, strict=True)),
                          key=lambda x: -x["weight"])
        if self.name == "xgboost":
            imp = self.est.feature_importances_
            tot = float(np.sum(imp)) or 1.0
            return sorted(({"feature": c, "label": FEATURE_LABELS.get(c, c), "weight": float(w / tot), "sign": None}
                           for c, w in zip(self.cols, imp, strict=True)), key=lambda x: -x["weight"])
        return []


def fit_model(name: str, X: pd.DataFrame, y: pd.Series, seed: int = SEED) -> _Fitted:
    cols = list(X.columns)
    if name == "naive":
        return _Fitted("naive")
    if name == "drift":
        return _Fitted("drift", drift=float(y.mean()))
    if name == "ridge":
        est = Pipeline([("scale", StandardScaler()), ("ridge", Ridge(alpha=10.0))]).fit(X.values, y.values)
        return _Fitted("ridge", est, cols=cols)
    if name == "xgboost":
        from xgboost import XGBRegressor

        est = XGBRegressor(n_estimators=200, max_depth=2, learning_rate=0.03, subsample=0.8, colsample_bytree=0.8,
                           reg_lambda=5.0, min_child_weight=10, random_state=seed, n_jobs=1, verbosity=0)
        est.fit(X.values, y.values)
        return _Fitted("xgboost", est, cols=cols)
    raise ValueError(f"Unknown model {name}")


@dataclass
class Calibrated:
    model: _Fitted
    q: dict  # residual quantiles {0.10, 0.25, 0.75, 0.90}
    n_cal: int

    def predict(self, X: pd.DataFrame) -> dict:
        pt = self.model.predict(X)
        return {"point": pt, "lo80": pt + self.q[0.10], "hi80": pt + self.q[0.90],
                "lo50": pt + self.q[0.25], "hi50": pt + self.q[0.75]}


def fit_calibrated(name: str, X: pd.DataFrame, y: pd.Series, h: int) -> Calibrated:
    """Split-conformal: fit on the first (1-CAL_FRAC) of the window, calibrate residual quantiles on the
    remainder (with an h-session purge gap so calibration labels never overlap training labels)."""
    n = len(X)
    n_cal = max(30, int(n * CAL_FRAC))
    split = n - n_cal
    tr_end = max(10, split - h)
    m = fit_model(name, X.iloc[:tr_end], y.iloc[:tr_end])
    res = y.iloc[split:].values - m.predict(X.iloc[split:])
    k = len(res)

    def cq(p: float) -> float:  # conservative empirical quantile (widens with small calibration sets)
        return float(np.quantile(res, p, method="lower" if p < 0.5 else "higher"))

    return Calibrated(m, {0.10: cq(0.10), 0.25: cq(0.25), 0.75: cq(0.75), 0.90: cq(0.90)}, k)


# ------------------------------------------------------------------ dataset
def dataset(prices: pd.Series, h: int) -> tuple[pd.DataFrame, pd.Series, pd.DataFrame]:
    feats = build_features(prices)
    y = build_target(prices, h)
    full = feats.dropna()
    labelled = full.loc[y.loc[full.index].notna()]
    return labelled, y.loc[labelled.index], full


# ------------------------------------------------------------------ walk-forward evaluation
def walk_forward(prices: pd.Series, h: int, models: list[str] | None = None) -> dict:
    models = models or ["naive", "drift", "ridge", "xgboost"]
    X, y, _ = dataset(prices, h)
    n = len(X)
    if n < MIN_TRAIN + 60:
        raise ValueError(f"Not enough history for evaluation ({n} usable sessions; need {MIN_TRAIN + 60}).")
    test_start = max(MIN_TRAIN + h, n - TEST_SESSIONS)
    preds: dict[str, dict[str, list]] = {m: {"idx": [], "point": [], "lo80": [], "hi80": [], "lo50": [], "hi50": []}
                                         for m in models}
    for block_start in range(test_start, n, REFIT_EVERY):
        block_end = min(n, block_start + REFIT_EVERY)
        train_end = block_start - h  # purge: labels of training rows end before the origin
        Xtr, ytr = X.iloc[:train_end], y.iloc[:train_end]
        Xte = X.iloc[block_start:block_end]
        for m in models:
            cal = fit_calibrated(m, Xtr, ytr, h)
            out = cal.predict(Xte)
            preds[m]["idx"].extend(range(block_start, block_end))
            for k in ("point", "lo80", "hi80", "lo50", "hi50"):
                preds[m][k].extend(out[k].tolist())
    # evaluate on non-overlapping origins (every h-th session) so errors are approximately independent
    step = max(1, h)
    sel_positions = list(range(0, n - test_start, step))
    actual_all = y.values
    results = {}
    naive_abs = None
    for m in models:
        idx = np.array(preds[m]["idx"])[sel_positions]
        a = actual_all[idx]
        p = np.array(preds[m]["point"])[sel_positions]
        lo80 = np.array(preds[m]["lo80"])[sel_positions]
        hi80 = np.array(preds[m]["hi80"])[sel_positions]
        lo50 = np.array(preds[m]["lo50"])[sel_positions]
        hi50 = np.array(preds[m]["hi50"])[sel_positions]
        err = a - p
        abs_err = np.abs(err)
        if m == "naive":
            naive_abs = abs_err
        nz = p != 0
        results[m] = {
            "n": int(len(a)),
            "mae": float(abs_err.mean()),
            "rmse": float(np.sqrt(np.mean(err**2))),
            "directional_accuracy": float(np.mean(np.sign(p[nz]) == np.sign(a[nz]))) if nz.sum() >= 10 else None,
            "coverage80": float(np.mean((a >= lo80) & (a <= hi80))),
            "coverage50": float(np.mean((a >= lo50) & (a <= hi50))),
            "width80": float(np.mean(hi80 - lo80)),
            "_abs": abs_err,
        }
    for m in models:
        r = results[m]
        d = naive_abs - r["_abs"]  # positive = model better than naive
        r["skill_vs_naive"] = float(1 - r["mae"] / results["naive"]["mae"]) if results["naive"]["mae"] else 0.0
        if m == "naive":
            r["beats_naive"] = None
            r["t_stat"] = None
        else:
            sd = d.std(ddof=1)
            t = float(d.mean() / (sd / math.sqrt(len(d)))) if sd > 0 else 0.0
            r["t_stat"] = t
            r["beats_naive"] = "significant" if t > 1.96 else ("marginal" if d.mean() > 0 else "no")
        del r["_abs"]
    dates = X.index
    return {
        "horizon": h,
        "test_start": dates[test_start].date().isoformat(),
        "test_end": dates[n - 1].date().isoformat(),
        "train_start": dates[0].date().isoformat(),
        "refit_every": REFIT_EVERY,
        "eval_step": step,
        "metrics": results,
        "_preds": preds,
        "_dates": dates,
        "_y": y,
        "_test_start": test_start,
        "_sel": sel_positions,
    }


_eval_lock = threading.Lock()


def evaluation(db: Session, inst: Instrument, h: int, store: bool = True) -> dict:
    prices = md.get_series(db, inst.id)
    if prices.empty:
        raise ValueError("No price history")
    dh = md.dataset_hash(prices)
    with _eval_lock:
        runs = list(db.scalars(select(ModelRun).where(
            ModelRun.instrument_id == inst.id, ModelRun.horizon_days == h, ModelRun.dataset_hash == dh,
            ModelRun.code_version == CODE_VERSION)))
        if runs and len({r.model for r in runs}) >= 4:
            first = runs[0]
            return {"horizon": h, "metrics": {r.model: r.metrics for r in runs}, "dataset_hash": dh,
                    "data_cutoff": first.data_cutoff.isoformat(), **first.params.get("window", {}),
                    "cached": True}
        wf = walk_forward(prices, h)
        window = {"train_start": wf["train_start"], "test_start": wf["test_start"], "test_end": wf["test_end"],
                  "refit_every": wf["refit_every"], "eval_step": wf["eval_step"]}
        if store:
            for m, met in wf["metrics"].items():
                db.add(ModelRun(instrument_id=inst.id, model=m, model_version=MODEL_INFO[m].get("version", m),
                                horizon_days=h, data_cutoff=prices.index[-1].date(), dataset_hash=dh,
                                code_version=CODE_VERSION, seed=SEED,
                                params={"window": window, "features": list(FEATURE_LABELS),
                                        "interval": "split-conformal signed residual quantiles",
                                        "cal_frac": CAL_FRAC},
                                metrics=met))
            db.commit()
        return {"horizon": h, "metrics": wf["metrics"], "dataset_hash": dh,
                "data_cutoff": prices.index[-1].date().isoformat(), **window, "cached": False}


# ------------------------------------------------------------------ live forecast
def forecast(db: Session, inst: Instrument, h: int, model: str) -> dict:
    if h not in HORIZONS:
        raise ValueError(f"Horizon must be one of {list(HORIZONS)}")
    if model == "chronos":
        if not chronos_available():
            raise ValueError("Chronos is not installed in this deployment (optional experimental model).")
        return _chronos_forecast(db, inst, h)
    if model not in ("naive", "drift", "ridge", "xgboost"):
        raise ValueError("Unknown model")
    prices = md.get_series(db, inst.id)
    X, y, full = dataset(prices, h)
    if len(X) < MIN_TRAIN:
        raise ValueError("Not enough history to forecast this instrument")
    cal = fit_calibrated(model, X, y, h)
    x_now = full.iloc[[-1]]
    out = {k: float(v[0]) for k, v in cal.predict(x_now).items()}
    base = float(prices.iloc[-1])
    cutoff = prices.index[-1].date()
    target_date = (pd.Timestamp(cutoff) + pd.offsets.BDay(h)).date()

    def px(r: float) -> float:
        return base * math.exp(r / 100)

    src = md.series_source(db, inst.id)
    return {
        "instrument": {"id": inst.id, "symbol": inst.symbol, "name": inst.name, "unit": inst.unit},
        "model": model,
        "model_name": MODEL_INFO[model]["name"],
        "model_version": MODEL_INFO[model].get("version", model),
        "code_version": CODE_VERSION,
        "horizon_days": h,
        "horizon_label": HORIZONS[h],
        "cutoff_date": cutoff.isoformat(),
        "target_date": target_date.isoformat(),
        "base_price": base,
        "point_return": out["point"],
        "interval80": [out["lo80"], out["hi80"]],
        "interval50": [out["lo50"], out["hi50"]],
        "price_point": px(out["point"]),
        "price_interval80": [px(out["lo80"]), px(out["hi80"])],
        "price_interval50": [px(out["lo50"]), px(out["hi50"])],
        "training_window": [X.index[0].date().isoformat(), X.index[-1].date().isoformat()],
        "n_train": len(X),
        "n_calibration": cal.n_cal,
        "interval_method": "Split-conformal (signed residual quantiles, purged calibration slice)",
        "factors": cal.model.importances()[:5],
        "dataset_hash": md.dataset_hash(prices),
        "source": src,
        "synthetic": src == md.SOURCE_LABELS["synthetic"],
        "disclaimer": ("Experimental statistical estimate, not a prediction you should act on and not investment "
                       "advice. Ranges are calibrated on past data and will be wrong some of the time."),
    }


def _chronos_forecast(db: Session, inst: Instrument, h: int) -> dict:  # pragma: no cover - optional dependency
    import torch
    from chronos import BaseChronosPipeline

    prices = md.get_series(db, inst.id)
    pipe = BaseChronosPipeline.from_pretrained("amazon/chronos-t5-tiny", device_map="cpu", torch_dtype=torch.float32)
    ctx = torch.tensor(np.log(prices.values[-512:]), dtype=torch.float32)
    q, _ = pipe.predict_quantiles(context=ctx, prediction_length=h, quantile_levels=[0.1, 0.25, 0.5, 0.75, 0.9])
    last = float(np.log(prices.values[-1]))
    vals = [(float(q[0, -1, i]) - last) * 100 for i in range(5)]
    base = float(prices.iloc[-1])
    cutoff = prices.index[-1].date()
    return {
        "instrument": {"id": inst.id, "symbol": inst.symbol, "name": inst.name, "unit": inst.unit},
        "model": "chronos", "model_name": MODEL_INFO["chronos"]["name"], "model_version": "chronos-t5-tiny",
        "code_version": CODE_VERSION, "horizon_days": h, "horizon_label": HORIZONS[h],
        "cutoff_date": cutoff.isoformat(),
        "target_date": (pd.Timestamp(cutoff) + pd.offsets.BDay(h)).date().isoformat(),
        "base_price": base, "point_return": vals[2], "interval80": [vals[0], vals[4]], "interval50": [vals[1], vals[3]],
        "price_point": base * math.exp(vals[2] / 100),
        "price_interval80": [base * math.exp(vals[0] / 100), base * math.exp(vals[4] / 100)],
        "price_interval50": [base * math.exp(vals[1] / 100), base * math.exp(vals[3] / 100)],
        "training_window": None, "n_train": 0, "n_calibration": 0,
        "interval_method": "Model quantiles (not conformally calibrated)", "factors": [],
        "dataset_hash": md.dataset_hash(prices), "source": md.series_source(db, inst.id), "synthetic": False,
        "disclaimer": "Experimental pretrained model; uncalibrated quantiles.",
    }


def forecast_chart(db: Session, inst: Instrument, fc: dict, lookback: int = 120) -> list[dict]:
    prices = md.get_series(db, inst.id, adjusted=False).iloc[-lookback:]
    pts = [{"date": d.date().isoformat(), "price": round(float(v), 4)} for d, v in prices.items()]
    if pts:
        pts[-1].update({"p": pts[-1]["price"], "band80": [pts[-1]["price"]] * 2, "band50": [pts[-1]["price"]] * 2})
    days = pd.bdate_range(pd.Timestamp(fc["cutoff_date"]) + pd.offsets.BDay(1), periods=fc["horizon_days"])
    base = fc["base_price"]
    for k, d in enumerate(days, start=1):
        frac = math.sqrt(k / fc["horizon_days"])  # widen like a random walk towards the horizon
        lin = k / fc["horizon_days"]

        def at(r: float, f: float) -> float:
            return round(base * math.exp(r * f / 100), 4)

        pts.append({"date": d.date().isoformat(), "p": at(fc["point_return"], lin),
                    "band80": [at(fc["interval80"][0], frac), at(fc["interval80"][1], frac)],
                    "band50": [at(fc["interval50"][0], frac), at(fc["interval50"][1], frac)]})
    return pts


def today_date() -> dt.date:
    return md.today_ist()
