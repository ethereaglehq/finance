"""Thin wrapper around the Anthropic Messages API (optional).

FinLex never requires an LLM: every feature has a deterministic fallback. Claude is used only when
FINLEX_ANTHROPIC_API_KEY is configured AND (for user data) the user has consented in Settings.
Number-grounding validation rejects generated text that introduces figures absent from the facts.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from ..config import get_settings

log = logging.getLogger("finlex.llm")
FALLBACK_BETA = "server-side-fallback-2026-07-01"


def configured() -> bool:
    return bool(get_settings().anthropic_api_key)


def _client():
    import anthropic

    return anthropic.Anthropic(api_key=get_settings().anthropic_api_key, max_retries=2, timeout=60.0)


def create(system: str, messages: list[dict], tools: list[dict] | None = None, max_tokens: int = 4000) -> Any:
    """Single Messages API call. Uses server-side refusal fallbacks; caller handles stop_reason."""
    s = get_settings()
    kwargs: dict[str, Any] = {
        "model": s.llm_model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
        "output_config": {"effort": s.llm_effort},
        "betas": [FALLBACK_BETA],
        "fallbacks": "default",
    }
    if tools:
        kwargs["tools"] = tools
    return _client().beta.messages.create(**kwargs)


def text_of(resp: Any) -> str:
    return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()


_NUM = re.compile(r"(?<![\w.])[-+]?\d[\d,]*\.?\d*")


def numbers_in(text: str) -> set[float]:
    out = set()
    for m in _NUM.findall(text):
        try:
            out.add(round(abs(float(m.replace(",", ""))), 1))
        except ValueError:
            pass
    return out


def grounded(generated: str, facts_text: str, allow: set[float] | None = None) -> tuple[bool, set[float]]:
    """True if every number in `generated` appears (to 0.1 precision, sign-agnostic) in the facts."""
    allowed = numbers_in(facts_text) | (allow or set()) | {float(i) for i in range(0, 101)}
    extra = {n for n in numbers_in(generated) if n not in allowed and round(n) not in allowed}
    return (not extra), extra


def summarise_facts(system: str, facts_text: str, instruction: str, max_tokens: int = 1200) -> str | None:
    """Ask Claude to phrase pre-computed facts; returns None on any failure or grounding violation."""
    if not configured():
        return None
    try:
        resp = create(system, [{"role": "user", "content": f"{instruction}\n\nFACTS (JSON):\n{facts_text}"}],
                      max_tokens=max_tokens)
        if getattr(resp, "stop_reason", "") == "refusal":
            return None
        out = text_of(resp)
        ok, extra = grounded(out, facts_text)
        if not ok:
            log.warning("LLM summary rejected: ungrounded numbers %s", sorted(extra)[:10])
            return None
        return out
    except Exception as e:  # noqa: BLE001
        log.warning("LLM call failed: %s", e)
        return None
