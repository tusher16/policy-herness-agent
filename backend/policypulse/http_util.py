"""Minimal JSON-over-HTTP helper using only the standard library (no `requests`).

Mirrors what `fetch` does in the JS app. Returns (status_code, parsed_json).
"""
import json
import ssl
import urllib.error
import urllib.request
from pathlib import Path


def _ssl_context():
    """Use the system CA bundle when this Python install cannot locate one."""
    for candidate in ("/etc/ssl/cert.pem", "/opt/homebrew/etc/openssl@3/cert.pem"):
        if Path(candidate).exists():
            return ssl.create_default_context(cafile=candidate)
    return ssl.create_default_context()


def post_raw(url: str, headers: dict | None, body: bytes, timeout: int = 120):
    """POST raw bytes; return (status, body_bytes, content_type)."""
    req = urllib.request.Request(url, data=body, method="POST")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as resp:
            return resp.status, resp.read(), resp.headers.get("content-type") or "application/json"
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get("content-type") or "application/json"


def post_json(url: str, headers: dict | None, payload: dict, timeout: int = 120):
    """POST `payload` as JSON; return (status, parsed_body)."""
    data = json.dumps(payload).encode("utf-8")
    status, raw, _content_type = post_raw(
        url,
        {"Content-Type": "application/json", **(headers or {})},
        data,
        timeout=timeout,
    )
    body = raw.decode("utf-8", "ignore")
    try:
        parsed = json.loads(body) if body else {}
    except Exception:
        parsed = {"error": body[:300]}
    return status, parsed
