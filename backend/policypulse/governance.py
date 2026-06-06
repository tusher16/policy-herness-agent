"""Governance: input guardrail + live policy checks (mirrors the JS Governance tab)."""
import re

from . import config

# Prompt-injection / malicious topic patterns.
MALICIOUS_RE = re.compile(
    r"(ignore (all |the )?(previous|above)|system prompt|disregard (all|previous)|jailbreak"
    r"|<script|drop table|rm -rf|reveal (your )?(api[_ ]?key|secret)|bearer\s)",
    re.IGNORECASE,
)


def check_topic(topic: str) -> dict:
    """Input guardrail: is the topic allowed / not malicious?"""
    t = (topic or "").strip()
    if len(t) < 8:
        return {"ok": False, "detail": "topic too short (min 8 chars)"}
    if MALICIOUS_RE.search(t):
        return {"ok": False, "detail": "blocked: possible prompt-injection / malicious pattern"}
    return {"ok": True, "detail": "allowed — looks like a genuine policy topic"}


def governance_checks(topic: str, output: dict | None, sources=()) -> list:
    """Five live checks. Each: {label, sub, ok, warn, pending, detail}."""
    inp = check_topic(topic)
    sources = list(sources or [])
    official = sum(1 for s in sources if s.get("type") == "government")
    citations = len((output or {}).get("citations") or [])
    no_run = not output
    has_disclaimer = bool((output or {}).get("disclaimer"))
    has_conf = bool((output or {}).get("confidence"))
    providers = config.provider_readiness()
    configured = ", ".join(k for k, ok in providers.items() if ok) or "none"
    return [
        {"label": "Input guardrail", "sub": "topic is allowed / not malicious",
         "ok": inp["ok"], "warn": False, "pending": False, "detail": inp["detail"]},
        {"label": "Source policy", "sub": "official sources preferred",
         "ok": official > 0, "warn": bool(sources) and official == 0, "pending": not sources,
         "detail": (f"{official}/{len(sources)} official (government) sources"
                    + (" — none found (preference not met)" if sources and official == 0 else ""))
                   if sources else "awaiting run"},
        {"label": "Citation check", "sub": "every claim has a source",
         "ok": citations > 0, "warn": False, "pending": no_run,
         "detail": "awaiting run" if no_run else f"{citations} citation(s) attached"},
        {"label": "Output guardrail", "sub": "disclaimer + confidence included",
         "ok": has_disclaimer and has_conf, "warn": False, "pending": no_run,
         "detail": "awaiting run" if no_run
                   else f"disclaimer {'OK' if has_disclaimer else 'X'} · confidence {'OK' if has_conf else 'X'}"},
        {"label": "API key status", "sub": "keys loaded server-side",
         "ok": config.is_ready(), "warn": not config.is_ready(), "pending": False,
         "detail": f"configured providers: {configured}"},
    ]
