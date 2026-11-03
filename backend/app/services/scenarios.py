"""What-if scenario generation (experimental).

Two engines, both producing *synthetic* 21-session return paths that are explicitly not forecasts:

* ``bootstrap`` - stationary block bootstrap of historical daily returns (transparent default).
* ``vae``       - a small variational autoencoder (NumPy, trained here with Adam) on standardised
                  21-session windows of daily log returns; new paths are decoded from z ~ N(0, I).

Both are evaluated against held-out real windows (distribution statistics + KS distance) so users
can see how realistic the synthetic scenarios are.
"""
from __future__ import annotations

import threading

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from ..models import Instrument
from . import marketdata as md

WIN = 21


# ------------------------------------------------------------------ tiny VAE in NumPy
class TinyVAE:
    def __init__(self, d: int, h: int = 32, z: int = 4, seed: int = 0):
        rng = np.random.default_rng(seed)
        s = lambda a, b: rng.normal(0, np.sqrt(2 / (a + b)), (a, b))  # noqa: E731
        self.p = {
            "W1": s(d, h), "b1": np.zeros(h),
            "Wm": s(h, z), "bm": np.zeros(z), "Wv": s(h, z) * 0.1, "bv": np.zeros(z) - 1.0,
            "W2": s(z, h), "b2": np.zeros(h), "W3": s(h, d), "b3": np.zeros(d),
        }
        self.m = {k: np.zeros_like(v) for k, v in self.p.items()}
        self.v = {k: np.zeros_like(v) for k, v in self.p.items()}
        self.t = 0
        self.rng = rng
        self.z = z

    def decode(self, Z: np.ndarray) -> np.ndarray:
        p = self.p
        return np.tanh(Z @ p["W2"] + p["b2"]) @ p["W3"] + p["b3"]

    def step(self, X: np.ndarray, lr: float = 2e-3, beta: float = 1.0) -> float:
        p = self.p
        n = len(X)
        a1 = X @ p["W1"] + p["b1"]
        h1 = np.tanh(a1)
        mu = h1 @ p["Wm"] + p["bm"]
        logv = np.clip(h1 @ p["Wv"] + p["bv"], -8, 4)
        eps = self.rng.standard_normal(mu.shape)
        std = np.exp(0.5 * logv)
        Z = mu + std * eps
        a2 = Z @ p["W2"] + p["b2"]
        h2 = np.tanh(a2)
        Xh = h2 @ p["W3"] + p["b3"]
        rec = np.sum((Xh - X) ** 2) / n
        kl = -0.5 * np.sum(1 + logv - mu**2 - np.exp(logv)) / n
        # backprop
        dXh = 2 * (Xh - X) / n
        g = {"W3": h2.T @ dXh, "b3": dXh.sum(0)}
        dh2 = dXh @ p["W3"].T
        da2 = dh2 * (1 - h2**2)
        g["W2"], g["b2"] = Z.T @ da2, da2.sum(0)
        dZ = da2 @ p["W2"].T
        dmu = dZ + beta * mu / n
        dlogv = dZ * eps * 0.5 * std + beta * 0.5 * (np.exp(logv) - 1) / n
        g["Wm"], g["bm"] = h1.T @ dmu, dmu.sum(0)
        g["Wv"], g["bv"] = h1.T @ dlogv, dlogv.sum(0)
        dh1 = dmu @ p["Wm"].T + dlogv @ p["Wv"].T
        da1 = dh1 * (1 - h1**2)
        g["W1"], g["b1"] = X.T @ da1, da1.sum(0)
        self.t += 1
        for k in p:  # Adam
            gk = np.clip(g[k], -5, 5)
            self.m[k] = 0.9 * self.m[k] + 0.1 * gk
            self.v[k] = 0.999 * self.v[k] + 0.001 * gk**2
            mh = self.m[k] / (1 - 0.9**self.t)
            vh = self.v[k] / (1 - 0.999**self.t)
            p[k] -= lr * mh / (np.sqrt(vh) + 1e-8)
        return float(rec + beta * kl)

    def fit(self, X: np.ndarray, epochs: int = 300, batch: int = 64) -> list[float]:
        losses = []
        n = len(X)
        for e in range(epochs):
            idx = self.rng.permutation(n)
            beta = min(1.0, (e + 1) / 60)  # KL warm-up
            tot = 0.0
            for i in range(0, n, batch):
                tot += self.step(X[idx[i:i + batch]], beta=beta) * len(idx[i:i + batch])
            losses.append(tot / n)
        return losses

    def reconstruct(self, X: np.ndarray) -> np.ndarray:
        p = self.p
        mu = np.tanh(X @ p["W1"] + p["b1"]) @ p["Wm"] + p["bm"]
        return self.decode(mu)

    def set_noise(self, X: np.ndarray) -> None:
        """Observation model p(x|z) = N(decoder(z), diag(s^2)); s estimated from reconstruction residuals."""
        self.noise_sd = np.std(X - self.reconstruct(X), axis=0)

    def sample(self, n: int, rng: np.random.Generator) -> np.ndarray:
        mean = self.decode(rng.standard_normal((n, self.z)))
        return mean + rng.standard_normal(mean.shape) * getattr(self, "noise_sd", 0.0)


