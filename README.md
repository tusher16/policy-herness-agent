# PolicyPulse

An AI agent harness that monitors policy changes and generates structured alerts. Enter a topic (e.g. "German student visa work rules"), and the agent runs an **Observe → Reason → Act** loop — searching official sources, reasoning over what changed, and producing a cited alert with confidence score.

**Live demo:** [policy.tusher16.com](https://policy.tusher16.com)

---

## How it works

PolicyPulse has two independent execution engines that produce the same output:

| Engine | Where it runs | Good for |
|--------|--------------|----------|
| **Browser (JS)** | In your browser tab | Local dev, no backend needed |
| **Python backend** | `backend/policypulse/server.py` | Self-hosting, production |

The Browser engine calls OpenRouter / Tavily / Exa through the Vite dev proxy (which injects your API keys server-side — keys never leave your machine). The Python engine runs the full pipeline server-side; the browser just sends a topic and receives the final alert.

### Agent pipeline

```
Input → Context → Observe (web search) → Reason (LLM) → Act (alert) → Memory
```

Memory persists across runs so the agent can tell you **what changed since last time**.

---

## Prerequisites

- **Node.js ≥ 20** and **npm**
- **Python 3.11+** (stdlib only — no pip install needed)
- API keys:
  - [OpenRouter](https://openrouter.ai) — LLM calls (default model: `mistralai/mistral-nemo`, ~$0.0001/run)
  - [Tavily](https://tavily.com) — AI web search (primary)
  - [Exa](https://exa.ai) — neural search (optional fallback)

---

## Quick start (local dev)

```bash
# 1. Clone
git clone https://github.com/tusher16/policy-herness-agent.git
cd policy-herness-agent

# 2. Install JS dependencies
npm install

# 3. Set up API keys
cp .env.example .env.local
# Edit .env.local and fill in OPENROUTER_API_KEY and TAVILY_API_KEY

# 4. Start the dev server
npm run dev
# Open http://127.0.0.1:5173
```

The dev server proxies `/api/openrouter`, `/api/tavily`, and `/api/exa` — your keys stay on the server, never exposed to the browser.

### Running the Python backend locally (optional)

If you want to use the **Python (backend)** engine mode:

```bash
# In a second terminal:
PYTHONPATH=backend python3 -m policypulse.server
# Serves on http://127.0.0.1:8000
```

Then in the web UI, set the **Engine** dropdown to **Python (backend)** and click **Run Agent**.

### CLI usage (no browser needed)

```bash
# Run the full agent pipeline in the terminal:
cd backend
python3 -m policypulse.run_agent "UK Skilled Worker visa minimum salary 2026" tavily

# Test search only:
python3 -m policypulse.demo_search "German student visa work rules" tavily
```

---

## Project structure

```
policy-herness-agent/
├── src/
│   └── main.jsx                    # React entry point
├── PolicyPulseExperimental.jsx     # Main UI + Browser (JS) agent engine
├── vite.config.js                  # Dev server + API key proxies
├── index.html
│
├── backend/
│   └── policypulse/
│       ├── config.py               # API keys, model, official-domain detector
│       ├── http_util.py            # Minimal JSON-over-HTTP helper (stdlib urllib)
│       ├── prompts.py              # LLM system prompts
│       ├── search.py               # Tavily / Exa / LLM search + fallback
│       ├── llm.py                  # LLM call + schema validation + retries
│       ├── governance.py           # Guardrail checks (topic validation etc.)
│       ├── diff.py                 # "What changed since last run" logic
│       ├── memory.py               # Persistent memory store (JSON file)
│       ├── pipeline.py             # Observe → Reason → Act loop
│       ├── server.py               # stdlib HTTP server (/api/health /api/run)
│       └── run_agent.py            # CLI entry point
│   └── test_policypulse.py        # Python regression tests
│
├── k8s/                            # Kubernetes manifests (K3s / any cluster)
│   ├── namespace.yaml              # ResourceQuota for apps namespace
│   ├── pvc.yaml                    # 500Mi persistent volume for memory files
│   ├── backend.yaml                # Python backend Deployment + Service
│   ├── frontend.yaml               # nginx frontend Deployment + Service
│   ├── ingress.yaml                # Traefik Ingress + cert-manager TLS
│   └── secret.yaml                 # Template only — gitignored, apply via CLI
│
├── Dockerfile                      # Python backend image
├── Dockerfile.frontend             # Multi-stage: Node build → nginx serve
├── nginx.conf                      # SPA serving + /api/ proxy to backend
├── .env.example                    # Environment variable reference
└── .github/workflows/ci.yml        # CI/CD: test → build → deploy
```

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | ✅ | LLM calls via OpenRouter |
| `TAVILY_API_KEY` | ✅ | Web search (primary) |
| `EXA_API_KEY` | Optional | Neural search (fallback) |
| `POLICYPULSE_MODEL` | Optional | Any OpenRouter model ID (default: `mistralai/mistral-nemo`) |
| `POLICYPULSE_HOST` | Optional | Backend bind host (default: `127.0.0.1`, use `0.0.0.0` for containers) |
| `POLICYPULSE_PORT` | Optional | Backend port (default: `8000`) |
| `POLICYPULSE_ALLOWED_ORIGINS` | Optional | CORS origins for the backend |
| `POLICYPULSE_AUTH_TOKEN` | Optional | Bearer token for `/api/run` — empty = no auth |
| `POLICYPULSE_MEMORY_PATH` | Optional | Path to memory JSON file |
| `POLICYPULSE_SESSION_STORE_PATH` | Optional | Path to session store JSON file |

---

## Switching models

Any [OpenRouter model ID](https://openrouter.ai/models) works:

```bash
# Via env var:
POLICYPULSE_MODEL=openai/gpt-4o-mini python3 -m policypulse.run_agent "your topic"

# Via web UI:
# Settings tab → Model field
```

---

## Running tests

```bash
npm test
# Runs Python regression tests via unittest discover
```

```bash
npm run build
# Verifies the React build succeeds (no JS test runner)
```

---

## Self-hosting with Docker

```bash
# Build images
docker build -t policypulse-backend .
docker build -f Dockerfile.frontend -t policypulse-frontend .

# Run backend
docker run -d \
  -e OPENROUTER_API_KEY=your_key \
  -e TAVILY_API_KEY=your_key \
  -e POLICYPULSE_HOST=0.0.0.0 \
  -v policypulse-data:/data \
  -p 8000:8000 \
  policypulse-backend

# Run frontend (proxies /api/ to backend)
docker run -d \
  -p 80:80 \
  policypulse-frontend
```

---

## Self-hosting on Kubernetes (K3s)

### 1. Create the secret (never commit real keys)

```bash
kubectl create secret generic policypulse-secrets -n apps \
  --from-literal=OPENROUTER_API_KEY=your_key \
  --from-literal=TAVILY_API_KEY=your_key \
  --from-literal=EXA_API_KEY=your_key \
  --from-literal=POLICYPULSE_AUTH_TOKEN=""
```

### 2. Apply manifests

```bash
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/frontend.yaml
kubectl apply -f k8s/ingress.yaml
```

### 3. Verify

```bash
kubectl get pods -n apps | grep policypulse
kubectl get certificate policypulse-tls -n apps
```

The ingress uses **cert-manager dns01** (not http01) for TLS — required if your domain is behind Cloudflare's orange-cloud proxy.

> **Note:** `k8s/secret.yaml` is gitignored and contains only placeholder values. Always create secrets via `kubectl create secret` CLI, never commit real keys.

---

## CI/CD (GitHub Actions)

The workflow in `.github/workflows/ci.yml` runs on every push to `main`:

1. **Test** — `npm ci && npm run build && npm test`
2. **Build & push** — builds `backend` and `frontend` Docker images, pushes to `ghcr.io`
3. **Deploy** — SSHes into the server and runs `kubectl rollout restart`

### Required GitHub secrets

| Secret | Value |
|--------|-------|
| `SERVER_HOST` | Your server hostname or IP |
| `SSH_PORT` | SSH port (default: 22) |
| `SSH_KEY` | Private SSH key for the server (`cat ~/.ssh/id_ed25519`) |

Images are pushed to `ghcr.io/<your-github-username>/policy-herness-agent:backend` and `:frontend`. When the repo is public these packages are public too — no `imagePullSecret` needed in the cluster.

---

## Architecture notes

- **No pip install** — the Python backend uses stdlib only (`urllib`, `http.server`, `threading`, `json`). Works on any Python 3.11+ install with zero setup.
- **Memory** persists as a plain JSON file. In Docker/K3s this is stored on a PVC so it survives restarts.
- **Browser (JS) engine** requires the Vite dev server proxies to inject API keys. It does **not** work in the production nginx build (use Python backend mode in production).
- **Python backend engine** is the correct mode for the Docker/K3s deployment — API keys live in environment variables, never in the browser.
- **Concurrent safety** — the Python server uses a `threading.Lock` around memory file reads/writes, and request bodies are capped at 1 MB.
