"""Claude tool-use loop, exercised with a mocked Messages API (no network, no key needed)."""
from types import SimpleNamespace

from app.services import assistant, llm


class FakeAPI:
    """First call asks for the portfolio_summary tool; second call answers using the tool result."""

    def __init__(self, final_text: str):
        self.calls = []
        self.final_text = final_text

    def __call__(self, system, messages, tools=None, max_tokens=0):
        self.calls.append({"system": system, "messages": messages, "tools": tools})
        if len(self.calls) == 1:
            return SimpleNamespace(stop_reason="tool_use", content=[
                SimpleNamespace(type="text", text="Let me check."),
                SimpleNamespace(type="tool_use", id="tu_1", name="portfolio_summary", input={}),
            ])
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=self.final_text)])


def _enable_llm(monkeypatch, fake):
    monkeypatch.setattr(llm, "configured", lambda: True)
    monkeypatch.setattr(llm, "create", fake)


def test_claude_path_requires_consent(make_user, monkeypatch):
    c = make_user()
    fake = FakeAPI("Your portfolio is empty.")
    _enable_llm(monkeypatch, fake)
    a = c.post("/api/ask", json={"message": "What's my total value?"}).json()
    assert a["engine"] == "local" and not fake.calls  # no consent -> nothing sent to the LLM


def test_claude_tool_loop_and_citations(make_user, monkeypatch):
    c = make_user()
    c.patch("/api/settings", json={"consent_llm": True})
    fake = FakeAPI("Your portfolio is currently empty — add holdings to see a summary.")
    _enable_llm(monkeypatch, fake)
    a = c.post("/api/ask", json={"message": "What's my total value?"}).json()
    assert a["engine"] == "claude"
    assert a["answer"].startswith("Your portfolio is currently empty")
    assert len(fake.calls) == 2
    second = fake.calls[1]["messages"]
    assert second[-1]["role"] == "user" and second[-1]["content"][0]["type"] == "tool_result"
    assert second[-1]["content"][0]["tool_use_id"] == "tu_1"
    assert any(ci["tool"] == "portfolio_summary" for ci in a["citations"])
    assert {t["name"] for t in fake.calls[0]["tools"]} >= {"portfolio_summary", "exposure", "forecast"}
    assert "SEBI" in fake.calls[0]["system"]


def test_advice_in_model_output_is_blocked(make_user, monkeypatch):
    c = make_user()
    c.patch("/api/settings", json={"consent_llm": True})
    _enable_llm(monkeypatch, FakeAPI("Based on this, you should buy more HDFC Bank."))
    a = c.post("/api/ask", json={"message": "Summarise my holdings"}).json()
    assert a["guardrail"] == "advice_in_output_blocked"
    assert "SEBI" in a["answer"] and "should buy" not in a["answer"]


def test_refusal_stop_reason_falls_back_to_local(make_user, monkeypatch):
    c = make_user()
    c.patch("/api/settings", json={"consent_llm": True})
    monkeypatch.setattr(llm, "configured", lambda: True)
    monkeypatch.setattr(llm, "create", lambda *a, **k: SimpleNamespace(stop_reason="refusal", content=[]))
    a = c.post("/api/ask", json={"message": "What's my XIRR?"}).json()
    assert a["engine"] == "local" and a["answer"]


def test_unknown_tool_is_rejected():
    tools = SimpleNamespace()
    out = assistant._run_tool(tools, "__class__", {})
    assert "unknown tool" in out