# ------------------------------------------------------------------ helpers
def _windows(r: np.ndarray, step: int = 3) -> np.ndarray:
    return np.array([r[i:i + WIN] for i in range(0, len(r) - WIN + 1, step)])


def _ks(a: np.ndarray, b: np.ndarray) -> float:
    a, b = np.sort(a), np.sort(b)
    allv = np.concatenate([a, b])
    cdf_a = np.searchsorted(a, allv, side="right") / len(a)
    cdf_b = np.searchsorted(b, allv, side="right") / len(b)
    return float(np.max(np.abs(cdf_a - cdf_b)))


def _stats(paths: np.ndarray) -> dict:
    cum = paths.sum(1)
    eq = np.exp(np.cumsum(paths, 1))
    mdd = (eq / np.maximum.accumulate(eq, axis=1) - 1).min(1)
    flat = paths.ravel()
    sd = flat.std() or 1e-12
    return {
        "mean_21d_pct": float((np.exp(cum.mean()) - 1) * 100),
        "vol_daily_pct": float(flat.std() * 100),
        "skew": float(np.mean(((flat - flat.mean()) / sd) ** 3)),
        "kurtosis": float(np.mean(((flat - flat.mean()) / sd) ** 4) - 3),
        "p05_21d_pct": float((np.exp(np.percentile(cum, 5)) - 1) * 100),
        "p95_21d_pct": float((np.exp(np.percentile(cum, 95)) - 1) * 100),
        "median_max_drawdown_pct": float(np.median(mdd) * 100),
    }


def _bootstrap(r: np.ndarray, n: int, rng: np.random.Generator, block: int = 5) -> np.ndarray:
    out = np.empty((n, WIN))
    for i in range(n):
        path = []
        while len(path) < WIN:
            s = rng.integers(0, len(r) - block)
            path.extend(r[s:s + block])
        out[i] = path[:WIN]
    return out


_cache: dict = {}
_lock = threading.Lock()


def scenarios(db: Session, inst: Instrument, engine: str = "vae", n_paths: int = 500, shock: float = 0.0) -> dict:
    """shock: optional user stress, applied as an extra cumulative % move spread over the window."""
    if engine not in ("vae", "bootstrap"):
        raise ValueError("engine must be 'vae' or 'bootstrap'")
    n_paths = int(min(max(n_paths, 100), 2000))
    prices = md.get_series(db, inst.id)
    if len(prices) < 300:
        raise ValueError("Not enough history for scenario generation")
    r = np.diff(np.log(prices.values))
    split = int(len(r) * 0.8)
    train, test = r[:split], r[split:]
    rng = np.random.default_rng(123)
    real_test = _windows(test, step=1)
    meta: dict = {}
    if engine == "bootstrap":
        paths = _bootstrap(train, n_paths, rng)
        meta = {"block_size": 5}
    else:
        key = (inst.id, md.dataset_hash(prices))
        with _lock:
            if key not in _cache:
                Xw = _windows(train)
                mu, sd = Xw.mean(), Xw.std()
                vae = TinyVAE(WIN, seed=1)
                Zw = (Xw - mu) / sd
                losses = vae.fit(Zw, epochs=250)
                vae.set_noise(Zw)
                _cache[key] = (vae, mu, sd, losses, len(Xw))
            vae, mu, sd, losses, n_win = _cache[key]
        paths = vae.sample(n_paths, rng) * sd + mu
        meta = {"architecture": f"{WIN}-32-z4-32-{WIN} (tanh), Adam, KL warm-up, Gaussian observation noise", "train_windows": n_win,
                "final_loss": losses[-1], "loss_curve": [round(x, 4) for x in losses[:: max(1, len(losses) // 50)]]}
    if shock:
        paths = paths + np.log(1 + shock / 100) / WIN
    cum = np.cumsum(paths, 1)
    pct = np.percentile(cum, [5, 25, 50, 75, 95], axis=0)
    base = float(prices.iloc[-1])
    fan = [{"day": 0, "p5": base, "p25": base, "p50": base, "p75": base, "p95": base}]
    for d in range(WIN):
        fan.append({"day": d + 1, **{k: round(base * float(np.exp(pct[i, d])), 4)
                                      for i, k in enumerate(["p5", "p25", "p50", "p75", "p95"])}})
    samples = [[round(base * float(np.exp(v)), 4) for v in [0.0, *cum[i]]] for i in range(min(12, n_paths))]
    gen_stats, real_stats = _stats(paths), _stats(real_test)
    return {
        "instrument": {"id": inst.id, "symbol": inst.symbol, "name": inst.name},
        "engine": engine,
        "n_paths": n_paths,
        "window_sessions": WIN,
        "base_price": base,
        "shock_pct": shock,
        "fan": fan,
        "sample_paths": samples,
        "evaluation": {
            "generated": gen_stats,
            "held_out_real": real_stats,
            "ks_21d_return": _ks(paths.sum(1), real_test.sum(1)),
            "ks_daily_return": _ks(paths.ravel(), real_test.ravel()),
            "train_period": [prices.index[0].date().isoformat(), prices.index[split].date().isoformat()],
            "test_period": [prices.index[split + 1].date().isoformat(), prices.index[-1].date().isoformat()],
        },
        "meta": meta,
        "label": "Synthetic scenarios for stress-testing intuition — not predictions or likely outcomes.",
    }
