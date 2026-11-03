"""API-level tests: auth, isolation, CSRF, holdings, imports, exposure, assistant guardrails, planner, privacy."""
import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app.main import app


def inst_id(c, symbol):
    r = c.get(f"/api/instruments?q={symbol}&limit=50")
    return next(i["id"] for i in r.json() if i["symbol"] == symbol)


def test_health_and_status(client):
    assert client.get("/api/health").json()["ok"]
    s = client.get("/api/status").json()
    assert s["market_data_mode"] == "synthetic" and s["instruments_with_prices"] > 50


def test_register_login_logout_and_password_rules(client):
    c = TestClient(app)
    weak = c.post("/api/auth/register", json={"email": "weak@example.com", "password": "alllowercase1", "accept_terms": True})
    assert weak.status_code == 400
    no_terms = c.post("/api/auth/register", json={"email": "nt@example.com", "password": "Passw0rdX", "accept_terms": False})
    assert no_terms.status_code == 400
    r = c.post("/api/auth/register", json={"email": "Login@Example.com", "password": "Passw0rdX", "accept_terms": True})
    assert r.status_code == 200
    assert c.post("/api/auth/register", json={"email": "login@example.com", "password": "Passw0rdX", "accept_terms": True}).status_code == 409
    c.post("/api/auth/logout", headers={"X-CSRF-Token": c.cookies.get("finlex_csrf", "")})
    c.cookies.clear()
    assert c.get("/api/portfolio").status_code == 401
    assert c.post("/api/auth/login", json={"email": "login@example.com", "password": "wrong"}).status_code == 401
    assert c.post("/api/auth/login", json={"email": "login@example.com", "password": "Passw0rdX"}).status_code == 200
    assert c.get("/api/portfolio").status_code == 200


def test_csrf_required_for_mutations(make_user):
    c = make_user()
    token = c.headers.pop("X-CSRF-Token")
    r = c.post("/api/accounts", json={"label": "Zerodha"})
    assert r.status_code == 403
    r = c.post("/api/accounts", json={"label": "Zerodha"}, headers={"X-CSRF-Token": "forged"})
    assert r.status_code == 403
    r = c.post("/api/accounts", json={"label": "Zerodha"}, headers={"X-CSRF-Token": token})
    assert r.status_code == 200


def test_holdings_lifecycle_and_valuation(make_user):
    c = make_user()
    rid = inst_id(c, "RELIANCE")
    d = (dt.date.today() - dt.timedelta(days=200)).isoformat()
    r = c.post("/api/holdings", json={"instrument_id": rid, "quantity": 10, "price": 1000, "trade_date": d,
                                      "account_label": "Zerodha"})
    assert r.status_code == 200, r.text
    hid = r.json()["id"]
    # merging a second buy into the same holding
    c.post("/api/holdings", json={"instrument_id": rid, "quantity": 10, "price": 1200, "trade_date": d,
                                  "account_label": "Zerodha"})
    pf = c.get("/api/portfolio").json()
    h = next(x for x in pf["holdings"] if x["id"] == hid)
    assert h["quantity"] == 20 and h["avg_cost"] == pytest.approx(1100)
    assert h["value"] == pytest.approx(h["price"] * 20)
    assert pf["totals"]["value"] == pytest.approx(h["value"])
    assert h["synthetic"] is True  # offline test mode is labelled
    # overselling is rejected, valid sell accepted
    bad = c.post(f"/api/holdings/{hid}/transactions", json={"type": "SELL", "quantity": 50, "price": 1300, "trade_date": d})
    assert bad.status_code == 400
    ok = c.post(f"/api/holdings/{hid}/transactions", json={"type": "SELL", "quantity": 5, "price": 1300,
                                                           "trade_date": dt.date.today().isoformat()})
    assert ok.status_code == 200
    det = c.get(f"/api/holdings/{hid}").json()
    assert det["holding"]["quantity"] == 15 and det["holding"]["realised_pnl"] == pytest.approx(5 * 200)
    # future-dated trades are rejected
    fut = (dt.date.today() + dt.timedelta(days=3)).isoformat()
    assert c.post("/api/holdings", json={"instrument_id": rid, "quantity": 1, "price": 1, "trade_date": fut}).status_code == 400
    hist = c.get("/api/portfolio/history?period=1Y").json()
    assert hist["points"] and hist["points"][-1]["value"] == pytest.approx(pf["totals"]["value"] - 5 * h["price"], rel=0.05)


