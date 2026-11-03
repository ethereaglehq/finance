"""Known-answer tests for portfolio maths (blueprint §19: portfolio calculations, fund overlap)."""
import datetime as dt
import math
from types import SimpleNamespace

import pytest

from app.services import exposure, portfolio as pfs


def tx(t, q, p, d, fees=0.0, i=0):
    return SimpleNamespace(type=t, quantity=q, price=p, trade_date=d, fees=fees, id=i)


def test_xirr_single_period_matches_spreadsheet():
    # Excel: =XIRR({-10000, 11000}, {2020-01-01, 2021-01-01}) = 0.09973...
    r = pfs.xirr([(dt.date(2020, 1, 1), -10000), (dt.date(2021, 1, 1), 11000)])
    assert r == pytest.approx(1.1 ** (365 / 366) - 1, abs=1e-6)


def test_xirr_sip_npv_is_zero():
    cfs = [(dt.date(2023, m, 5), -5000.0) for m in range(1, 13)] + [(dt.date(2024, 1, 5), 64000.0)]
    r = pfs.xirr(cfs)
    t0 = cfs[0][0]
    npv = sum(a / (1 + r) ** ((d - t0).days / 365) for d, a in cfs)
    assert abs(npv) < 1e-4
    assert 0.1 < r < 0.15  # ~12.3% annualised for this SIP


def test_xirr_undefined_without_sign_change():
    assert pfs.xirr([(dt.date(2024, 1, 1), -100), (dt.date(2024, 6, 1), -100)]) is None


def test_average_cost_and_realised_pnl():
    st = pfs.replay([
        tx("BUY", 10, 100, dt.date(2024, 1, 1), fees=10),
        tx("BUY", 10, 120, dt.date(2024, 2, 1), fees=10),
        tx("SELL", 5, 150, dt.date(2024, 3, 1), fees=5),
    ])
    avg = (1000 + 10 + 1200 + 10) / 20  # 111.0 incl. fees
    assert st.quantity == 15
    assert st.cost_basis == pytest.approx(avg * 15)
    assert st.realised == pytest.approx(5 * (150 - avg) - 5)


def test_oversell_is_rejected():
    with pytest.raises(pfs.PortfolioError):
        pfs.replay([tx("BUY", 1, 100, dt.date(2024, 1, 1)), tx("SELL", 2, 100, dt.date(2024, 1, 2))])


def test_fd_quarterly_compounding():
    meta = {"principal": 100000, "rate": 7.0, "start_date": "2024-01-01", "maturity_date": "2026-01-01",
            "compounding": "quarterly"}
    one_year = dt.date(2024, 12, 31)  # 365 days
    assert pfs.fd_value(meta, one_year) == pytest.approx(100000 * 1.0175 ** 4, rel=1e-9)
    # value stops growing after maturity
    assert pfs.fd_value(meta, dt.date(2030, 1, 1)) == pytest.approx(pfs.fd_value(meta, dt.date(2026, 1, 1)))


def test_fd_simple_interest():
    meta = {"principal": 50000, "rate": 6.0, "start_date": "2024-01-01", "maturity_date": "2025-01-01",
            "compounding": "simple"}
    assert pfs.fd_value(meta, dt.date(2024, 7, 1)) == pytest.approx(50000 * (1 + 0.06 * 182 / 365))


def _snap(name, w, at="equity", iid=None):
    return SimpleNamespace(underlying_name=name, weight=w, asset_type=at, underlying_instrument_id=iid,
                           underlying_isin=None)


def test_overlap_is_sum_of_min_weights():
    a = [_snap("HDFC Bank", 9, iid=1), _snap("ICICI Bank", 8, iid=2), _snap("Infosys", 5, iid=3),
         _snap("Other equity holdings (not itemised)", 50), _snap("Cash", 5, "cash")]
    b = [_snap("HDFC Bank", 7, iid=1), _snap("ICICI Bank", 10, iid=2), _snap("TCS", 4, iid=4),
         _snap("Other equity holdings (not itemised)", 60)]
    pct, common = exposure.overlap_pct(a, b)
    assert pct == pytest.approx(7 + 8)
    assert {c["name"] for c in common} == {"HDFC Bank", "ICICI Bank"}


def test_overlap_identical_funds_is_full_itemised_weight():
    a = [_snap("X", 60, iid=1), _snap("Y", 40, iid=2)]
    assert exposure.overlap_pct(a, a)[0] == pytest.approx(100)


def test_xirr_precision_against_closed_form():
    # two equal halves invested 1y and 0.5y apart, closed form check via bisection on NPV
    cfs = [(dt.date(2023, 1, 1), -1000), (dt.date(2023, 7, 2), -1000), (dt.date(2024, 1, 1), 2200)]
    r = pfs.xirr(cfs)
    f = sum(a / (1 + r) ** ((d - cfs[0][0]).days / 365) for d, a in cfs)
    assert math.isclose(f, 0, abs_tol=1e-5)
