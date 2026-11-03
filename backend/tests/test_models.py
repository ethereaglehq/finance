"""Forecast pipeline: leakage controls, calibration, track-record immutability & scoring."""
import datetime as dt

import numpy as np
import pandas as pd
import pytest
from sqlalchemy import select, text

from app.models import ForecastLog, ImmutableRecordError, Instrument
from app.services import forecasting as fx
from app.services import scenarios, sentiment, trackrecord as tr
from app.services import filings


def _series(n=900, seed=0):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2021-01-01", periods=n)
    return pd.Series(100 * np.exp(np.cumsum(rng.normal(0.0003, 0.01, n))), index=idx)


def test_features_are_causal():
    s = _series()
    f1 = fx.build_features(s)
    s2 = s.copy()
    s2.iloc[600:] *= 1.5  # change the future
    f2 = fx.build_features(s2)
    pd.testing.assert_frame_equal(f1.iloc[:600], f2.iloc[:600])


def test_target_is_forward_return():
    s = _series()
    y = fx.build_target(s, 5)
    assert y.iloc[10] == pytest.approx(np.log(s.iloc[15] / s.iloc[10]) * 100)
    assert y.iloc[-5:].isna().all()


def test_walk_forward_purges_training_labels(monkeypatch):
    s = _series()
    seen = []
    real = fx.fit_calibrated

    def spy(name, X, y, h):
        seen.append((X.index[-1], h))
        return real(name, X, y, h)

    monkeypatch.setattr(fx, "fit_calibrated", spy)
    h = 5
    wf = fx.walk_forward(s, h, ["naive", "ridge"])
    X, y, _ = fx.dataset(s, h)
    starts = list(range(wf["_test_start"], len(X), fx.REFIT_EVERY))
    for (last_train_date, _), block in zip(seen[::2], starts, strict=True):
        last_pos = X.index.get_loc(last_train_date)
        # label of the last training row ends at last_pos + h, which must be strictly before the origin
        assert last_pos + h < block + 1
        assert last_pos == block - h - 1


def test_conformal_intervals_cover_on_iid_data():
    rng = np.random.default_rng(3)
    s = pd.Series(100 * np.exp(np.cumsum(rng.normal(0, 0.01, 1300))), index=pd.bdate_range("2019-01-01", periods=1300))
    wf = fx.walk_forward(s, 5, ["naive", "ridge"])
    for m in ("naive", "ridge"):
        assert 0.68 <= wf["metrics"][m]["coverage80"] <= 0.92
        assert 0.38 <= wf["metrics"][m]["coverage50"] <= 0.62
    # on a pure random walk, the model must not claim a significant edge over the naive baseline
    assert wf["metrics"]["ridge"]["beats_naive"] != "significant"


def test_track_record_is_append_only_and_tamper_evident(client, db):
    inst = db.scalar(select(Instrument).where(Instrument.symbol == "NIFTY50"))
    fc = fx.forecast(db, inst, 5, "ridge")
    rec = tr.log_forecast(db, fc, "live")
    assert tr.log_forecast(db, fc, "live").id == rec.id  # deduplicated per cutoff
    rec.point_return = 99.0
    with pytest.raises(ImmutableRecordError):
        db.commit()
    db.rollback()
    with pytest.raises(ImmutableRecordError):
        db.delete(db.get(ForecastLog, rec.id))
        db.commit()
    db.rollback()
    assert tr.verify_chain(db)["ok"]
    # raw tampering bypassing the ORM is detected by the hash chain
    db.execute(text("UPDATE forecast_log SET point_return = point_return + 1 WHERE id = :i"), {"i": rec.id})
    db.commit()
    assert tr.verify_chain(db) == {**tr.verify_chain(db), "ok": False, "broken_at": rec.id}
    db.execute(text("UPDATE forecast_log SET point_return = point_return - 1 WHERE id = :i"), {"i": rec.id})
    db.commit()
    assert tr.verify_chain(db)["ok"]


def test_backtest_records_are_scored_with_misses(client, db):
    rep = tr.report(db, "backtest")
    s = rep["summary"]
    assert s["n"] > 100 and s["pending"] == 0
    misses = sum(1 for r in db.scalars(select(ForecastLog).where(ForecastLog.origin == "backtest"))
                 if r.outcome and not r.outcome.inside80)
    assert misses > 0  # misses are kept and visible
    assert 0.6 < s["coverage80"] < 0.95


def test_matured_forecast_gets_scored(client, db):
    inst = db.scalar(select(Instrument).where(Instrument.symbol == "GOLD"))
    from app.services import marketdata as md

    s = md.get_series(db, inst.id)
    cutoff = s.index[-30].date()
    target = (pd.Timestamp(cutoff) + pd.offsets.BDay(5)).date()
    fc = {"instrument": {"id": inst.id}, "model": "naive", "model_version": "naive", "horizon_days": 5,
          "cutoff_date": cutoff.isoformat(), "target_date": target.isoformat(), "base_price": float(s.iloc[-30]),
          "point_return": 0.0, "interval80": [-50.0, 50.0], "interval50": [-0.001, 0.001],
          "interval_method": "test", "dataset_hash": "x", "code_version": "t"}
    rec = tr.log_forecast(db, fc, "live")
    assert tr.score_matured(db) >= 1
    db.refresh(rec)
    o = rec.outcome
    assert o is not None and o.inside80 is True
    exp = np.log(float(s.loc[s.index >= pd.Timestamp(target)].iloc[0]) / float(s.loc[pd.Timestamp(cutoff)])) * 100
    assert o.realised_return == pytest.approx(exp)
    assert o.direction_hit is None  # zero forecast has no direction


def test_scenarios_are_labelled_and_evaluated(client, db):
    inst = db.scalar(select(Instrument).where(Instrument.symbol == "NIFTY50"))
    for engine in ("bootstrap", "vae"):
        r = scenarios.scenarios(db, inst, engine, 200)
        assert "not predictions" in r["label"]
        assert len(r["fan"]) == 22 and r["fan"][0]["p50"] == pytest.approx(r["base_price"])
        assert 0 <= r["evaluation"]["ks_21d_return"] <= 1


def test_sentiment_lexicon_accuracy():
    ev = sentiment.evaluate()
    assert ev["accuracy"] >= 0.8


def test_filing_facts_extraction():
    f = filings.extract_facts(filings.SAMPLE_TEXT)
    rev = f["metrics"]["revenue"]
    assert rev["current"] == 4820.50 and rev["year_ago_quarter"] == 4210.75
    assert rev["yoy_pct"] == pytest.approx(14.5, abs=0.05)
    assert f["metrics"]["net_profit"]["current"] == 525.30
    assert f["metrics"]["eps"]["current"] == 13.13
    assert f["unit"] == "₹ crore"
    assert any(r["term"] == "impairment" for r in f["risk_mentions"])


def test_llm_grounding_check_rejects_invented_numbers():
    from app.services import llm

    facts = '{"revenue": 4820.5, "growth": 14.5}'
    assert llm.grounded("Revenue was 4,820.5 crore, up 14.5%.", facts)[0]
    ok, extra = llm.grounded("Revenue was 5,100 crore.", facts)
    assert not ok and 5100.0 in extra


def test_today_helper():
    assert isinstance(fx.today_date(), dt.date)