def test_fd_and_physical_gold(make_user):
    c = make_user()
    start = (dt.date.today() - dt.timedelta(days=365)).isoformat()
    mat = (dt.date.today() + dt.timedelta(days=365)).isoformat()
    r = c.post("/api/holdings/fd", json={"bank": "SBI", "principal": 100000, "rate": 7, "start_date": start,
                                         "maturity_date": mat, "compounding": "quarterly"})
    assert r.status_code == 200
    gold = inst_id(c, "GOLD")
    r = c.post("/api/holdings", json={"instrument_id": gold, "quantity": 10, "price": 6000, "trade_date": start, "purity": 0.916})
    assert r.status_code == 200
    pf = c.get("/api/portfolio").json()
    fd = next(h for h in pf["holdings"] if h["instrument"]["asset_class"] == "fd")
    assert fd["value"] == pytest.approx(100000 * 1.0175 ** 4, rel=0.002)
    g = next(h for h in pf["holdings"] if h["instrument"]["symbol"] == "GOLD")
    assert g["estimated"] is True
    assert any(i["code"] == "estimated_value" for i in pf["issues"])


def test_cross_user_isolation(make_user):
    a, b = make_user("a"), make_user("b")
    rid = inst_id(a, "INFY")
    hid = a.post("/api/holdings", json={"instrument_id": rid, "quantity": 1, "price": 1000,
                                        "trade_date": "2024-01-02"}).json()["id"]
    assert b.get(f"/api/holdings/{hid}").status_code == 404
    assert b.delete(f"/api/holdings/{hid}").status_code == 404
    assert b.post(f"/api/holdings/{hid}/transactions", json={"type": "BUY", "quantity": 1, "price": 1,
                                                             "trade_date": "2024-01-02"}).status_code == 404
    assert all(h["id"] != hid for h in b.get("/api/portfolio").json()["holdings"])
    acc = a.post("/api/accounts", json={"label": "Mine"}).json()["id"]
    assert b.patch(f"/api/accounts/{acc}", json={"label": "Hijack"}).status_code == 404


def test_csv_import_review_and_confirm(make_user):
    c = make_user()
    csv = (
        "asset_type,identifier,side,quantity,price,trade_date,account,fees,purity,fd_rate,fd_maturity_date,fd_compounding,notes\n"
        "stock,TCS,BUY,5,3000,2024-03-15,Zerodha,10,,,,,\n"
        "mf,118955,BUY,20.5,1500,2024-02-01,CAMS,0,,,,,\n"
        "stock,NOTAREALSYMBOLXYZ,BUY,1,10,2024-03-15,Zerodha,0,,,,,\n"
        "gold,physical,BUY,10,6000,2023-10-24,Locker,0,0.916,,,,\n"
        "fd,HDFC Bank,BUY,1,50000,2025-01-01,HDFC,0,,7.1,2027-01-01,quarterly,\n"
        "stock,INFY,BUY,-3,1500,2024-03-15,Zerodha,0,,,,,\n"
    )
    r = c.post("/api/imports/csv", files={"file": ("h.csv", csv.encode(), "text/csv")})
    assert r.status_code == 200, r.text
    b = r.json()
    st = {row["identifier"]: row["status"] for row in b["rows"]}
    assert st["TCS"] == "ok" and st["118955"] == "ok"
    assert st["NOTAREALSYMBOLXYZ"] in ("unmatched", "ambiguous")
    assert st["INFY"] == "invalid"
    res = c.post(f"/api/imports/{b['id']}/confirm", json={"decisions": {}, "default_account": "Imported"}).json()
    assert res["imported"] == 4 and not res["errors"]
    pf = c.get("/api/portfolio").json()
    assert {h["instrument"]["symbol"] for h in pf["holdings"]} >= {"TCS", "MF118955", "GOLD", "FD"}
    assert {a["label"] for a in pf["accounts"]} >= {"Zerodha", "CAMS", "Locker", "HDFC"}
    again = c.post(f"/api/imports/{b['id']}/confirm", json={})
    assert again.status_code == 400  # one-shot


