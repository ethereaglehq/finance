"""Data-quality checks for fund look-through data.

1. Deterministic validation rules run first (sum of weights, negatives, duplicates, staleness).
2. An experimental autoencoder (MLP trained to reconstruct per-scheme summary features) scores how
   unusual each snapshot looks. It only *flags* for review; it never alters holdings. Its detection
   rate is measured on synthetic corruptions and reported alongside the flags.
"""
from __future__ import annotations

import datetime as dt
import re
import threading
import warnings
from collections import Counter

import numpy as np
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import FundHoldingSnapshot, Instrument

FEATURES = ["weight_sum", "max_weight", "top5", "n_rows", "cash", "unitemised", "hhi", "age_years", "dups"]


def _feat(rows: list[FundHoldingSnapshot], today: dt.date) -> np.ndarray:
    w = np.array([r.weight for r in rows], dtype=float)
    eq = sorted((r.weight for r in rows if r.asset_type == "equity" and "not itemised" not in r.underlying_name),
                reverse=True)
    keys = Counter(re.sub(r"\W+", "", r.underlying_name.lower()) for r in rows)
    return np.array([
        w.sum(),
        max(eq) if eq else 0.0,
        sum(eq[:5]),
        len(rows),
        sum(r.weight for r in rows if r.asset_type == "cash"),
        sum(r.weight for r in rows if "not itemised" in r.underlying_name),
        float(np.sum((w / max(w.sum(), 1e-9)) ** 2)),
        (today - rows[0].disclosure_date).days / 365.0 if rows else 0.0,
        sum(c - 1 for c in keys.values() if c > 1),
    ])


def rule_checks(name: str, rows: list[FundHoldingSnapshot], today: dt.date) -> list[dict]:
    out = []
    total = sum(r.weight for r in rows)
    if any(r.weight < 0 for r in rows):
        out.append({"level": "error", "rule": "negative_weight", "message": f"{name}: negative weights present."})
    if total > 100.5:
        out.append({"level": "error", "rule": "weights_exceed_100",
                    "message": f"{name}: weights sum to {total:.1f}% (>100%). Exposure is scaled down to 100%."})
    elif total < 90:
        out.append({"level": "warning", "rule": "incomplete_disclosure",
                    "message": f"{name}: weights sum to {total:.1f}% — part of the fund is not covered."})
    keys = Counter(re.sub(r"\W+", "", r.underlying_name.lower()) for r in rows)
    dups = [k for k, c in keys.items() if c > 1]
    if dups:
        out.append({"level": "error", "rule": "duplicate_rows", "message": f"{name}: duplicate holdings ({len(dups)})."})
    if rows:
        age = (today - rows[0].disclosure_date).days
        if age > 100:
            out.append({"level": "warning", "rule": "stale_disclosure",
                        "message": f"{name}: disclosure is {age} days old ({rows[0].disclosure_date})."})
    unmapped = sum(1 for r in rows if r.asset_type == "equity" and r.underlying_instrument_id is None
                   and "not itemised" not in r.underlying_name)
    if unmapped:
        out.append({"level": "info", "rule": "unmapped_names",
                    "message": f"{name}: {unmapped} holding(s) matched by name only (no instrument-master mapping)."})
    return out


class _AE:
    lock = threading.Lock()
    cache: dict = {}


def _train_autoencoder(X: np.ndarray, seed: int = 7):
    scaler = StandardScaler().fit(X)
    Z = scaler.transform(X)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        ae = MLPRegressor(hidden_layer_sizes=(6, 3, 6), activation="tanh", alpha=1e-3, max_iter=4000,
                          random_state=seed, learning_rate_init=0.01).fit(Z, Z)
    err = np.mean((ae.predict(Z) - Z) ** 2, axis=1)
    return scaler, ae, err


def autoencoder_scores(db: Session, today: dt.date) -> dict:
    """Train on all available scheme snapshots; cache by snapshot count."""
    all_rows = list(db.scalars(select(FundHoldingSnapshot)))
    key = (len(all_rows), round(sum(r.weight for r in all_rows), 3), today)
    with _AE.lock:
        if _AE.cache.get("key") == key:
            return _AE.cache["value"]
        by_scheme: dict[int, list] = {}
        for r in all_rows:
            by_scheme.setdefault(r.scheme_id, []).append(r)
        ids = sorted(by_scheme)
        if len(ids) < 6:
            value = {"available": False, "reason": "Too few fund snapshots to train the autoencoder.", "scores": {}}
            _AE.cache = {"key": key, "value": value}
            return value
        X = np.vstack([_feat(by_scheme[i], today) for i in ids])
        # augment with small jitter so the network learns a manifold rather than memorising points
        rng = np.random.default_rng(11)
        Xa = np.vstack([X] + [X * (1 + rng.normal(0, 0.03, X.shape)) for _ in range(20)])
        scaler, ae, err_a = _train_autoencoder(Xa)
        err = np.mean((ae.predict(scaler.transform(X)) - scaler.transform(X)) ** 2, axis=1)
        q1, q3 = np.percentile(err_a, [25, 75])
        threshold = float(q3 + 3 * (q3 - q1))
        # validation on synthetic corruptions (weights doubled / large duplicate / missing half)
        corrupt = []
        for x in X:
            c1 = x.copy(); c1[0] *= 1.9; c1[2] *= 1.9; c1[1] *= 1.9  # noqa: E702
            c2 = x.copy(); c2[8] += 6; c2[3] += 6  # noqa: E702
            c3 = x.copy(); c3[0] *= 0.45; c3[2] *= 0.45  # noqa: E702
            corrupt += [c1, c2, c3]
        Cz = scaler.transform(np.array(corrupt))
        cerr = np.mean((ae.predict(Cz) - Cz) ** 2, axis=1)
        detection = float(np.mean(cerr > threshold))
        false_pos = float(np.mean(err > threshold))
        names = {i.id: i.name for i in db.scalars(select(Instrument).where(Instrument.id.in_(ids)))}
        scores = {int(i): {"name": names.get(i, str(i)), "error": float(e), "flagged": bool(e > threshold)}
                  for i, e in zip(ids, err, strict=True)}
        value = {
            "available": True,
            "model": "MLP autoencoder 9-6-3-6-9 (tanh), scikit-learn",
            "threshold": threshold,
            "validation": {"synthetic_corruption_detection_rate": detection, "clean_flag_rate": false_pos,
                           "n_corruptions": len(corrupt), "n_schemes": len(ids)},
            "scores": scores,
            "note": "Experimental: flags unusual snapshots for review; never modifies holdings.",
        }
        _AE.cache = {"key": key, "value": value}
        return value


def check_snapshots(db: Session, snaps: dict[int, list[FundHoldingSnapshot]]) -> dict:
    today = dt.date.today()
    names = {i.id: i.name for i in db.scalars(select(Instrument).where(Instrument.id.in_(list(snaps) or [0])))}
    rules = []
    for sid, rows in snaps.items():
        rules += [{**r, "scheme_id": sid} for r in rule_checks(names.get(sid, str(sid)), rows, today)]
    ae = autoencoder_scores(db, today)
    held_scores = {sid: ae["scores"].get(sid) for sid in snaps if ae.get("scores")}
    ae_flags = [{"scheme_id": sid, **s} for sid, s in held_scores.items() if s and s["flagged"]]
    return {"rules": rules, "autoencoder": {k: v for k, v in ae.items() if k != "scores"},
            "autoencoder_flags": ae_flags, "held_scores": held_scores}
