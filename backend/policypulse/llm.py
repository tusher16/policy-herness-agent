"""LLM call with strict-JSON parsing, schema validation, and retries.

Mirrors `callJSON` / `pullText` / `tryJSON` / `missingKeys` from the JS app.
"""
import json
import re

from . import config
from .http_util import post_json

_JSON_RE = re.compile(r"\{[\s\S]*\}")


def pull_text(data: dict) -> str:
    """Extract assistant text from an OpenRouter chat-completion response."""
    msg = (data.get("choices") or [{}])[0].get("message", {}) or {}
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join((b.get("text") or b.get("content") or "") for b in content)
    return ""


def try_json(text: str):
    """Best-effort: pull the first {...} block out of `text` and parse it."""
    if not text:
        return None
    m = _JSON_RE.search(text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def missing_keys(obj, keys) -> list:
    """Which required keys are absent/empty (lightweight schema validation)."""
    if not obj:
        return list(keys)
    miss = []
    for k in keys:
        v = obj.get(k)
        if v is None or (isinstance(v, list) and len(v) == 0):
            miss.append(k)
    return miss


def call_json(messages, required_keys=(), max_retries: int = 2, max_tokens: int = 2500, model=None) -> dict:
    """Call the LLM for strict JSON; validate against a key schema; retry on truncation/invalid.

    Returns {"data", "json", "attempts", "valid"}. attempts - 1 == retries used.
    """
    if not config.OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY is not configured")
    model = model or config.DEFAULT_MODEL
    last_data, last_text = None, ""
    for attempt in range(max_retries + 1):
        convo = list(messages)
        if attempt > 0:
            keyhint = f" containing keys: {', '.join(required_keys)}" if required_keys else ""
            convo = list(messages) + [
                {"role": "assistant", "content": last_text[:1200]},
                {"role": "user", "content":
                    "Your previous reply was invalid or incomplete. Respond with ONLY one complete "
                    f"JSON object{keyhint}. No markdown, no prose."},
            ]
        status, data = post_json(
            "https://openrouter.ai/api/v1/chat/completions",
            {"Authorization": f"Bearer {config.OPENROUTER_API_KEY}", "X-Title": "PolicyPulse"},
            {"model": model, "max_tokens": max_tokens, "messages": convo},
        )
        if status != 200:
            raise RuntimeError(f"LLM HTTP {status}: {(data or {}).get('error', '')}")
        last_data = data
        last_text = pull_text(data)
        truncated = (data.get("choices") or [{}])[0].get("finish_reason") == "length"
        parsed = try_json(last_text)
        if parsed and not missing_keys(parsed, required_keys) and not truncated:
            return {"data": data, "json": parsed, "attempts": attempt + 1, "valid": True}
    return {"data": last_data, "json": try_json(last_text), "attempts": max_retries + 1, "valid": False}
