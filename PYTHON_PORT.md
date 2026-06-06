# PolicyPulse — Python port of the agent logic

Goal: move the **agent's core logic** out of the browser (JS) into a clean, readable **Python**
package, so it's easier to understand and write about. The **JS frontend stays as-is**; Python
becomes the "brain". Done **part by part** so nothing breaks.

## Why this is safe

The browser engine still runs the full agent logic in `PolicyPulseExperimental.jsx`. The Python
port is a **separate, additive** package under `backend/` that also runs independently from the
command line. Building it **does not touch or break the working JS app**. Part 4 connects the React
UI through the prompt-card **Engine** dropdown, so both engines can be tested side by side.

## Key architecture difference (browser vs server)

- **Browser (JS):** can't hold secret API keys, so search/LLM calls go through Vite dev proxies
  (`/api/tavily`, `/api/openrouter`, …) that inject the key server-side.
- **Python (server):** *is* the server. The key lives here, so Python calls the search/LLM APIs
  **directly** — no proxy needed. (Good thing to explain in the blog.)

## Module map (Python mirrors the JS concepts)

| Python file | Mirrors in JS | Responsibility |
|---|---|---|
| `policypulse/config.py` | env + `is_official` | API keys, model, official-domain detector |
| `policypulse/http_util.py` | `fetch` | tiny JSON-over-HTTP helper (stdlib `urllib`) |
| `policypulse/prompts.py` | `SYS_RSN`, `SYS_ACT` | system prompts |
| `policypulse/search.py` | `runSearch`, providers | Tavily/Exa/LLM search + fallback + escalation |
| `policypulse/llm.py` *(Part 2)* | `callJSON` | LLM call + schema validation + retries |
| `policypulse/governance.py` *(Part 2)* | `governanceChecks` | live guardrail checks |
| `policypulse/diff.py` *(Part 2)* | `diffAlerts` | "what changed since last run" |
| `policypulse/memory.py` *(Part 3)* | memory + `dedupeMemory` | idempotent memory store |
| `policypulse/pipeline.py` *(Part 3)* | `runAgent` | Observe→Reason→Act ReAct loop + checkpoints |
| `policypulse/server.py` *(Part 4)* | Vite proxies | stdlib HTTP endpoint for the React UI |

## Progress

- [x] **Part 1** — scaffold, config, prompts, search providers + fallback + escalation, `demo_search` CLI
- [x] **Part 2** — `llm.call_json` (schema validation + retries), `governance`, `diff` + `demo_part2` CLI
- [x] **Part 3** — `memory` (idempotent + dedup), `pipeline` (ReAct loop + checkpoints), `run_agent` CLI
- [x] **Part 4** — stdlib HTTP `server` (`/api/health`, `/api/search`, `/api/run`) + frontend "Engine: Python backend" toggle

## Using the Python engine from the web UI

1. Start the backend:  `PYTHONPATH=backend python3 -m policypulse.server`  (serves http://127.0.0.1:8000 by default)
2. Start the web app:  `npm run dev`
3. In the prompt card, set the **Engine** dropdown to **"Python backend"**, then click RUN AGENT.

Prompt entry note: clicking the small prompt textarea opens a larger modal editor with the app
blurred behind it. **DONE** saves the draft into the prompt card; **CANCEL**, outside click, or
`Escape` closes without saving. This is frontend-only and applies to both Browser (JS) and Python
engine modes.

The browser then POSTs `{topic, provider}` to `/api/run` by default; Python runs the whole
Observe→Reason→Act pipeline server-side and returns the alert, which the React UI renders. The
existing **"Engine: Browser (JS)"** option is untouched, so both paths work.

Trace behavior: the Python path returns the final result at the end, so the browser cannot know the
exact live backend sub-step without streaming. The UI now shows a sequential projection instead of
lighting every phase at once: Context → Observe while `/api/run` is active → Reason → Act after the
backend returns. The trace table displays the real OpenRouter model returned by Python, currently
`mistralai/mistral-nemo`, and the search row displays the selected provider such as `tavily`.

Tradeoff: Python mode has no in-browser approval pause while the backend request is in flight, so
the UI blocks Python runs when an approval gate is enabled. Add SSE/WebSockets later for true live
backend trace events and interactive approval gates.

## How to run (zero dependencies — stdlib only)

```bash
cd backend
python3 -m policypulse.demo_search "UK Skilled Worker visa minimum salary 2026" tavily
```

It reads keys from the project's `.env.local` automatically.

The stdlib HTTP helper keeps TLS verification enabled and uses the system CA bundle when this
Python install cannot find certificates by default. The HTTP server accepts exact origins from
`POLICYPULSE_ALLOWED_ORIGINS` and rejects foreign origins. Request bodies over 1 MB are rejected
before JSON parsing. `/api/run` serializes memory-file read/modify/save with a `threading.Lock`, so
simultaneous local runs queue instead of corrupting `.policypulse-memory.json`. For containers, set
`POLICYPULSE_HOST=0.0.0.0`; for k3s, set durable `POLICYPULSE_MEMORY_PATH` /
`POLICYPULSE_SESSION_STORE_PATH` values and optionally `POLICYPULSE_AUTH_TOKEN`.

## Run with a different LLM

Every LLM call goes through OpenRouter, so swapping models is just a model id — set
`POLICYPULSE_MODEL` (or `OPENROUTER_MODEL`) as an env var or in `.env.local`:

```bash
POLICYPULSE_MODEL=openai/gpt-4o-mini  python3 -m policypulse.run_agent "UK Skilled Worker visa 2026"
```

Default model: `mistralai/mistral-nemo`. It replaced the previous `:free` default because the free
model path can hit OpenRouter's daily free-model quota quickly. In the web app, change the model in
the **Settings** tab instead. Use the **tavily**/**exa** search providers when switching models (the
"LLM web search" provider needs OpenRouter's `web_search` tool).

## Verified behavior

Latest verification: 2026-06-03.

- `npm run build` passes.
- `python3 -m compileall -f backend/policypulse` passes.
- Browser (JS) engine completes end-to-end with `mistralai/mistral-nemo`.
- Python backend engine completes end-to-end from the web UI.
- Prompt modal opens, blurs the app shell, saves with DONE, and cancels without saving.
- Output panel lays out without a nested fixed-height scroller; Memory aligns under the center
  harness column.
- Python `/run` full endpoint returns HTTP 200 with `mistralai/mistral-nemo`, Tavily sources, and
  current `140 full days or 280 half days` output.
- Python oversized request-body probe returns HTTP 400 before JSON parsing.
- Malicious topics are blocked before search/LLM calls in both engines.
- A German student-visa work-rules run returns the current `140 full days or 280 half days` result
  from Tavily-backed sources.

Known minor: `diffAlerts` / `diff_alerts` collapse `key_numbers` that share the same `label`. This
affects both engines and is left as a low-priority caveat unless it appears in real data.
