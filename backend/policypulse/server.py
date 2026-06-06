"""Stdlib HTTP server exposing PolicyPulse APIs for local dev and deployment.

Run from the project root with:

    PYTHONPATH=backend python3 -m policypulse.server

Endpoints are available both at legacy paths (`/run`) and production API paths (`/api/run`).
"""
import json
import threading
import time
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from . import config
from .governance import check_topic
from .http_util import post_raw
from .memory import Memory
from .pipeline import run_agent
from .search import PROVIDERS, search_with_source_policy

MAX_BODY_BYTES = 1_000_000
COOKIE_NAME = "pp_session"
_memory_lock = threading.Lock()
_session_lock = threading.Lock()
_rate_lock = threading.Lock()
_rate_windows: dict[str, list[float]] = {}


class BadRequest(Exception):
    pass


class PayloadTooLarge(Exception):
    pass


def _is_allowed_origin(origin: str) -> bool:
    if not origin:
        return True
    normalized = origin.rstrip("/")
    if "*" in config.ALLOWED_ORIGINS:
        return True
    return normalized in config.ALLOWED_ORIGINS


def _client_ip(handler: BaseHTTPRequestHandler) -> str:
    forwarded = handler.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return handler.client_address[0] if handler.client_address else "unknown"


def _rate_limited(handler: BaseHTTPRequestHandler) -> bool:
    limit = config.RATE_LIMIT_PER_MINUTE
    if limit <= 0:
        return False
    now = time.time()
    cutoff = now - 60
    key = _client_ip(handler)
    with _rate_lock:
        window = [ts for ts in _rate_windows.get(key, []) if ts >= cutoff]
        if len(window) >= limit:
            _rate_windows[key] = window
            return True
        window.append(now)
        _rate_windows[key] = window
    return False


def _read_json_file(path: Path, fallback: dict) -> dict:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return fallback
    except json.JSONDecodeError as e:
        raise RuntimeError(f"JSON store is corrupt: {path}") from e


