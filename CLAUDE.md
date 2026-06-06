# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## PolicyPulse Project Facts

- Live frontend entry: `src/main.jsx` renders `PolicyPulseExperimental.jsx`.
- Vite dev server still hosts local API proxies in `vite.config.js`, but production-equivalent
  `/api/*` endpoints now live in `backend/policypulse/server.py`; browser code must not receive API keys.
- Default LLM model: `mistralai/mistral-nemo` via OpenRouter (a cheap paid model, chosen to avoid the `:free` daily quota). Override with `POLICYPULSE_MODEL` (Python/env) or the Settings tab (web app) — any OpenRouter model id.
- Engine modes:
  - **Browser (JS)** runs the full Observe → Reason → Act loop in `PolicyPulseExperimental.jsx`.
  - **Python backend** calls `backend/policypulse/server.py` through the configured API base
    (`VITE_POLICY_PULSE_API_BASE`, default `/api`).
- Python mode is request/response, not streamed. The UI shows a sequential harness projection, but true live backend sub-steps would require SSE/WebSockets.
- Prompt editing UX: the small prompt textarea opens a larger `PromptModal`; the app shell blurs
  behind it. Keep modal state separate from the saved `topic` until DONE is clicked.
- Current harness UI layout: Memory belongs in the center column under Context → Observe → Reason
  → Act, and the Output tab should grow with content instead of using a nested fixed-height scroller.
- Input guardrails should halt before search/LLM calls in both JS and Python.
- Source-policy logic should prefer current official/institutional sources and avoid replacing good Tavily results with stale LLM web-search snippets.
- Python port of the agent lives in `backend/policypulse/` (`search · llm · governance · diff · memory · pipeline · server`); see `PYTHON_PORT.md`.
- Python `/api/run` uses a `threading.Lock` around the single JSON memory file, request bodies are
  capped at 1 MB, and host/port/origins/state paths are environment-configurable.

## Commands

```bash
OPENROUTER_API_KEY=... TAVILY_API_KEY=... npm run dev   # web app (Vite) on http://127.0.0.1:5173
PYTHONPATH=backend python3 -m policypulse.server         # Python backend on :8000 (stdlib only)
npm run build                                           # production frontend build
npm test                                                # focused Python regression tests
cd backend && python3 -m policypulse.run_agent "<topic>" tavily   # full agent in the terminal
cp .env.example .env.local                              # then fill OPENROUTER_API_KEY / TAVILY_API_KEY / EXA_API_KEY
```

No JS test runner; verify the frontend with `npm run build`. Python is stdlib-only (no pip install).

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