def test_import_rejects_bad_files(make_user):
    c = make_user()
    assert c.post("/api/imports/csv", files={"file": ("x.csv", b"foo,bar\n1,2\n", "text/csv")}).status_code == 400
    assert c.post("/api/imports/csv", files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 400
    big = b"a" * (5 * 1024 * 1024 + 10)
    assert c.post("/api/imports/csv", files={"file": ("x.csv", big, "text/csv")}).status_code == 413
    assert c.post("/api/imports/cas", files={"file": ("s.pdf", b"not a pdf", "application/pdf")},
                  data={"password": "x"}).status_code == 400


def test_exposure_lookthrough_matches_hand_calculation(make_user):
    c = make_user()
    mf = inst_id(c, "MF148986")  # HDFC Banking & FS: HDFCBANK 19.2%
    hdfc = inst_id(c, "HDFCBANK")
    c.post("/api/holdings", json={"instrument_id": mf, "quantity": 1000, "price": 10, "trade_date": "2024-01-02"})
    c.post("/api/holdings", json={"instrument_id": hdfc, "quantity": 10, "price": 900, "trade_date": "2024-01-02"})
    pf = c.get("/api/portfolio").json()
    fund_val = next(h["value"] for h in pf["holdings"] if h["instrument"]["id"] == mf)
    direct_val = next(h["value"] for h in pf["holdings"] if h["instrument"]["id"] == hdfc)
    e = c.get("/api/exposure").json()
    row = next(x for x in e["companies"] if x["symbol"] == "HDFCBANK")
    assert row["indirect"] == pytest.approx(fund_val * 0.192, rel=1e-6)
    assert row["direct"] == pytest.approx(direct_val)
    assert row["pct"] == pytest.approx((fund_val * 0.192 + direct_val) / pf["totals"]["value"] * 100, rel=1e-6)
    assert e["coverage"][0]["disclosure_date"]
    assert e["flags"]  # concentrated by construction


def test_compare_forecast_endpoints(make_user):
    c = make_user()
    ids = [inst_id(c, s) for s in ("NIFTY50", "GOLD")]
    r = c.get(f"/api/market/compare?ids={ids[0]},{ids[1]}&period=1Y").json()
    assert len(r["series"]) == 2 and r["points"][0][str(ids[0])] == pytest.approx(100)
    f = c.get(f"/api/market/forecast?instrument_id={ids[0]}&horizon=5&model=ridge").json()
    lo, hi = f["forecast"]["interval80"]
    assert lo <= f["forecast"]["point_return"] <= hi
    assert {"naive", "drift", "ridge", "xgboost"} <= set(f["evaluation"]["metrics"])
    assert f["logged"]["record_hash"]
    assert c.get(f"/api/market/forecast?instrument_id={ids[0]}&horizon=7").status_code == 400


def test_assistant_guardrails_and_grounding(make_user):
    c = make_user()
    hid = inst_id(c, "HDFCBANK")
    c.post("/api/holdings", json={"instrument_id": hid, "quantity": 10, "price": 900, "trade_date": "2024-01-02"})
    for q in ["Should I buy Reliance now?", "Which stock should I buy for quick gains?", "Give me a multibagger tip",
              "What is the target price for TCS?", "Buy or sell HDFC Bank?"]:
        a = c.post("/api/ask", json={"message": q}).json()
        assert a["guardrail"] == "advice_request_declined", q
        assert "SEBI" in a["answer"]
    a = c.post("/api/ask", json={"message": "What's my XIRR and total value?"}).json()
    assert a["guardrail"] is None and a["engine"] == "local"
    assert any(ci["tool"] == "portfolio_summary" for ci in a["citations"])
    a = c.post("/api/ask", json={"message": "What does interval coverage mean?"}).json()
    assert "coverage" in a["answer"].lower()
    a = c.post("/api/ask", json={"message": "What is the forecast range for gold next month?"}).json()
    assert "80% range" in a["answer"]
    hist = c.get("/api/ask/history").json()
    assert len(hist) == 16
    assert c.delete("/api/ask/history").status_code == 200 and c.get("/api/ask/history").json() == []


def test_planner_respects_constraints(make_user):
    c = make_user()
    gold = inst_id(c, "GOLDBEES")
    nifty = inst_id(c, "NIFTYBEES")
    c.post("/api/holdings", json={"instrument_id": gold, "quantity": 1000, "price": 50, "trade_date": "2023-01-02"})
    c.post("/api/holdings", json={"instrument_id": nifty, "quantity": 100, "price": 200, "trade_date": "2023-01-02"})
    r = c.post("/api/plan/allocate", json={"bounds": {"gold": {"min": 0, "max": 20}}, "use_risk_cap": False}).json()
    assert r["feasible"] and r["solutions"]
    for s in r["solutions"]:
        assert s["allocation"]["gold"] <= 20 and sum(s["allocation"].values()) == 100
    turnovers = [s["turnover_pct"] for s in r["solutions"]]
    assert turnovers == sorted(turnovers)  # A* returns least-change mixes first
    assert any("Gold" in v for v in r["violations_now"])
    bad = c.post("/api/plan/allocate", json={"bounds": {"gold": {"min": 60, "max": 100}, "debt": {"min": 50, "max": 100}}}).json()
    assert not bad["feasible"] and "Minimums add up to 110%" in bad["problems"][0]
    rev = c.get("/api/plan/review").json()
    assert {r["id"] for r in rev["rules"]} >= {"R1", "R2", "R7"}


def test_alerts_and_events(make_user):
    c = make_user()
    hid = inst_id(c, "HDFCBANK")
    c.post("/api/holdings", json={"instrument_id": hid, "quantity": 10, "price": 900, "trade_date": "2024-01-02"})
    assert c.post("/api/alerts", json={"rule_type": "price_move"}).status_code == 400
    a = c.post("/api/alerts", json={"rule_type": "concentration", "threshold": 5}).json()
    ev = c.post("/api/alerts/evaluate").json()
    assert ev["triggered"] == 1
    assert c.post("/api/alerts/evaluate").json()["triggered"] == 0  # cooldown
    events = c.get("/api/alerts/events").json()
    assert events and not events[0]["read"]
    c.post("/api/alerts/events/read-all")
    assert all(e["read"] for e in c.get("/api/alerts/events").json())
    assert c.delete(f"/api/alerts/{a['id']}").status_code == 200


def test_export_and_delete_account(make_user):
    c = make_user()
    rid = inst_id(c, "ITC")
    c.post("/api/holdings", json={"instrument_id": rid, "quantity": 3, "price": 400, "trade_date": "2024-01-02"})
    c.patch("/api/settings", json={"consent_llm": True, "risk_level": "conservative"})
    exp = c.get("/api/settings/export")
    assert exp.status_code == 200 and "attachment" in exp.headers["content-disposition"]
    body = exp.json()
    assert body["portfolio"]["holdings"][0]["instrument"]["symbol"] == "ITC"
    assert any(a["action"] == "consent_llm_granted" for a in body["audit_log"])
    assert c.post("/api/settings/delete-account", json={"password": "wrong", "confirm": "DELETE"}).status_code == 400
    assert c.post("/api/settings/delete-account", json={"password": "Passw0rdX", "confirm": "DELETE"}).status_code == 200
    assert c.get("/api/portfolio").status_code == 401


def test_demo_session_and_pulse(client):
    c = TestClient(app)
    r = c.post("/api/auth/demo")
    assert r.status_code == 200 and r.json()["user"]["is_demo"]
    d = c.get("/api/dashboard").json()
    assert d["totals"]["holdings"] >= 15
    b = c.get("/api/pulse/brief").json()
    assert b["synthetic"] is True and "NIFTY 50" in b["summary"]
    n = c.get("/api/pulse/news").json()
    assert n["items"] and all(i["is_sample"] for i in n["items"])
    f = c.get("/api/pulse/filings").json()
    assert f and f[0]["is_sample"]
    tr = c.get("/api/track-record?origin=backtest").json()
    assert tr["chain"]["ok"] and tr["summary"]["n"] > 0


def test_fund_disclosure_upload_is_admin_only(make_user):
    c = make_user()
    mf = inst_id(c, "MF122639")
    r = c.post(f"/api/exposure/fund-holdings/{mf}", files={"file": ("f.csv", b"name,weight\nX,10\n", "text/csv")},
               data={"disclosure_date": "2026-10-31", "source": "AMC"})
    assert r.status_code == 403


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["cache-control"] == "no-store"