def _write_json_file(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    tmp.replace(path)


class Handler(BaseHTTPRequestHandler):
    def _cors(self, origin: str) -> None:
        if origin and _is_allowed_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin.rstrip("/"))
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-PolicyPulse-Token")

    def _send_json(self, status: int, payload: dict, origin: str = "", headers: dict | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._cors(origin)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_raw(self, status: int, body: bytes, content_type: str, origin: str = "") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type or "application/json")
        self._cors(origin)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status: int, message: str, origin: str = "") -> None:
        self._send_json(status, {"error": message}, origin)

    def _path(self) -> str:
        return urlparse(self.path).path

    def _read_body(self) -> bytes:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError as e:
            raise BadRequest("invalid Content-Length") from e
        if length < 0:
            raise BadRequest("invalid Content-Length")
        if length > MAX_BODY_BYTES:
            raise PayloadTooLarge("request body too large")
        return self.rfile.read(length) if length else b""

    def _read_json(self) -> dict:
        raw = self._read_body()
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError as e:
            raise BadRequest("invalid JSON payload") from e

    def _authorized(self) -> bool:
        if not config.AUTH_TOKEN:
            return True
        bearer = self.headers.get("Authorization", "")
        token = self.headers.get("X-PolicyPulse-Token", "")
        return bearer == f"Bearer {config.AUTH_TOKEN}" or token == config.AUTH_TOKEN

    def _guard_origin(self, origin: str) -> bool:
        if _is_allowed_origin(origin):
            return True
        self._send_error(403, "Forbidden origin", origin)
        return False

    def _guard_cost_endpoint(self, origin: str) -> bool:
        if not self._authorized():
            self._send_error(401, "Unauthorized", origin)
            return False
        if _rate_limited(self):
            self._send_error(429, "Rate limit exceeded", origin)
            return False
        return True

    def _session_id(self) -> tuple[str, dict]:
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        morsel = cookie.get(COOKIE_NAME)
        if morsel and morsel.value:
            return morsel.value, {}
        session_id = str(uuid4())
        return session_id, {
            "Set-Cookie": (
                f"{COOKIE_NAME}={session_id}; Path=/; Max-Age=2592000; "
                "HttpOnly; SameSite=Lax"
            )
        }

    def _handle_session_get(self, origin: str) -> None:
        session_id, headers = self._session_id()
        path = Path(config.SESSION_STORE_PATH)
        with _session_lock:
            store = _read_json_file(path, {"sessions": {}})
            session = store["sessions"].setdefault(session_id, {
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "state": None,
            })
            session["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            _write_json_file(path, store)
        self._send_json(200, {"sessionId": session_id, "state": session.get("state")}, origin, headers)

    def _handle_session_post(self, origin: str) -> None:
        payload = self._read_json()
        session_id, headers = self._session_id()
        path = Path(config.SESSION_STORE_PATH)
        with _session_lock:
            store = _read_json_file(path, {"sessions": {}})
            session = store["sessions"].setdefault(session_id, {
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "state": None,
            })
            session["state"] = payload
            session["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            _write_json_file(path, store)
        self._send_json(200, {"ok": True, "sessionId": session_id}, origin, headers)

    def _handle_health(self, origin: str) -> None:
        providers = config.provider_readiness()
        payload = {
            "ok": config.is_ready(),
            "env": str(config.ENV_FILE),
            "model": config.DEFAULT_MODEL,
            "providers": providers,
            "auth_required": bool(config.AUTH_TOKEN),
            "allowed_origins": config.ALLOWED_ORIGINS,
        }
        self._send_json(200 if payload["ok"] else 503, payload, origin)

    def _handle_search_or_run(self, origin: str) -> None:
        if not self._guard_cost_endpoint(origin):
            return
        body = self._read_json()
        topic = (body.get("topic") or "").strip()
        provider = body.get("provider") or "tavily"
        if provider not in PROVIDERS:
            return self._send_error(400, f"unknown provider: {provider}", origin)
        if not topic:
            return self._send_error(400, "missing 'topic'", origin)
        guardrail = check_topic(topic)
        if not guardrail["ok"]:
            return self._send_error(400, f"Input guardrail failed: {guardrail['detail']}", origin)

        if self._path() in {"/search", "/api/search"}:
            return self._send_json(200, search_with_source_policy(topic, provider), origin)

        with _memory_lock:
            mem = Memory(config.MEMORY_PATH)
            result = run_agent(topic, provider, memory=mem, log=lambda *_: None)
        self._send_json(200, result, origin)

    def _proxy(self, origin: str, upstream_url: str, headers: dict) -> None:
        if not self._guard_cost_endpoint(origin):
            return
        raw = self._read_body()
        status, body, content_type = post_raw(upstream_url, headers, raw)
        self._send_raw(status, body, content_type, origin)

    def do_OPTIONS(self) -> None:
        origin = self.headers.get("Origin", "")
        if not self._guard_origin(origin):
            return
        self.send_response(204)
        self._cors(origin)
        self.end_headers()

    def do_GET(self) -> None:
        origin = self.headers.get("Origin", "")
        if not self._guard_origin(origin):
            return
        try:
            path = self._path()
            if path in {"/health", "/api/health"}:
                return self._handle_health(origin)
            if path == "/api/session-state":
                return self._handle_session_get(origin)
            self._send_error(404, "not found", origin)
        except Exception as e:  # noqa: BLE001
            print(f"GET {self.path} failed: {e}")
            self._send_error(500, "internal server error", origin)

    def do_POST(self) -> None:
        origin = self.headers.get("Origin", "")
        if not self._guard_origin(origin):
            return
        try:
            path = self._path()
            if path == "/api/session-state":
                return self._handle_session_post(origin)
            if path in {"/search", "/api/search", "/run", "/api/run"}:
                return self._handle_search_or_run(origin)
            if path == "/api/openrouter":
                if not config.OPENROUTER_API_KEY:
                    return self._send_error(500, "OPENROUTER_API_KEY is not configured", origin)
                return self._proxy(origin, "https://openrouter.ai/api/v1/chat/completions", {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {config.OPENROUTER_API_KEY}",
                    "X-Title": "PolicyPulse",
                })
            if path == "/api/tavily":
                if not config.TAVILY_API_KEY:
                    return self._send_error(500, "TAVILY_API_KEY is not configured", origin)
                return self._proxy(origin, "https://api.tavily.com/search", {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {config.TAVILY_API_KEY}",
                })
            if path == "/api/exa":
                if not config.EXA_API_KEY:
                    return self._send_error(500, "EXA_API_KEY is not configured", origin)
                return self._proxy(origin, "https://api.exa.ai/search", {
                    "Content-Type": "application/json",
                    "x-api-key": config.EXA_API_KEY,
                })
            self._send_error(404, "not found", origin)
        except PayloadTooLarge as e:
            self._send_error(413, str(e), origin)
        except BadRequest as e:
            self._send_error(400, str(e), origin)
        except ValueError as e:
            self._send_error(400, str(e), origin)
        except Exception as e:  # noqa: BLE001
            print(f"POST {self.path} failed: {e}")
            self._send_error(502, "backend request failed", origin)

    def log_message(self, *args) -> None:
        pass


def main() -> None:
    print(
        f"PolicyPulse backend on http://{config.HOST}:{config.PORT} "
        f"(env: {config.ENV_FILE}, ready: {config.is_ready()})"
    )
    ThreadingHTTPServer((config.HOST, config.PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
