import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const STORE_PATH = path.resolve(".policy-pulse-store.json");
const COOKIE_NAME = "pp_session";
const MAX_BODY_BYTES = 1_000_000; // 1 MB cap to avoid memory/disk exhaustion
const ALLOWED_ORIGINS = new Set(
  (process.env.POLICYPULSE_DEV_ORIGINS || "http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map(origin => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean)
);

// Reject cross-site requests so a visited webpage cannot drive the dev proxies.
// Same-origin requests either omit Origin (navigations/GET) or send our own host.
const isAllowedOrigin = req => {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === req.headers.host || ALLOWED_ORIGINS.has(parsed.origin);
  } catch {
    return false;
  }
};

const forbidden = res => {
  res.statusCode = 403;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: "Forbidden origin" }));
};

const readBody = req => new Promise((resolve, reject) => {
  let body = "";
  let size = 0;
  req.on("data", chunk => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      req.destroy();
      reject(new Error("Request body too large"));
      return;
    }
    body += chunk;
  });
  req.on("end", () => resolve(body));
  req.on("error", reject);
});

// Serialize store access so concurrent read-modify-write requests cannot
// interleave into a lost update or a corrupted JSON file.
let storeLock = Promise.resolve();
const withStoreLock = task => {
  const run = storeLock.then(task, task);
  storeLock = run.then(() => {}, () => {});
  return run;
};

const readStore = async () => {
  try {
    return JSON.parse(await fs.readFile(STORE_PATH, "utf8"));
  } catch {
    return { sessions: {} };
  }
};

const writeStore = store => fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2));

const parseCookies = req => Object.fromEntries(
  (req.headers.cookie || "")
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const index = part.indexOf("=");
      return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
    })
);

const getSession = (req, res) => {
  const cookies = parseCookies(req);
  const sessionId = cookies[COOKIE_NAME] || randomUUID();
  if (!cookies[COOKIE_NAME]) {
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`);
  }
  return sessionId;
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "openrouter-proxy",
        configureServer(server) {
          server.middlewares.use("/api/session-state", async (req, res) => {
            if (!isAllowedOrigin(req)) return forbidden(res);
            const sessionId = getSession(req, res);

            const upsert = mutate => withStoreLock(async () => {
              const store = await readStore();
              const session = store.sessions[sessionId] || {
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                state: null,
              };
              mutate(session);
              session.updatedAt = new Date().toISOString();
              store.sessions[sessionId] = session;
              await writeStore(store);
              return session.state;
            });

            if (req.method === "GET") {
              const state = await upsert(() => {});
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ sessionId, state }));
              return;
            }

            if (req.method === "POST") {
              let payload;
              try {
                payload = JSON.parse(await readBody(req));
              } catch {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "Invalid session state payload" }));
                return;
              }
              await upsert(session => { session.state = payload; });
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, sessionId }));
              return;
            }

            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Method not allowed" }));
          });

          server.middlewares.use("/api/openrouter", async (req, res) => {
            if (!isAllowedOrigin(req)) return forbidden(res);
            if (req.method !== "POST") {
              res.statusCode = 405;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Method not allowed" }));
              return;
            }

            const apiKey = process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY;
            if (!apiKey) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "OPENROUTER_API_KEY is not configured on the dev server" }));
              return;
            }

            try {
              const body = await readBody(req);
              const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${apiKey}`,
                  "X-Title": "PolicyPulse",
                },
                body,
              });

              const text = await upstream.text();
              res.statusCode = upstream.status;
              res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
              res.end(text);
            } catch (error) {
              server.config.logger.error(error);
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "OpenRouter proxy request failed" }));
            }
          });

          server.middlewares.use("/api/tavily", async (req, res) => {
            if (!isAllowedOrigin(req)) return forbidden(res);
            if (req.method !== "POST") {
              res.statusCode = 405;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Method not allowed" }));
              return;
            }

            const apiKey = process.env.TAVILY_API_KEY || env.TAVILY_API_KEY;
            if (!apiKey) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "TAVILY_API_KEY is not configured on the dev server" }));
              return;
            }

            try {
              const body = await readBody(req);
              const upstream = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${apiKey}`,
                },
                body,
              });

              const text = await upstream.text();
              res.statusCode = upstream.status;
              res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
              res.end(text);
            } catch (error) {
              server.config.logger.error(error);
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Tavily proxy request failed" }));
            }
          });

          server.middlewares.use("/api/exa", async (req, res) => {
            if (!isAllowedOrigin(req)) return forbidden(res);
            if (req.method !== "POST") {
              res.statusCode = 405;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Method not allowed" }));
              return;
            }

            const apiKey = process.env.EXA_API_KEY || env.EXA_API_KEY;
            if (!apiKey) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "EXA_API_KEY is not configured on the dev server" }));
              return;
            }

            try {
              const body = await readBody(req);
              const upstream = await fetch("https://api.exa.ai/search", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": apiKey,
                },
                body,
              });

              const text = await upstream.text();
              res.statusCode = upstream.status;
              res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
              res.end(text);
            } catch (error) {
              server.config.logger.error(error);
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Exa proxy request failed" }));
            }
          });

          // Forward /api/run to the local Python backend (policypulse.server on :8000),
          // so the web UI's "Python backend" engine works through the same /api origin.
          server.middlewares.use("/api/run", async (req, res) => {
            if (!isAllowedOrigin(req)) return forbidden(res);
            if (req.method !== "POST") {
              res.statusCode = 405;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Method not allowed" }));
              return;
            }

            const port = process.env.POLICYPULSE_PORT || env.POLICYPULSE_PORT || "8000";
            try {
              const body = await readBody(req);
              const upstream = await fetch(`http://127.0.0.1:${port}/run`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
              });
              const text = await upstream.text();
              res.statusCode = upstream.status;
              res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
              res.end(text);
            } catch (error) {
              server.config.logger.error(error);
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: `Python backend not reachable on :${port} — start it with: cd backend && python3 -m policypulse.server` }));
            }
          });
        },
      },
    ],
  };
});
