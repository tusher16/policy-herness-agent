"""Search providers (Tavily / Exa / OpenRouter web search) with fallback + escalation.

Mirrors the JS `runSearch` logic. Because this runs on the server (not a browser), we call the
search APIs DIRECTLY with the key from config — no proxy needed to hide it.

Every provider returns a uniform dict:  {"sources": [...], "summary": str}
Each source is:  {"url", "title", "type", "key_info", "reliability"}
"""
from . import config
from .http_util import post_json
from .prompts import SYS_SEARCH


# ── source mappers ────────────────────────────────────────────────────────────
def _make_source(url: str, title: str, content: str, fallback_info: str) -> dict:
    official = config.is_official(url)
    info = (content or "").strip()[:500] or fallback_info
    return {
        "url": url,
        "title": title or url,
        "type": "government" if official else "source",
        "key_info": info,
        "reliability": 0.9 if official else 0.72,
    }


def _build_sources(rows: list, fallback_info: str) -> list:
    """Turn (url, title, content) rows into source dicts, skipping blanks and duplicate URLs."""
    sources, seen = [], set()
    for url, title, content in rows:
        if not url or url in seen:
            continue
        seen.add(url)
        sources.append(_make_source(url, title, content, fallback_info))
    return sources


def _tavily_to_sources(data: dict) -> list:
    rows = [(r.get("url"), r.get("title"), r.get("content", ""))
            for r in data.get("results") or []]
    return _build_sources(rows, "Found via Tavily search.")


def _exa_to_sources(data: dict) -> list:
    rows = [(r.get("url"), r.get("title"), r.get("text") or r.get("summary") or "")
            for r in data.get("results") or []]
    return _build_sources(rows, "Found via Exa search.")


def _annotations_to_sources(data: dict) -> list:
    # OpenRouter returns sources as "url_citation" annotations on the assistant message.
    message = (data.get("choices") or [{}])[0].get("message") or {}
    citations = [a.get("url_citation") or {}
                 for a in (message.get("annotations") or [])
                 if a.get("type") == "url_citation"]
    rows = [(c.get("url"), c.get("title"), c.get("content", "")) for c in citations]
    return _build_sources(rows, "Found via OpenRouter web search.")


# ── providers ─────────────────────────────────────────────────────────────────
def search_tavily(query: str) -> dict:
    if not config.TAVILY_API_KEY:
        raise RuntimeError("TAVILY_API_KEY is not configured")
    status, data = post_json(
        "https://api.tavily.com/search",
        {"Authorization": f"Bearer {config.TAVILY_API_KEY}"},
        {"query": query, "search_depth": "advanced", "max_results": 6, "include_answer": True},
    )
    if status != 200:
        raise RuntimeError(f"Tavily HTTP {status}: {data.get('error', '')}")
    return {"sources": _tavily_to_sources(data), "summary": data.get("answer") or ""}


def search_exa(query: str) -> dict:
    if not config.EXA_API_KEY:
        raise RuntimeError("EXA_API_KEY is not configured")
    status, data = post_json(
        "https://api.exa.ai/search",
        {"x-api-key": config.EXA_API_KEY},
        {"query": query, "type": "auto", "numResults": 6, "contents": {"text": {"maxCharacters": 500}}},
    )
    if status != 200:
        raise RuntimeError(f"Exa HTTP {status}: {data.get('error', '')}")
    return {"sources": _exa_to_sources(data), "summary": ""}


def search_openrouter(query: str) -> dict:
    """Legacy: the model itself runs web_search and returns citation annotations."""
    if not config.OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY is not configured")
    status, data = post_json(
        "https://openrouter.ai/api/v1/chat/completions",
        {"Authorization": f"Bearer {config.OPENROUTER_API_KEY}", "X-Title": "PolicyPulse"},
        {
            "model": config.DEFAULT_MODEL,
            "max_tokens": 1000,
            "messages": [
                {"role": "system", "content": SYS_SEARCH},
                {"role": "user", "content": f'Policy topic to research: "{query}"'},
            ],
            "tools": [{"type": "openrouter:web_search"}],
        },
    )
    if status != 200:
        raise RuntimeError(f"OpenRouter search HTTP {status}: {data.get('error', '')}")
    return {"sources": _annotations_to_sources(data), "summary": ""}


PROVIDERS = {"tavily": search_tavily, "exa": search_exa, "openrouter": search_openrouter}
PROVIDER_ORDER = ["tavily", "exa", "openrouter"]


# ── orchestration ─────────────────────────────────────────────────────────────
def run_search(query: str, preferred: str = "tavily") -> dict:
    """Try the preferred provider; fall back to the others on error or empty results."""
    if preferred not in PROVIDERS:
        allowed = ", ".join(PROVIDERS)
        raise ValueError(f"Unknown provider '{preferred}'. Allowed providers: {allowed}")
    order = [preferred] + [p for p in PROVIDER_ORDER if p != preferred]
    last_err = None
    for key in order:
        try:
            res = PROVIDERS[key](query)
            if res["sources"]:
                res["provider"] = key
                return res
        except Exception as e:  # noqa: BLE001 — try the next provider
            last_err = e
    if last_err:
        raise last_err
    return {"sources": [], "summary": "", "provider": preferred}


def search_with_source_policy(query: str, preferred: str = "tavily") -> dict:
    """run_search + source-policy self-heal.

    If the chosen provider returns NO official (government) sources, escalate to the LLM web
    search (best at finding primary .gov pages) and use it if it does better.
    """
    res = run_search(query, preferred)
    has_official = any(s["type"] == "government" for s in res["sources"])
    if not has_official and res["provider"] != "openrouter":
        try:
            esc = search_openrouter(query)
            if any(s["type"] == "government" for s in esc["sources"]):
                esc["provider"] = "openrouter (escalated)"
                return esc
        except Exception:  # noqa: BLE001 — keep original results if escalation fails
            pass
    return res
