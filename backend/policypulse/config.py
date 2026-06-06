"""Configuration: load API keys from the project's .env.local and define shared constants.

No external dependencies — we parse .env.local ourselves so this runs on any Python 3.
"""
import os
import re
from pathlib import Path
from urllib.parse import urlparse


def _load_env_local() -> Path | None:
    """Find and parse the project's .env.local by walking up from this file."""
    here = Path(__file__).resolve()
    for parent in [here.parent, *here.parents]:
        candidate = parent / ".env.local"
        if candidate.exists():
            for line in candidate.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                # don't clobber a value already exported in the real environment
                os.environ.setdefault(key.strip(), val.strip())
            return candidate
    return None


ENV_FILE = _load_env_local()

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")
EXA_API_KEY = os.environ.get("EXA_API_KEY", "")

HOST = os.environ.get("POLICYPULSE_HOST", "127.0.0.1")
PORT = int(os.environ.get("POLICYPULSE_PORT", "8000"))
ALLOWED_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.environ.get(
        "POLICYPULSE_ALLOWED_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173",
    ).split(",")
    if origin.strip()
]
AUTH_TOKEN = os.environ.get("POLICYPULSE_AUTH_TOKEN", "")
RATE_LIMIT_PER_MINUTE = int(os.environ.get("POLICYPULSE_RATE_LIMIT_PER_MINUTE", "30"))
MEMORY_PATH = os.environ.get("POLICYPULSE_MEMORY_PATH", ".policypulse-memory.json")
SESSION_STORE_PATH = os.environ.get("POLICYPULSE_SESSION_STORE_PATH", ".policy-pulse-store.json")

# LLM model (any OpenRouter model id). Override via env or .env.local:
#   POLICYPULSE_MODEL=openai/gpt-4o-mini   (or OPENROUTER_MODEL=...)
DEFAULT_MODEL = (
    os.environ.get("POLICYPULSE_MODEL")
    or os.environ.get("OPENROUTER_MODEL")
    or "mistralai/mistral-nemo"
)

OFFICIAL_HOSTS = {
    "europa.eu",
    "bamf.de",
    "daad.de",
    "make-it-in-germany.com",
    "berlin.de",
    "bund.de",
    "auswaertiges-amt.de",
    "diplo.de",
    "germany.info",
    "studierendenwerke.de",
}


def _host_matches(host: str, domain: str) -> bool:
    return host == domain or host.endswith(f".{domain}")


def is_official(url: str) -> bool:
    """True if the URL hostname is an official / government / academic source."""
    try:
        host = urlparse(url or "").hostname or ""
    except Exception:
        return False
    host = host.lower()
    return (
        host.endswith(".gov")
        or bool(re.search(r"(^|\.)gov\.[a-z]{2}$", host))
        or _host_matches(host, "gc.ca")
        or _host_matches(host, "govt.nz")
        or bool(re.search(r"(^|\.)go\.[a-z]{2}$", host))
        or host.endswith(".edu")
        or bool(re.search(r"(^|\.)ac\.[a-z]{2}$", host))
        or any(_host_matches(host, domain) for domain in OFFICIAL_HOSTS)
    )


def provider_readiness() -> dict:
    """Redacted provider/key readiness for health and governance output."""
    return {
        "openrouter": bool(OPENROUTER_API_KEY),
        "tavily": bool(TAVILY_API_KEY),
        "exa": bool(EXA_API_KEY),
    }


def is_ready() -> bool:
    providers = provider_readiness()
    return providers["openrouter"] and any(providers.values())
