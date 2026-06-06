# PolicyPulse — Python backend (agent core)

A readable, **standard-library-only** Python port of the agent logic from
`PolicyPulseExperimental.jsx`. It can run independently from the command line or as the optional
**Python backend** engine in the React UI.

## Requirements

Python 3.10+ (uses `X | None` type hints). **No pip installs needed** — stdlib only.
API keys are read automatically from the project's `.env.local`.

Default model: `mistralai/mistral-nemo` via OpenRouter. Override it with `POLICYPULSE_MODEL` or
`OPENROUTER_MODEL`.

## Run the Part 1 search demo

```bash
cd backend
python3 -m policypulse.demo_search "UK Skilled Worker visa minimum salary 2026" tavily
```

Second arg is the provider: `tavily` (default), `exa`, or `openrouter` (LLM web search).

The demo exercises:
- the chosen search provider,
- automatic fallback to other providers on error/empty,
- **source-policy self-heal**: if no official `.gov` sources come back, it escalates to the LLM
  web search and uses those if better.

The official-source detector also recognizes project-relevant German official/institutional
domains such as `make-it-in-germany`, `berlin.de`, `bund.de`, `auswaertiges-amt.de`, `diplo.de`,
`germany.info`, and `studierendenwerke.de`.

## Run with a different LLM

All LLM calls go through OpenRouter, so any OpenRouter model id works — just set an env var
(or add it to `.env.local`):

```bash
POLICYPULSE_MODEL=openai/gpt-4o-mini  python3 -m policypulse.run_agent "UK Skilled Worker visa 2026"
POLICYPULSE_MODEL=anthropic/claude-3.5-sonnet  python3 -m policypulse.run_agent "..." tavily
```

`config.DEFAULT_MODEL` resolves `POLICYPULSE_MODEL` → `OPENROUTER_MODEL` → the Mistral Nemo default.
Use **tavily** or **exa** as the search provider when switching models — the "openrouter" (LLM web
search) provider needs a model that supports OpenRouter's `web_search` tool.

Avoid `:free` models for the default path when demoing; OpenRouter free-model quota can be exhausted
quickly. `mistralai/mistral-nemo` was tested as a cheap paid JSON-capable default.

## Run the full agent / HTTP server

```bash
PYTHONPATH=backend python3 -m policypulse.run_agent "Germany EU Blue Card minimum salary 2026" tavily
PYTHONPATH=backend python3 -m policypulse.server                                      # http://127.0.0.1:8000
```

HTTP endpoints:

- `GET /api/health` returns backend health, env path, active model, provider readiness, auth status, and allowed origins.
- `POST /api/search` accepts `{topic, provider}` and returns normalized sources.
- `POST /api/run` accepts `{topic, provider}` and returns the full alert, reasoning, governance checks,
  checkpoints, loop count, save status, and active model.

Legacy `/health`, `/search`, and `/run` paths are still accepted. The server accepts exact origins
from `POLICYPULSE_ALLOWED_ORIGINS` and rejects foreign origins. Network calls keep TLS verification
enabled; `http_util.py` uses the system CA bundle when Python cannot locate certificates by default.
Request bodies over 1 MB are rejected before JSON parsing. Set `POLICYPULSE_HOST=0.0.0.0` for
containers, and set `POLICYPULSE_AUTH_TOKEN` if ingress or clients should provide an auth header.

`/api/run` uses a `threading.Lock` around memory-file read/modify/save. Concurrent local runs queue
instead of corrupting `.policypulse-memory.json`, which is the right tradeoff while this backend
uses a single JSON file rather than SQLite.

## Web UI behavior

In the app, select **Engine: Python backend** and click RUN AGENT. The frontend sends one `/api/run`
request and renders the returned result. Because the backend is request/response rather than
streamed, the browser shows a sequential harness projection instead of true live backend sub-steps:
Context → Observe while `/api/run` is active → Reason → Act after the backend returns. The trace table
shows the real model, currently `mistralai/mistral-nemo`, and the selected search provider.

The prompt card is frontend-only: clicking the small prompt textarea opens a larger modal editor
with the app blurred behind it. DONE saves the draft into the prompt; CANCEL, outside click, and
Escape close without saving. This applies equally to Browser (JS) and Python backend modes.

## Status

See `../PYTHON_PORT.md` for the full part-by-part plan. Parts 1–4 are implemented:
search, LLM/validation, memory/pipeline, and the stdlib HTTP server.

Verified on 2026-06-03: JS build passes, Python compileall passes, browser and Python engines
complete end-to-end with Tavily + Mistral Nemo, oversized Python request bodies return HTTP 400,
malicious prompts are blocked before network calls, and the prompt modal/output-panel/harness-memory
layout fixes render correctly in the web UI.

Known minor: `diff_alerts` collapses `key_numbers` that reuse the same `label`. This mirrors the JS
behavior and is intentionally left alone unless it shows up in real output.
