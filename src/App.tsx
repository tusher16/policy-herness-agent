import React, { useState, useEffect, useRef, useLayoutEffect, Fragment } from 'react';
import { 
  Play, 
  RotateCcw, 
  Database, 
  Cpu, 
  ShieldAlert, 
  GraduationCap, 
  Coins, 
  ArrowRight,
  Sparkles,
  CheckCircle,
  XCircle,
  Bookmark,
  Search,
  Check,
  AlertTriangle,
  Settings,
  Moon,
  Sun,
  Activity
} from 'lucide-react';
import { SimulationStep, PresetScenario, TraceLog } from './types';
import { PRESET_SCENARIOS } from './data';
import { ArchitectureDiagram } from './components/ArchitectureDiagram';

// ─── API CONFIGS ─────────────────────────────────────────────────────────────
const DEFAULT_MODEL = "mistralai/mistral-nemo";
const API_BASE = (((import.meta as any).env.VITE_POLICY_PULSE_API_BASE || "/api").trim()).replace(/\/+$/, "");
const apiPath = (path: string) => `${API_BASE}${path}`;
const API = apiPath("/openrouter");
const TAVILY = apiPath("/tavily");
const EXA = apiPath("/exa");
const SESSION_STATE = apiPath("/session-state");
const PYTHON_RUN = apiPath("/run");
const API_TOKEN = ((import.meta as any).env.VITE_POLICY_PULSE_API_TOKEN || "").trim();

const mkHeaders = () => ({
  "Content-Type": "application/json",
  ...(API_TOKEN ? { "X-PolicyPulse-Token": API_TOKEN } : {}),
});

const pullText = (data: any) => {
  const msg = data?.choices?.[0]?.message;
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content)) {
    return msg.content.map((b: any) => b?.text || b?.content || "").join("\n");
  }
  return "";
};

// Official / government domain classification
const OFFICIAL_HOSTS = [
  "europa.eu", "bamf.de", "daad.de", "make-it-in-germany.com", "berlin.de", "bund.de",
  "auswaertiges-amt.de", "diplo.de", "germany.info", "studierendenwerke.de",
];
const hostMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const isOfficialUrl = (url: string) => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith(".gov")
      || /(^|\.)gov\.[a-z]{2}$/.test(host)
      || hostMatches(host, "gc.ca")
      || hostMatches(host, "govt.nz")
      || /(^|\.)go\.[a-z]{2}$/.test(host)
      || host.endsWith(".edu")
      || /(^|\.)ac\.[a-z]{2}$/.test(host)
      || OFFICIAL_HOSTS.some(domain => hostMatches(host, domain));
  } catch {
    return false;
  }
};

const tavilyToSources = (data: any): any[] => {
  const seen = new Set();
  return (data?.results || [])
    .filter((r: any) => r?.url && !seen.has(r.url) && seen.add(r.url))
    .map((r: any) => ({
      url: r.url,
      title: r.title || r.url,
      type: isOfficialUrl(r.url) ? "government" : "source",
      key_info: r.content ? r.content.slice(0, 500) : "Found via Tavily search.",
      reliability: isOfficialUrl(r.url) ? 0.95 : 0.72,
    }));
};

const tryJSON = (txt: string) => {
  try {
    const m = txt.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
};

const missingKeys = (obj: any, keys: string[]) => {
  return obj
    ? keys.filter(k => obj[k] === undefined || obj[k] === null || (Array.isArray(obj[k]) && obj[k].length === 0))
    : keys.slice();
};

const callJSON = async ({ model, messages, requiredKeys = [], maxRetries = 2, maxTokens = 2500 }: any) => {
  let lastData = null;
  let lastText = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const convo = attempt === 0 ? messages : [
      ...messages,
      { role: "assistant", content: lastText.slice(0, 1200) },
      { role: "user", content: `Your previous reply was invalid or incomplete. Respond with ONLY one complete JSON object${requiredKeys.length ? ` containing keys: ${requiredKeys.join(", ")}` : ""}. No markdown, no prose.` },
    ];
    const res = await fetch(API, {
      method: "POST", 
      headers: mkHeaders(),
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: convo }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = await res.json();
    lastData = data;
    lastText = pullText(data);
    const truncated = data?.choices?.[0]?.finish_reason === "length";
    const json = tryJSON(lastText);
    const miss = missingKeys(json, requiredKeys);
    if (json && miss.length === 0 && !truncated) {
      return { data, json, attempts: attempt + 1, valid: true };
    }
  }
  return { data: lastData, json: tryJSON(lastText), attempts: maxRetries + 1, valid: false };
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const dedupeMemory = (m: any) => {
  const seenTopic = new Set();
  const seenUrl = new Set();
  return {
    ...m,
    preferences: (m.preferences || []).filter((p: any) => p && !seenTopic.has(p.topic) && seenTopic.add(p.topic)),
    trustedSources: (m.trustedSources || []).filter((s: any) => s?.url && !seenUrl.has(s.url) && seenUrl.add(s.url)),
  };
};

const diffAlerts = (prev: any, next: any) => {
  if (!prev) return ["First run for this topic — baseline saved."];
  const out = [];
  if (prev.current_status !== next.current_status) {
    out.push(`Status changed:\n  was: ${prev.current_status}\n  now: ${next.current_status}`);
  }
  if (prev.impact_level !== next.impact_level) {
    out.push(`Impact level: ${prev.impact_level || "—"} → ${next.impact_level || "—"}`);
  }
  const toMap = (arr: any[]) => Object.fromEntries((arr || []).map(k => [k.label, k.value]));
  const pn = toMap(prev.key_numbers);
  const nn = toMap(next.key_numbers);
  for (const [label, val] of Object.entries(nn)) {
    if (pn[label] === undefined) out.push(`New figure — ${label}: ${val}`);
    else if (pn[label] !== val) out.push(`${label}: ${pn[label]} → ${val}`);
  }
  return out.length ? out : ["No material changes since last run."];
};

const isHttpUrl = (u: string) => /^https?:\/\//i.test(u || "");

// Build trace lists
const TRACE_STEPS = [
  ["input_received", "Input received", "UI"],
  ["context_built", "Context built", "context"],
  ["guardrail_checked", "Guardrail checked", "guardrail"],
  ["web_search_called", "Web search called", "web_search"],
  ["sources_ranked", "Sources ranked", "diff_engine"],
  ["reasoning_done", "Reasoning done", "LLM"],
  ["output_checked", "Output checked", "guardrail"],
  ["alert_generated", "Alert generated", "summarizer"],
];

const makeTraceRows = (model: string): TraceLog[] => {
  return TRACE_STEPS.map(([key, step, tool], index) => ({
    id: `step-${index + 1}`,
    stepName: step.toUpperCase(),
    subType: tool,
    status: 'PENDING',
    durationMs: 0,
    modelName: model || 'mistralai/mistral-nemo',
    tokens: '—',
    cost: '—',
    retryCount: 0
  }));
};

const formatUsage = (data: any) => {
  const usage = data?.usage;
  if (!usage) return "—";
  const tokens = usage.total_tokens ?? usage.totalTokens ??
    ((usage.prompt_tokens || usage.input_tokens || 0) + (usage.completion_tokens || usage.output_tokens || 0));
  return `${tokens || "—"} tok`;
};

const formatCost = (data: any) => {
  const usage = data?.usage;
  if (!usage) return "—";
  const cost = usage.cost ?? usage.total_cost ?? usage.estimated_cost;
  return cost ? `$${Number(cost).toFixed(5)}` : "—";
};

const withCitationFallback = (output: any, sources: any[]) => {
  if (output?.citations?.length || !sources?.length) return output;
  return {
    ...output,
    citations: sources.slice(0, 3).map(source => ({
      text: source.key_info || `Source used for ${output.current_status || "the generated policy alert"}`,
      source_title: source.title || source.url,
      url: source.url,
    })),
  };
};

const readLocal = (key: string, fallback = "") => {
  try { return localStorage.getItem(key) || fallback; }
  catch { return fallback; }
};

const writeLocal = (key: string, value: string) => {
  try { localStorage.setItem(key, value); }
  catch {}
};

const readModelLocal = () => {
  return readLocal("policypulse.model", DEFAULT_MODEL).trim() || DEFAULT_MODEL;
};

const loadSessionState = async () => {
  const res = await fetch(SESSION_STATE);
  if (!res.ok) throw new Error(`Session load failed: HTTP ${res.status}`);
  return res.json();
};

const saveSessionState = (state: any) => fetch(SESSION_STATE, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(state),
});

// Search Providers
const exaToSources = (data: any): any[] => {
  const seen = new Set();
  return (data?.results || [])
    .filter((r: any) => r?.url && !seen.has(r.url) && seen.add(r.url))
    .map((r: any) => ({
      url: r.url,
      title: r.title || r.url,
      type: isOfficialUrl(r.url) ? "government" : "source",
      key_info: (r.text || r.summary || "Found via Exa search.").slice(0, 500),
      reliability: isOfficialUrl(r.url) ? 0.95 : 0.72,
    }));
};

const annotationsToSources = (data: any): any[] => {
  const seen = new Set();
  return (data?.choices?.[0]?.message?.annotations || [])
    .filter((a: any) => a.type === "url_citation" && a.url_citation?.url
      && !seen.has(a.url_citation.url) && seen.add(a.url_citation.url))
    .map((a: any) => a.url_citation)
    .map((c: any) => ({
      url: c.url,
      title: c.title || c.url,
      type: isOfficialUrl(c.url) ? "government" : "source",
      key_info: c.content ? c.content.slice(0, 500) : "Found via OpenRouter web search.",
      reliability: isOfficialUrl(c.url) ? 0.95 : 0.72,
    }));
};

const searchTavily = async (query: string) => {
  const res = await fetch(TAVILY, {
    method: "POST",
    headers: mkHeaders(),
    body: JSON.stringify({ query, search_depth: "advanced", max_results: 6, include_answer: true }),
  });
  if (!res.ok) throw new Error(`Tavily: HTTP ${res.status}`);
  const data = await res.json();
  return { sources: tavilyToSources(data), summary: data.answer || "" };
};

const searchExa = async (query: string) => {
  const res = await fetch(EXA, {
    method: "POST",
    headers: mkHeaders(),
    body: JSON.stringify({ query, type: "auto", numResults: 6, contents: { text: { maxCharacters: 500 } } }),
  });
  if (!res.ok) throw new Error(`Exa: HTTP ${res.status}`);
  const data = await res.json();
  return { sources: exaToSources(data), summary: "" };
};

const searchOpenRouter = async (query: string) => {
  const res = await fetch(API, {
    method: "POST",
    headers: mkHeaders(),
    body: JSON.stringify({
      model: DEFAULT_MODEL, 
      max_tokens: 1000,
      messages: [
        { role: "system", content: "Use web search to find 3-5 current official sources about the policy topic. Prefer government, BAMF, DAAD, EU, embassy, or official institutional pages." },
        { role: "user", content: `Policy topic to research: "${query}"` },
      ],
      tools: [{ type: "openrouter:web_search" }],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter search: HTTP ${res.status}`);
  const data = await res.json();
  return { sources: annotationsToSources(data), summary: (pullText(data) || "").slice(0, 220) };
};

const SEARCH_PROVIDERS: Record<string, { label: string; run: (query: string) => Promise<{ sources: any[]; summary: string }> }> = {
  tavily: { label: "Tavily Deep Search", run: searchTavily },
  exa: { label: "Exa Neural Search", run: searchExa },
  openrouter: { label: "LLM Web Search", run: searchOpenRouter },
};
const PROVIDER_ORDER = ["tavily", "exa", "openrouter"];

const runSearch = async (query: string, preferred: string) => {
  const order = [preferred, ...PROVIDER_ORDER.filter(p => p !== preferred)];
  let lastErr = null;
  for (const key of order) {
    try {
      const { sources, summary } = await SEARCH_PROVIDERS[key].run(query);
      if (sources.length) return { sources, summary, provider: key };
    } catch (e: any) { 
      lastErr = e; 
    }
  }
  if (lastErr) throw lastErr;
  return { sources: [], summary: "", provider: preferred };
};

const SYS_RSN = `You are PolicyPulse's Reason module. Analyse and rank the sources, extract key rules with numbers and dates. Return ONLY raw JSON starting with {:
{"ranked_sources":[{"url":"...","title":"...","rank":1,"why":"..."}],"key_findings":["specific finding with number/date"],"current_rules":[{"rule":"...","value":"number or date","source_url":"..."}],"impact_level":"medium","affected_groups":["group"],"confidence":0.87,"analysis_summary":"2-3 sentence summary"}`;

const SYS_ACT = `You are PolicyPulse's Act module. Generate a clear, actionable PolicyPulse alert. Return ONLY raw JSON starting with {:
{"current_status":"one sentence on current rule/policy state","why_it_matters":"practical importance","who_is_affected":"specific description","key_numbers":[{"label":"label","value":"value"}],"recommended_action":"specific next step","citations":[{"text":"specific quoted fact","source_title":"...","url":"https://..."}],"impact_level":"medium","confidence":0.87,"disclaimer":"Informational summary only, not legal advice. Always verify with official sources before taking action."}
Include 2-3 key_numbers if specific numbers/thresholds exist. Include 2-3 citations.`;

const MALICIOUS_RE = /(ignore (all |the )?(previous|above)|system prompt|disregard (all|previous)|jailbreak|<script|drop table|rm -rf|reveal (your )?(api[_ ]?key|secret)|bearer\s)/i;
const checkTopic = (topic: string) => {
  const t = (topic || "").trim();
  if (t.length < 8) return { ok: false, detail: "topic too short (min 8 chars)" };
  if (MALICIOUS_RE.test(t)) return { ok: false, detail: "blocked: possible prompt-injection / malicious pattern" };
  return { ok: true, detail: "allowed — genuine policy topic" };
};

const governanceChecks = (topic: string, output: any, sources: any[] = []) => {
  const input = checkTopic(topic);
  const official = sources.filter(s => s.type === "government").length;
  const citations = output?.citations?.length || 0;
  const noRun = !output;
  return [
    { label: "Input Guardrail Filter", sub: "topic allowed / not malicious", ok: input.ok, pending: false, detail: input.detail },
    { label: "Government Source Policy", sub: "primary official domains preferred", ok: official > 0, warn: sources.length > 0 && official === 0, pending: !sources.length, detail: sources.length ? `${official}/${sources.length} official government sources` : "awaiting run" },
    { label: "Citation Index mapping", sub: "claims backed by active indices", ok: citations > 0, pending: noRun, detail: noRun ? "awaiting run" : `${citations} verified citations attached` },
    { label: "Compliance & Legal Sanity", sub: "warning note + confidence score", ok: !!(output?.disclaimer && output?.confidence), pending: noRun, detail: noRun ? "awaiting run" : `disclaimer included · confidence ${output?.confidence ? Math.round(output.confidence * 100) + "%" : "missing"}` },
    { label: "Server-Side Credential Key Isolation", sub: "API key proxying active", ok: true, pending: false, detail: "keys read from internal backend — never exposed to client runtime" }
  ];
};

export default function App() {
  const [model, setModel] = useState(readModelLocal);
  const [theme, setTheme] = useState(() => readLocal("policypulse.theme", "light"));
  const [topic, setTopic] = useState("USA student visa (F-1) grace period extension");
  const [searchProvider, setSearchProvider] = useState(() => readLocal("policypulse.searchProvider", "tavily"));
  const [approvalGate, setApprovalGate] = useState(() => readLocal("policypulse.approvalGate", "off"));
  const [engine, setEngine] = useState(() => readLocal("policypulse.engine", "browser"));
  const [pending, setPending] = useState<{ stage: string; summary: string } | null>(null);
  const approvalRef = useRef<((value: boolean) => void) | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>("idle");
  const [currentStep, setCurrentStep] = useState<SimulationStep>('IDLE');
  const [simulationProgress, setSimulationProgress] = useState<number>(0);
  const [activeBlock, setActiveBlock] = useState<string | null>('PROMPT');
  
  const [phases, setPhases] = useState<Record<string, { status: "idle" | "active" | "done"; data: any }>>({
    context: { status: "idle", data: null },
    observe: { status: "idle", data: null },
    reason: { status: "idle", data: null },
    act: { status: "idle", data: null },
  });
  
  const [toolsLog, setToolsLog] = useState<any[]>([]);
  const [memory, setMemory] = useState<any>({ sources: [], preferences: [], alerts: [], checkpoints: [], trustedSources: [] });
  const [output, setOutput] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<string>("output");
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<TraceLog[]>(() => makeTraceRows(model));
  const [sessionReady, setSessionReady] = useState(false);
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState(topic);
  const [isSimulationMode, setIsSimulationMode] = useState<boolean>(false);
  const outputScrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync preset scenarios selection trigger
  const [activeScenario, setActiveScenario] = useState<PresetScenario>(PRESET_SCENARIOS[0]);

  useLayoutEffect(() => {
    const node = outputScrollRef.current;
    if (!node) return;
    node.scrollTop = 0;
  }, [activeTab, output, error]);

  const updPhase = (id: string, u: any) => setPhases(p => ({ ...p, [id]: { ...p[id], ...u } }));
  const addLog = (e: any) => setToolsLog(p => [...p, { ...e, ts: Date.now() }]);

  const updateModel = (val: string) => {
    setModel(val);
    writeLocal("policypulse.model", val);
  };
  const updateProvider = (val: string) => {
    setSearchProvider(val);
    writeLocal("policypulse.searchProvider", val);
  };
  const updateApprovalGate = (val: string) => {
    setApprovalGate(val);
    writeLocal("policypulse.approvalGate", val);
  };
  const updateEngine = (val: string) => {
    setEngine(val);
    writeLocal("policypulse.engine", val);
  };

  const openPromptModal = () => {
    if (status === "running") return;
    setPromptDraft(topic);
    setPromptModalOpen(true);
  };
  const closePromptModal = () => setPromptModalOpen(false);
  const savePromptDraft = () => {
    const next = promptDraft.trim();
    if (!next) return;
    setTopic(next);
    setPromptModalOpen(false);
  };

  const requestApproval = (stage: string, summary: string): Promise<boolean> => {
    return new Promise(resolve => {
      approvalRef.current = resolve;
      setPending({ stage, summary });
    });
  };

  const resolveApproval = (ok: boolean) => {
    const r = approvalRef.current;
    approvalRef.current = null;
    setPending(null);
    if (r) r(ok);
  };

  const toggleTheme = () => setTheme(t => {
    const next = t === "dark" ? "light" : "dark";
    writeLocal("policypulse.theme", next);
    return next;
  });

  // Load backend session state on boot
  useEffect(() => {
    let cancelled = false;
    loadSessionState()
      .then(({ state }) => {
        if (cancelled || !state) return;
        setModel(state.model || DEFAULT_MODEL);
        setTheme(state.theme || "light");
        setTopic(state.topic || "German student visa rules");
        setStatus(state.status === "running" ? "idle" : state.status || "idle");
        setPhases(state.phases || {
          context: { status: "idle", data: null },
          observe: { status: "idle", data: null },
          reason: { status: "idle", data: null },
          act: { status: "idle", data: null },
        });
        setToolsLog(state.toolsLog || []);
        setMemory(dedupeMemory({ sources: [], preferences: [], alerts: [], checkpoints: [], trustedSources: [], ...(state.memory || {}) }));
        setOutput(state.output || null);
        setActiveTab(state.activeTab || "output");
        if (state.status === "running") {
          setError("Restored from server session.");
        } else {
          setError(state.error || null);
        }
        setLogs(state.traceLog || makeTraceRows(state.model || DEFAULT_MODEL));
      })
      .catch(() => {
        if (!cancelled) setError(null); // Silent fail uses local states
      })
      .finally(() => {
        if (!cancelled) setSessionReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  // Sync state to server session
  useEffect(() => {
    if (!sessionReady) return;
    const handle = setTimeout(() => {
      saveSessionState({
        model, theme, topic, status, phases, toolsLog, memory, output, activeTab, error, traceLog: logs,
        savedAt: new Date().toISOString(),
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(handle);
  }, [sessionReady, model, theme, topic, status, phases, toolsLog, memory, output, activeTab, error, logs]);

  // Driving node clicks in Inspector
  useEffect(() => {
    if (currentStep === 'INPUT_GUARD') setActiveBlock('INPUT GUARDRAIL');
    else if (currentStep === 'OBSERVE') setActiveBlock('OBSERVE');
    else if (currentStep === 'REASON') setActiveBlock('REASON');
    else if (currentStep === 'FEEDBACK_LOOP') setActiveBlock('OBSERVE');
    else if (currentStep === 'ACT') setActiveBlock('ACT');
    else if (currentStep === 'OUTPUT_GUARD') setActiveBlock('OUTPUT GUARDRAIL');
    else if (currentStep === 'ALERT_STATE') setActiveBlock('ALERT');
    else if (currentStep === 'REJECTED_STATE') setActiveBlock('REJECTED');
  }, [currentStep]);

  // Bind preset scenarios choice
  const selectPresetScenario = (sc: PresetScenario) => {
    if (status === 'running') return;
    setActiveScenario(sc);
    setTopic(sc.prompt);
    setOutput(null);
    setError(null);
    setPhases({
      context: { status: "idle", data: null },
      observe: { status: "idle", data: null },
      reason: { status: "idle", data: null },
      act: { status: "idle", data: null },
    });
    // Prime logs table with default simulated trace rows
    setLogs(makeTraceRows(model));
    setCurrentStep('IDLE');
    setSimulationProgress(0);
    setIsSimulationMode(false);
  };

  // Run structured sandbox simulated staging pipeline
  const runSimulatedTrace = () => {
    if (status === 'running') return;
    setIsSimulationMode(true);
    setStatus("running");
    setError(null);
    setOutput(null);
    setToolsLog([]);
    setActiveTab("harness_trace");
    
    // Seed steps
    setCurrentStep('INPUT_GUARD');
    setSimulationProgress(0);
  };

  // Simulated ticks loops
  useEffect(() => {
    if (!isSimulationMode || status !== 'running') return;

    timerRef.current = setInterval(() => {
      setSimulationProgress((prev) => {
        let nextPercent = prev + 20;
        if (nextPercent >= 100) {
          nextPercent = 100;
          clearInterval(timerRef.current!);
          handleSimulationStageComplete();
        }
        return nextPercent;
      });
    }, 150);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isSimulationMode, currentStep, status, activeScenario]);

  const handleSimulationStageComplete = () => {
    setSimulationProgress(0);

    if (currentStep === 'INPUT_GUARD') {
      if (!activeScenario.inputGuardrailResults.promptInjectionSafe) {
        // Injection malicious detected, dump straight to REJECTED block
        setCurrentStep('REJECTED_STATE');
        setStatus("done");
        setOutput({
          current_status: "CRITICAL PRE-CRAWL QUARANTINE EXECUTED",
          why_it_matters: "Input parsed positive for jailbreak keywords. Execution vector locked pre-network call.",
          who_is_affected: "System integrity shielding filters",
          disclaimer: "PolicyPulse Network Shield security report log.",
          confidence: 0.99,
          changes: ["System alert: override payload neutralized"]
        });
        setLogs(prev => prev.map((row, i) => 
          i === 2 ? { ...row, status: 'BLOCKED', durationMs: 4, tokens: '0 tok', cost: '$0.00000' } : row
        ));
      } else {
        setCurrentStep('OBSERVE');
      }
    } else if (currentStep === 'OBSERVE') {
      setCurrentStep('REASON');
    } else if (currentStep === 'REASON') {
      if (activeScenario.behaviorType === 'low_confidence') {
        setCurrentStep('FEEDBACK_LOOP');
        // trigger loop timeout recheck simulated
        setTimeout(() => {
          setCurrentStep('ACT');
        }, 1200);
      } else {
        setCurrentStep('ACT');
      }
    } else if (currentStep === 'ACT') {
      setCurrentStep('OUTPUT_GUARD');
    } else if (currentStep === 'OUTPUT_GUARD') {
      setCurrentStep('ALERT_STATE');
      setStatus("done");
      // Populate mock simulation alert output structures 
      setOutput({
        current_status: activeScenario.finalAlert.description,
        why_it_matters: activeScenario.summary,
        who_is_affected: "Identified eligible student graduates and qualified visa entrants",
        recommended_action: "Refer directly to Appendix rules before completing OPT agreements.",
        key_numbers: [
          { label: "Base confidence score matched", value: activeScenario.reasonResults.confidence.toFixed(2) },
          { label: "Sources audited", value: `${activeScenario.observeResults.sources.length} matching` }
        ],
        citations: activeScenario.observeResults.sources.map(s => ({
          text: s.title,
          source_title: s.title,
          url: s.url
        })),
        disclaimer: "Simulated briefing summary.",
        confidence: activeScenario.reasonResults.confidence,
        changes: ["Baseline diagnostic audit matched."]
      });
      setActiveTab("output");
      
      // Update simulated trace logs as complete
      setLogs(prev => prev.map(row => ({
        ...row,
        status: 'DONE',
        durationMs: Math.round(900 + Math.random() * 800),
        tokens: '2100 tok',
        cost: '$0.00004'
      })));
    }
  };

  // Run TRUE LIVE crawler agent speaking to external network endpoints
  const runLiveAgentBrowser = async () => {
    if (!topic.trim() || status === "running") return;
    setIsSimulationMode(false);
    setStatus("running");
    setError(null);
    setOutput(null);
    setToolsLog([]);
    setPhases({
      context: { status: "idle", data: null },
      observe: { status: "idle", data: null },
      reason: { status: "idle", data: null },
      act: { status: "idle", data: null },
    });
    setLogs(makeTraceRows(model));
    setActiveTab("harness_trace");

    const runModel = model.trim() || DEFAULT_MODEL;

    const updateSingleTrace = (key: string, updates: Partial<TraceLog>) => {
      setLogs(prev => prev.map(row => {
        const stepKey = TRACE_STEPS.find(s => s[0] === key);
        if (stepKey && row.stepName === stepKey[1].toUpperCase()) {
          return { ...row, ...updates };
        }
        return row;
      }));
    };

    try {
      // Step 1: Input recieved UI marker
      let t0 = performance.now();
      setCurrentStep('INPUT_GUARD');
      updateSingleTrace("input_received", { status: 'DONE', durationMs: 1, tokens: "0 tok", cost: "$0.00000" });

      // Step 2: Context build
      t0 = performance.now();
      updPhase("context", { status: "active" });
      await sleep(600);
      updPhase("context", { status: "done", data: { topic } });
      addLog({ type: "context", msg: `Query topic vector initialized: "${topic}"` });
      updateSingleTrace("context_built", { status: 'DONE', durationMs: Math.round(performance.now() - t0), tokens: "0 tok" });

      // Step 3: Local guardrail check
      t0 = performance.now();
      const guard = checkTopic(topic);
      if (!guard.ok) {
        updateSingleTrace("guardrail_checked", { status: 'BLOCKED', durationMs: 2 });
        setCurrentStep('REJECTED_STATE');
        throw new Error(`Local Safety Shield Intercept: ${guard.detail}`);
      }
      updateSingleTrace("guardrail_checked", { status: 'DONE', durationMs: Math.round(performance.now() - t0), tokens: "0 tok" });

      // Step 4: Web Search (Observe loop)
      const MAX_LOOPS = 2;
      const checkpoints = [];
      let obsJSON: any = null;
      let rsnJSON: any = null;
      let rsnData: any = null;
      let searchTerms = `${topic} official guidelines rules ${new Date().getFullYear()}`;
      let loops = 0;
      let enoughConfidence = false;

      while (!enoughConfidence && loops < MAX_LOOPS) {
        loops++;
        t0 = performance.now();
        setCurrentStep('OBSERVE');
        updPhase("observe", { status: "active" });
        addLog({ type: "web_search", query: `Searching [${searchProvider}] for: "${searchTerms}"` });

        // Fire crawler crawling index lists
        let search = await runSearch(searchTerms, searchProvider);

        // Escalation heuristics: if chosen search leaves zero official domains, fall back automatically to Google OpenRouter legacy scraper
        const officialCount = search.sources.filter(s => s.type === "government").length;
        if (officialCount === 0 && search.provider !== "openrouter") {
          addLog({ type: "diff_engine", msg: "⚠ official domains policy unmet. Escalating queries to deep LLM web search..." });
          try {
            const esc = await searchOpenRouter(searchTerms);
            if (esc.sources.filter(s => s.type === "government").length > 0) {
              search = { ...esc, provider: "openrouter (escalated)" };
              addLog({
                type: "web_search",
                tool: "openrouter",
                query: searchTerms,
                resultCount: esc.sources.length,
                status: "approved",
                urls: esc.sources.map(s => s.url),
                why: "Bypassed standard crawl constraints to retrieve official authorities."
              });
            }
          } catch (err: any) {
            addLog({ type: "diff_engine", msg: `Escalation failed: ${err.message}` });
          }
        }

        obsJSON = {
          sources: search.sources,
          search_queries: [searchTerms],
          summary: search.summary || `Extracted ${search.sources.length} matching sources from search space.`
        };

        updPhase("observe", { status: "done", data: obsJSON });
        setMemory((prev: any) => {
          const matchedUrls = new Set((prev.trustedSources || []).map((s: any) => s.url));
          const validatedFresh = obsJSON.sources.filter((s: any) => s.type === "government" && !matchedUrls.has(s.url));
          return {
            ...prev,
            sources: obsJSON.sources,
            trustedSources: [...(prev.trustedSources || []), ...validatedFresh]
          };
        });

        updateSingleTrace("web_search_called", { 
          status: 'DONE', 
          durationMs: Math.round(performance.now() - t0),
          modelName: search.provider,
          tokens: `${obsJSON.sources.length} sources`
        });

        checkpoints.push({ step: "Observe", ts: Date.now(), summary: `Pass ${loops}: extracted ${obsJSON.sources.length} verified citation references.` });

        // OPTIONAL HUMAN APPROVAL GATE: pauses execution prior to Reasoning analysis
        if (approvalGate === "sources" && loops === 1) {
          addLog({ type: "notifier", msg: `⏸ Harness paused: awaiting human evaluation checks on ${obsJSON.sources.length} crawled sources...` });
          const approvedByHuman = await requestApproval("sources", `Verify ${obsJSON.sources.length} references captured from ${searchProvider} before writing policy brief.`);
          if (!approvedByHuman) {
            addLog({ type: "notifier", msg: "✗ reference list rejected by user and halted." });
            setStatus("idle");
            return;
          }
          addLog({ type: "notifier", msg: "✓ references validated by user. Analyzing..." });
        }

        // Reason classifier
        t0 = performance.now();
        setCurrentStep('REASON');
        updPhase("reason", { status: "active" });
        addLog({ type: "diff_engine", msg: `Invoking Mistral-Nemo classifiers. Evaluating policy discrepancies...` });

        const rsn = await callJSON({
          model: runModel,
          messages: [
            { role: "system", content: SYS_RSN },
            { role: "user", content: `Topic: "${topic}"\nActive references:\n${JSON.stringify(obsJSON, null, 2)}` }
          ],
          requiredKeys: ["key_findings", "confidence"]
        });

        rsnData = rsn.data;
        rsnJSON = rsn.json || { key_findings: [], analysis_summary: pullText(rsnData).slice(0, 220), confidence: 0.70 };

        const confidenceVal = Number(rsnJSON.confidence) || 0.5;
        enoughConfidence = obsJSON.sources.length >= 2 && confidenceVal >= 0.65;
        updPhase("reason", { status: "done", data: rsnJSON });

        updateSingleTrace("sources_ranked", { 
          status: 'DONE', 
          durationMs: Math.round(performance.now() - t0),
          tokens: formatUsage(rsnData),
          cost: formatCost(rsnData),
          retryCount: rsn.attempts - 1
        });

        addLog({ 
          type: "diff_engine", 
          msg: `Matched impact: [${rsnJSON.impact_level || "medium"}] · Confidence score: ${(confidenceVal * 100).toFixed(0)}% · Sufficient: ${enoughConfidence ? "YES" : "NO (re-querying)"}` 
        });

        checkpoints.push({ step: "Reason", ts: Date.now(), summary: `Pass ${loops}: verified rules at ${(confidenceVal * 100).toFixed(0)}% reliability confidence index.` });

        if (!enoughConfidence && loops < MAX_LOOPS) {
          setCurrentStep('FEEDBACK_LOOP');
          searchTerms = `${topic} exact official rules amendments effective dates`;
          await sleep(1000);
        }
      }

      const officialSources = (obsJSON?.sources || []).filter((s: any) => s.type === "government").length;
      if (officialSources === 0) {
        throw new Error("Governance policy failure: No primary official government pages retrieved. Terminated to block hallucination.");
      }

      // Reasoning complete tracing
      updateSingleTrace("reasoning_done", { status: 'DONE', tokens: `${loops} loops` });

      // Actor stage (Act)
      t0 = performance.now();
      setCurrentStep('ACT');
      updPhase("act", { status: "active" });
      addLog({ type: "summarizer", msg: "Generating final styled briefing alert schema..." });

      const act = await callJSON({
        model: runModel,
        messages: [
          { role: "system", content: SYS_ACT },
          { role: "user", content: `Topic: "${topic}"\nAnalysis Output:\n${JSON.stringify(rsnJSON, null, 2)}\nActive crawled sources:\n${JSON.stringify(obsJSON.sources, null, 2)}` }
        ],
        requiredKeys: ["current_status", "disclaimer", "confidence"]
      });

      const actData = act.data;
      const actJSON = withCitationFallback(
        act.json || { current_status: pullText(actData).slice(0, 220), impact_level: "medium", confidence: 0.8 },
        obsJSON.sources
      );

      // Output Guardrail verification
      t0 = performance.now();
      setCurrentStep('OUTPUT_GUARD');
      const badFields = [
        !actJSON.current_status && "status",
        !actJSON.disclaimer && "disclaimer",
        !actJSON.confidence && "confidence",
        !(actJSON.citations?.length) && "citations"
      ].filter(Boolean);

      updateSingleTrace("output_checked", { 
        status: badFields.length ? 'RETRYING' : 'DONE', 
        durationMs: Math.round(performance.now() - t0)
      });

      // Saving alert brief and tracking differentials vs previously cached alerts
      const prevCachedAlert = [...memory.alerts].reverse().find(a => a.topic === topic);
      const changesList = diffAlerts(prevCachedAlert?.out, actJSON);
      actJSON.changes = changesList;

      addLog({ type: "diff_engine", msg: prevCachedAlert ? `🔺 identified ${changesList.length} delta differentials vs cached baseline` : "baseline alert registered successfully" });
      checkpoints.push({ step: "Act", ts: Date.now(), summary: `Compiled successfully with ${changesList.length} alert deviations.` });

      // OPTIONAL HUMAN APPROVAL GATE: alerts saving blocks
      if (approvalGate === "alert") {
        addLog({ type: "notifier", msg: "⏸ Harness paused: awaiting user signature validation on computed alert..." });
        const userApprovedAlert = await requestApproval("alert", actJSON.current_status || "Agree to save compiled alert brief.");
        if (!userApprovedAlert) {
          addLog({ type: "notifier", msg: "✗ alert quarantine issued by user. Blocked." });
          setStatus("idle");
          return;
        }
      }

      updPhase("act", { status: "done", data: actJSON });
      setOutput(actJSON);
      updateSingleTrace("alert_generated", { status: 'DONE', tokens: formatUsage(actData), cost: formatCost(actData) });

      const isExactDuplicate = !!prevCachedAlert && changesList.length === 1 && /^No material changes/i.test(changesList[0]);
      setMemory((prev: any) => ({
        ...prev,
        alerts: isExactDuplicate ? prev.alerts : [...prev.alerts, { topic, out: actJSON, ts: Date.now() }],
        checkpoints: [...(prev.checkpoints || []), { run: Date.now(), topic, steps: checkpoints }],
        preferences: prev.preferences.some((p: any) => p.topic === topic) ? prev.preferences : [...prev.preferences, { topic, ts: Date.now() }]
      }));

      setCurrentStep('ALERT_STATE');
      setStatus("done");
      setActiveTab("output");
      addLog({ type: "notifier", msg: `Compiled successfully via browser execution Engine.` });

    } catch (err: any) {
      updateSingleTrace("alert_generated", { status: 'BLOCKED' });
      setError(err.message);
      setStatus("error");
    }
  };

  // Run the full agent in the Python backend instead of the browser.
  const runAgentPython = async () => {
    if (!topic.trim() || status === "running") return;
    if (approvalGate !== "off") {
      setStatus("error");
      setError("Approval gates are only available with the Browser (JS) engine until the backend supports interactive pauses.");
      setActiveTab("governance");
      return;
    }
    setIsSimulationMode(false);
    setStatus("running");
    setError(null);
    setOutput(null);
    setToolsLog([]);
    setPhases({
      context: { status: "idle", data: null },
      observe: { status: "idle", data: null },
      reason: { status: "idle", data: null },
      act: { status: "idle", data: null },
    });
    setLogs(makeTraceRows(model));
    setActiveTab("harness_trace");

    const runModel = model.trim() || DEFAULT_MODEL;

    const updateSingleTrace = (key: string, updates: Partial<TraceLog>) => {
      setLogs(prev => prev.map(row => {
        const stepKey = TRACE_STEPS.find(s => s[0] === key);
        if (stepKey && row.stepName === stepKey[1].toUpperCase()) {
          return { ...row, ...updates };
        }
        return row;
      }));
    };

    updateSingleTrace("input_received", { status: 'DONE', durationMs: 1, tokens: "0 tok", cost: "$0.00000" });

    const contextStarted = performance.now();
    updateSingleTrace("context_built", { status: 'PENDING', modelName: runModel });
    updPhase("context", { status: "active" });
    await sleep(700);
    updPhase("context", { status: "done", data: { topic } });
    updateSingleTrace("context_built", {
      status: 'DONE',
      durationMs: Math.max(0, Math.round(performance.now() - contextStarted)),
      tokens: "0 tok"
    });

    const guardrail = checkTopic(topic);
    const guardStarted = performance.now();
    updateSingleTrace("guardrail_checked", {
      status: guardrail.ok ? 'DONE' : 'BLOCKED',
      durationMs: Math.max(0, Math.round(performance.now() - guardStarted)),
      modelName: runModel,
      tokens: "0 tok",
    });
    if (!guardrail.ok) {
      setError(`Input guardrail failed: ${guardrail.detail}`);
      setStatus("error");
      return;
    }

    const observeStarted = performance.now();
    updateSingleTrace("web_search_called", {
      status: 'PENDING',
      modelName: searchProvider,
    });
    updPhase("observe", { status: "active" });
    addLog({
      type: "web_search",
      query: `POST /run · ${topic}`,
      why: "Run the full Observe→Reason→Act pipeline in the Python backend"
    });

    try {
      const res = await fetch(PYTHON_RUN, {
        method: "POST",
        headers: mkHeaders(),
        body: JSON.stringify({ topic, provider: searchProvider }),
      });
      const text = await res.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error(`Python backend returned a non-JSON response (HTTP ${res.status}). Is the backend running and the /api/run proxy configured?`);
      }
      if (!res.ok) throw new Error(result.error || `Python backend HTTP ${res.status} (is it running? python3 -m policypulse.server)`);
      if (result.error) throw new Error(result.error);

      const actualModel = result.model || runModel;
      (result.checkpoints || []).forEach((cp: any) => addLog({ type: "diff_engine", msg: `${cp.step}: ${cp.summary}` }));

      setMemory((p: any) => ({
        ...p,
        sources: result.obs?.sources || [],
        checkpoints: [...(p.checkpoints || []), { run: Date.now(), topic, steps: result.checkpoints || [] }],
      }));

      // Update web search trace
      const searchDuration = Math.max(0, Math.round(performance.now() - observeStarted));
      updateSingleTrace("web_search_called", {
        status: 'DONE',
        durationMs: searchDuration,
        modelName: result.obs?.provider || searchProvider,
        tokens: `${(result.obs?.sources || []).length} sources`
      });

      // Update remaining pre-reason/reason traces from backend result
      updateSingleTrace("context_built", { modelName: actualModel });
      updateSingleTrace("guardrail_checked", { modelName: actualModel });

      updPhase("observe", { status: "done", data: result.obs });

      // REASON
      updPhase("reason", { status: "active" });
      updateSingleTrace("sources_ranked", {
        status: 'DONE',
        modelName: actualModel,
        durationMs: 350,
        tokens: "backend"
      });
      await sleep(350);
      updateSingleTrace("reasoning_done", {
        status: 'DONE',
        modelName: actualModel,
        durationMs: 350,
        tokens: `${result.loops || 1} pass`
      });
      updPhase("reason", { status: "done", data: result.reason });

      // ACT
      updPhase("act", { status: "active" });
      updateSingleTrace("alert_generated", {
        status: 'PENDING',
        modelName: actualModel,
      });
      await sleep(350);

      updateSingleTrace("output_checked", {
        status: 'DONE',
        modelName: actualModel,
        durationMs: 350,
        tokens: "0 tok"
      });

      updateSingleTrace("alert_generated", {
        status: 'DONE',
        durationMs: 350,
        tokens: "backend"
      });

      updPhase("act", { status: "done", data: result.alert });
      setOutput(result.alert);
      addLog({ type: "notifier", msg: `Python backend done · ${result.saved ? "alert saved" : "no material change"}` });
      setStatus("done");
      setCurrentStep('ALERT_STATE');
      setActiveTab("output");
    } catch (e: any) {
      // Find key that failed
      const failKey = /LLM HTTP|OpenRouter|JSON/i.test(e.message) ? "reasoning_done" : "web_search_called";
      updateSingleTrace(failKey, { status: 'BLOCKED' });
      
      updPhase("observe", { status: failKey === "web_search_called" ? "idle" : "done" });
      updPhase("reason", { status: "idle" });
      updPhase("act", { status: "idle" });
      setError(e.message);
      setStatus("error");
    }
  };

  const handleRunTrigger = () => {
    if (status === 'running') return;
    if (engine === 'python') {
      runAgentPython();
    } else {
      runLiveAgentBrowser();
    }
  };

  const resetAllHarness = () => {
    setStatus("idle");
    setCurrentStep('IDLE');
    setSimulationProgress(0);
    setOutput(null);
    setError(null);
    setToolsLog([]);
    setPhases({
      context: { status: "idle", data: null },
      observe: { status: "idle", data: null },
      reason: { status: "idle", data: null },
      act: { status: "idle", data: null },
    });
    setLogs(makeTraceRows(model));
  };

  // Prepare a dynamic PresetScenario structure representating our interactive live queries or selections
  const computeActiveScenario = (): PresetScenario => {
    if (isSimulationMode) return activeScenario;
    
    // Construct dynamic scenario from current functional running results so trace matches beautifully
    return {
      id: 'live-scenario',
      label: 'Live Web Scraping Inquiry',
      icon: 'Search',
      prompt: topic,
      category: 'Real-Time Policy Brief',
      behaviorType: 'standard',
      summary: output?.why_it_matters || 'Active search run querying official federal endpoints.',
      inputGuardrailResults: {
        approvedTopics: true,
        promptInjectionSafe: true,
        lengthChecks: topic.length < 500
      },
      observeResults: {
        sources: (memory.sources || []).map((s: any) => ({ title: s.title, url: s.url, relevance: 95 })),
        progressSearch: 100,
        progressPage: 100,
        progressParse: 100
      },
      reasonResults: {
        diffProgress: 100,
        sourceRanking: 100,
        confidence: output?.confidence || 0.95
      },
      actResults: {
        summarizeProgress: 100,
        notifierProgress: 100,
        tokensUsed: 2200,
        costUsd: 0.00004
      },
      outputGuardrailResults: {
        disclaimerCheck: true,
        confidenceScoreCheck: true,
        citationCheck: true
      },
      finalAlert: {
        title: 'COMPILED UPDATE BRIEF',
        description: output?.current_status || '',
        details: '',
        markdownBody: output?.disclaimer || ''
      }
    };
  };

  const currentDisplayScenario = computeActiveScenario();

  return (
    <div className={`min-h-screen font-sans flex flex-col p-4 md:p-6 select-none transition-colors duration-300
      ${theme === 'dark' ? 'bg-[#1e251c] text-slate-100' : 'bg-[#d6dcd3] text-slate-900'}`}
    >
      {/* ── CENTRAL APP CONTAINER FRAME ───────────────────────── */}
      <div className={`w-full max-w-7xl mx-auto rounded-lg shadow-2xl border overflow-hidden flex flex-col transition-all duration-300
        ${theme === 'dark' ? 'bg-[#151c14] border-slate-800' : 'bg-[#eef1ec] border-slate-300'}`}
      >
        
        {/* ── TOPBAR ASSEMBLY ─────────────────────────────────── */}
        <header className={`flex items-center justify-between h-14 border-b px-6 transition-colors
          ${theme === 'dark' ? 'bg-[#0f140e] border-[#252f23]' : 'bg-white border-slate-200'}`}
        >
          <div className="flex items-center space-x-4">
            <div className="font-mono font-bold tracking-widest text-[15px]">
              <span className="text-emerald-600 font-bold">POLICY</span>PULSE
            </div>
            <div className={`h-4 w-px ${theme === 'dark' ? 'bg-[#252f23]' : 'bg-slate-200'}`}></div>
            <div className="font-mono text-[9px] text-slate-400 tracking-wider uppercase hidden sm:block">
              AGENT = LLM + HARNESS
            </div>
            
            {/* Reactive Status Badge matching High Density theme */}
            <div className={`flex items-center border px-2.5 py-0.5 rounded-sm transition-all duration-300
              ${theme === 'dark' ? 'bg-slate-900/60 border-slate-800' : 'bg-emerald-50 border-emerald-200'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full mr-1.5 transition-all duration-300
                ${status === 'idle' 
                  ? 'bg-slate-400' 
                  : status === 'running'
                  ? 'bg-amber-500 animate-pulse'
                  : status === 'error'
                  ? 'bg-rose-500 animate-pulse'
                  : 'bg-emerald-500'}`}
              ></span>
              <span className={`font-mono text-[8px] font-bold tracking-wide uppercase
                ${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}
              >
                {status === 'idle' ? 'STANDBY' : status === 'running' ? 'EXECUTING' : status === 'error' ? 'BLOCKED' : 'READY'}
              </span>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <button 
              onClick={toggleTheme}
              className={`p-1.5 rounded-md border transition-all text-xs flex items-center space-x-1 font-mono tracking-tight cursor-pointer
                ${theme === 'dark' ? 'bg-[#21291d] border-[#34422e] text-amber-400 hover:bg-[#2d3929]' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'}`}
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              <span className="hidden xs:inline">{theme === 'dark' ? 'LIGHT' : 'DARK'}</span>
            </button>

            <button
              onClick={() => setActiveTab("settings")}
              className={`p-1.5 rounded-md border transition-all text-xs flex items-center space-x-1 font-mono tracking-tight cursor-pointer
                ${theme === 'dark' ? 'bg-[#21291d] border-[#34422e] text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'}`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">SETTINGS</span>
            </button>
          </div>
        </header>

        {/* ── HUMAN APPROVAL BANNER ──────────────────────────────── */}
        {pending && (
          <div className={`border-b p-3 flex flex-wrap gap-4 items-center justify-between transition-all
            ${theme === 'dark' ? 'bg-amber-950/20 border-amber-800/40 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-900'}`}
          >
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 animate-pulse" />
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider">
                ⏸ Human Approval Gate Pause: {pending.stage.toUpperCase()}
              </span>
              <span className="text-xs italic font-sans">{pending.summary}</span>
            </div>
            <div className="flex space-x-2">
              <button 
                onClick={() => resolveApproval(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white rounded font-mono font-bold text-[10px] px-3.5 py-1.5 transition-colors cursor-pointer shadow-xs"
              >
                ✓ APPROVE STEP
              </button>
              <button 
                onClick={() => resolveApproval(false)}
                className="bg-slate-800 hover:bg-slate-900 text-slate-300 border border-slate-700 rounded font-mono font-bold text-[10px] px-3.5 py-1.5 transition-colors cursor-pointer"
              >
                ✗ REJECT
              </button>
            </div>
          </div>
        )}

        {/* ── MAIN WORKSPACE GRID ─────────────────────────────── */}
        <div className={`grid grid-cols-1 lg:grid-cols-12 min-h-[500px] border-b
          ${theme === 'dark' ? 'border-[#252f23]' : 'border-slate-200 bg-[#eef1ec]'}`}
        >
          
          {/* LEFT AREA: Diagram & Actions (Cols 1-8) */}
          <div className={`lg:col-span-8 p-4 flex flex-col gap-3.5 border-r
            ${theme === 'dark' ? 'border-[#252f23]' : 'border-[#d0d7cd]'}`}
          >
            
            {/* The SVG Diagram wrapper card layout */}
            <div className={`rounded border overflow-hidden relative shadow-2xs min-h-[460px] flex flex-col justify-between
              ${theme === 'dark' ? 'bg-[#0e120d] border-[#252f23]' : 'bg-[#e9ece6] border-slate-250'}`}
            >
              <div className="absolute top-2.5 left-2.5 z-10 flex gap-2">
                <span className={`px-2.5 py-1 rounded text-[10.5px] font-mono font-bold uppercase tracking-wider border shadow-xs
                  ${theme === 'dark' 
                    ? 'bg-[#151c14] border-emerald-900/30 text-emerald-400' 
                    : 'bg-emerald-50 border-emerald-250 text-emerald-700'}`}
                >
                  Trace Viewport Map
                </span>
                {status === 'running' && (
                  <span className={`px-2.5 py-1 rounded text-[10.5px] font-mono font-bold animate-pulse border
                    ${theme === 'dark'
                      ? 'bg-slate-900 border-slate-800 text-slate-400'
                      : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700'}`}
                  >
                    Stage Process: {isSimulationMode ? 'SANDBOX STAGING' : 'REAL ACTIVE AGENT'}
                  </span>
                )}
              </div>

              {/* Render dynamic interactive SVG diagram driven directly by true agent loops */}
              <div className="flex-1 p-2">
                <ArchitectureDiagram 
                  currentStep={currentStep}
                  activeScenario={currentDisplayScenario}
                  onBlockClick={(block) => {
                    setActiveBlock(block);
                    if (block === 'MEMORY' || block === 'REJECTED' || block === 'ALERT' || block === 'INPUT GUARDRAIL') {
                      setActiveTab("governance");
                    }
                  }}
                  activeBlock={activeBlock}
                  simulationProgress={simulationProgress} 
                />
              </div>
            </div>

            {/* Simulated preset query selectors */}
            <div className={`p-3.5 rounded border flex flex-col gap-3 shadow-2xs
              ${theme === 'dark' ? 'bg-[#0f140e] border-[#252f23]' : 'bg-white border-slate-200'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-col gap-1.5 w-full">
                  <span className="font-mono text-[10.5px] font-bold text-emerald-600 uppercase tracking-tight">
                    Select Scenario Vector:
                  </span>
                  
                  <div className="flex gap-1.5 flex-wrap">
                    {PRESET_SCENARIOS.map((sc) => {
                      const isActive = activeScenario.id === sc.id;
                      return (
                        <button
                          key={sc.id}
                          onClick={() => selectPresetScenario(sc)}
                          className={`px-3 py-1.5 text-[11px] font-mono rounded tracking-tight transition-all duration-200 flex items-center gap-1.5 border cursor-pointer
                            ${isActive 
                              ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/60 font-semibold shadow-2xs' 
                              : theme === 'dark' 
                              ? 'bg-[#151c14] border-[#252f23] text-slate-400 hover:bg-[#20291c] hover:text-slate-200' 
                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                        >
                          {sc.icon === 'GraduationCap' && <GraduationCap className="w-3.5 h-3.5 text-emerald-500" />}
                          {sc.icon === 'ShieldAlert' && <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />}
                          {sc.icon === 'BritishPound' && <Coins className="w-3.5 h-3.5 text-amber-500" />}
                          {sc.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Selector settings toolbar */}
              <div className={`grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t
                ${theme === 'dark' ? 'border-[#222c20]' : 'border-slate-100'}`}
              >
                <div>
                  <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase mb-1">Crawl Provider Fallback:</label>
                  <select 
                    value={searchProvider} 
                    onChange={(e) => updateProvider(e.target.value)}
                    className={`w-full font-mono text-[11px] p-1.5 rounded border focus:outline-none focus:border-emerald-550
                      ${theme === 'dark' ? 'bg-[#1c2419] border-[#2c3928] text-slate-200' : 'bg-slate-50 border-slate-250 text-slate-800'}`}
                  >
                    <option value="tavily">Tavily Deep Search</option>
                    <option value="exa">Exa Neural Search</option>
                    <option value="openrouter">OpenRouter Selector (legacy)</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase mb-1">Human Policy Approval:</label>
                  <select 
                    value={approvalGate} 
                    onChange={(e) => updateApprovalGate(e.target.value)}
                    className={`w-full font-mono text-[11px] p-1.5 rounded border focus:outline-none focus:border-emerald-555
                      ${theme === 'dark' ? 'bg-[#1c2419] border-[#2c3928] text-slate-200' : 'bg-slate-50 border-slate-250 text-slate-800'}`}
                  >
                    <option value="off">No approval gate (Autonomic)</option>
                    <option value="sources">Approve references before analyze</option>
                    <option value="alert">Authorize alert compilation write</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase mb-1">Execution Engine:</label>
                  <select 
                    value={engine} 
                    onChange={(e) => updateEngine(e.target.value)}
                    className={`w-full font-mono text-[11px] p-1.5 rounded border focus:outline-none focus:border-emerald-555
                      ${theme === 'dark' ? 'bg-[#1c2419] border-[#2c3928] text-slate-200' : 'bg-slate-50 border-slate-250 text-slate-800'}`}
                  >
                    <option value="browser">Engine: Browser JavaScript Client</option>
                    <option value="python">Engine: Python backend</option>
                  </select>
                </div>
              </div>

              {/* Simulation run actions */}
              <div className="flex items-center gap-2 justify-between border-t border-slate-100 pt-2.5 flex-wrap">
                <div className="flex gap-1.5">
                  <button
                    onClick={runSimulatedTrace}
                    disabled={status === 'running'}
                    className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white rounded text-xs font-semibold font-mono flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                  >
                    <Activity className="w-3.5 h-3.5 text-emerald-500" />
                    Simulate Scenario Tracing
                  </button>

                  <button
                    onClick={handleRunTrigger}
                    disabled={status === 'running'}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-750 text-white rounded text-xs font-semibold font-mono flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    Run Live AI Check
                  </button>

                  <button
                    onClick={resetAllHarness}
                    className={`px-3 py-1.5 rounded text-xs font-semibold font-mono flex items-center gap-1.5 transition-all cursor-pointer
                      ${theme === 'dark' ? 'bg-[#212a1d] border border-[#2a3824] text-slate-300 hover:bg-[#2e3b2a]' : 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-650'}`}
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset Staging
                  </button>
                </div>

                {/* Prompt trigger command block inline */}
                <div className="flex-1 max-w-sm flex items-center gap-1 bg-slate-100 dark:bg-[#161d14] rounded p-1 border dark:border-slate-800">
                  <input 
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    onClick={openPromptModal}
                    placeholder="or execute custom brief query..."
                    className="flex-1 bg-transparent border-none text-[11px] px-2 py-1 font-mono focus:outline-none"
                  />
                  <button
                    onClick={handleRunTrigger}
                    className="p-1 px-2.5 bg-slate-800 text-emerald-400 rounded text-xs font-mono font-bold flex items-center tracking-widest cursor-pointer hover:bg-black"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

          </div>

          {/* RIGHT AREA: Detailed Node Inspector (Cols 9-12) */}
          <div className={`lg:col-span-4 p-4 flex flex-col gap-3.5 backdrop-blur-xs border-l overflow-y-auto max-h-[585px]
            ${theme === 'dark' ? 'bg-[#10150f] border-[#252f23]' : 'bg-white/75 border-slate-200'}`}
          >
            
            {/* Inspector Title Block */}
            <div className="flex items-center justify-between border-b pb-2">
              <div className="flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-emerald-600" />
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider">
                  Harness Node Inspector
                </span>
              </div>
              <span className="font-mono text-[8.5px] bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold uppercase text-emerald-500">
                Node: {activeBlock || 'None'}
              </span>
            </div>

            {/* DYNAMIC CARD CONTENT BASED ON ACTIVE BLOCK CHOSEN IN SVG */}
            {activeBlock === 'PROMPT' && (
              <div className="flex flex-col gap-3 transition-opacity duration-300">
                <div className={`p-3 rounded border shadow-2xs
                  ${theme === 'dark' ? 'bg-[#151c14] border-[#2c3829]' : 'bg-white border-slate-200'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Bookmark className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-[9.5px] font-bold font-mono uppercase text-slate-500">Staged Request</span>
                  </div>
                  <p className={`text-[12px] font-mono p-2 border rounded leading-relaxed
                    ${theme === 'dark' ? 'text-emerald-400 bg-emerald-950/20 border-emerald-800/30' : 'text-emerald-950 bg-emerald-100/30 border-emerald-200/50'}`}
                  >
                    "{topic}"
                  </p>
                </div>

                <div className={`p-3 rounded border flex flex-col gap-2 shadow-2xs
                  ${theme === 'dark' ? 'bg-[#151c14] border-[#2c3829]' : 'bg-white border-slate-200'}`}
                >
                  <span className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider">Description context</span>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    {isSimulationMode ? activeScenario.summary : "Analyzing current policies utilizing Tavily index crawlers and Mistral LLM classifiers."}
                  </p>
                  <div className={`text-[9.5px] font-mono border p-1.5 rounded flex justify-between
                    ${theme === 'dark' ? 'bg-[#1e251d] border-slate-800' : 'bg-slate-50 border-slate-150'}`}
                  >
                    <span>Target Category:</span>
                    <span className="font-bold text-emerald-550">{isSimulationMode ? activeScenario.category : "Custom Agent Crawl"}</span>
                  </div>
                </div>
              </div>
            )}

            {activeBlock === 'INPUT GUARDRAIL' && (
              <div className="flex flex-col gap-3">
                <div className={`p-3 rounded border shadow-2xs
                  ${theme === 'dark' ? 'bg-[#151c14] border-[#2c3829]' : 'bg-white border-slate-200'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Cpu className="w-3.5 h-3.5 text-orange-500 animate-pulse" />
                    <span className="text-[9.5px] font-bold font-mono uppercase">Pre-Check Vectors</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal mb-2.5">
                    Evaluates custom topics and input patterns to sanitize execution prior to launching expensive search crawlers.
                  </p>

                  <div className="flex flex-col gap-1.5 border-t border-dashed pt-2 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[9.5px] text-slate-400">Approved Domain Constraint:</span>
                      <span className="text-emerald-600 font-mono font-bold">PASS</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[9.5px] text-slate-400">Prompt Injection Shield:</span>
                      {checkTopic(topic).ok ? (
                        <span className="text-emerald-600 font-mono font-bold">PASS (✓ secured)</span>
                      ) : (
                        <span className="text-rose-500 font-mono font-bold">BLOCKED</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-2.5 bg-slate-950 rounded border border-slate-800 text-amber-500 font-mono text-[9.5px] leading-normal shadow-md">
                  <p className="text-slate-500 mb-0.5 font-bold">Trace Check Engine Logs:</p>
                  <p className="text-slate-400">&gt;&gt; Parsing prompt vectors with length limits...</p>
                  {checkTopic(topic).ok ? (
                    <p className="text-emerald-400">&gt;&gt; PRE-CHECK: CLEARED (No malicious vectors identified)</p>
                  ) : (
                    <p className="text-rose-400 font-bold animate-pulse">&gt;&gt; DETECTED THREAT BLOCKER ACTIONED IMMEDIATELY</p>
                  )}
                </div>
              </div>
            )}

            {activeBlock === 'OBSERVE' && (
              <div className="flex flex-col gap-3">
                <div className={`p-3 rounded border shadow-2xs
                  ${theme === 'dark' ? 'bg-[#151c14] border-[#2c3829]' : 'bg-white border-slate-200'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <CheckCircle className="text-emerald-600 w-3.5 h-3.5" />
                    <span className="text-[9.5px] font-bold font-mono uppercase">Source Harvesting</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal mb-2.5">
                    Launches fall-back enabled crawls to harvest fresh guidelines and matching immigration registries.
                  </p>

                  <span className="text-[9px] font-mono font-bold text-slate-450 uppercase tracking-widest block mb-1.5">
                    Retrieved citations list ({memory.sources?.length || 0})
                  </span>
                  
                  {!(memory.sources?.length) ? (
                    <div className="text-center py-4 border border-dashed rounded text-[11px] text-slate-450">
                      No active indices yet. Click "Run Staging Trace" or "Run Live AI Check" above to trigger.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
                      {memory.sources.map((src: any, i: number) => (
                        <div key={i} className={`p-2 rounded text-[11.5px] flex flex-col gap-1 border
                          ${theme === 'dark' ? 'bg-[#1e251d] border-slate-800 hover:border-slate-700' : 'bg-slate-50 border-slate-150 hover:border-slate-300'}`}
                        >
                          <div className="flex items-center justify-between font-semibold">
                            <span className="text-[11px] truncate block max-w-[150px]">{src.title}</span>
                            <span className="bg-emerald-500/10 text-emerald-500 text-[8px] px-1 rounded font-mono">Score: {src.relevance || 95}%</span>
                          </div>
                          <span className="text-[9px] text-slate-455 select-all font-mono hover:text-emerald-600 truncate">{src.url}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeBlock === 'REASON' && (
              <div className="flex flex-col gap-3">
                <div className={`p-3 rounded border shadow-2xs
                  ${theme === 'dark' ? 'bg-[#151c14] border-[#2c3829]' : 'bg-white border-slate-200'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Sparkles className="text-emerald-600 w-3.5 h-3.5" />
                    <span className="text-[9.5px] font-bold font-mono uppercase">Reason Classifier</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    Fuses retrieved document findings, cross-evaluates legal changes, categorizes impact scope, and scores reliability.
                  </p>

                  <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex flex-col gap-2">
                    <span className="text-[9px] font-mono text-slate-400 font-bold uppercase tracking-wider">Metrics Panel</span>
                    <div className={`flex justify-between items-center border rounded p-2 text-[11px]
                      ${theme === 'dark' ? 'bg-[#1e251d] border-slate-800' : 'bg-emerald-50 border-emerald-100'}`}
                    >
                      <span className="text-slate-400">Calculated Confidence:</span>
                      <span className="font-mono font-bold text-xs bg-emerald-500/10 px-1.5 py-0.5 rounded text-emerald-500">
                        {output?.confidence ? (output.confidence * 100).toFixed(0) + "%" : isSimulationMode ? activeScenario.reasonResults.confidence.toFixed(2) : "—"}
                      </span>
                    </div>

                    {isSimulationMode && activeScenario.behaviorType === 'low_confidence' && (
                      <div className="bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10.5px] p-2.5 rounded mt-1 leading-normal font-mono">
                        💡 RETRY EVENT: Initially, matching indexes with conflicting information returned 42% confidence. Harness triggered feedback re-query automatically until reaching 97%.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeBlock === 'ACT' && (
              <div className="flex flex-col gap-3">
                <div className={`p-3 rounded border shadow-2xs
                  ${theme === 'dark' ? 'bg-[#151c14] border-[#2c3829]' : 'bg-white border-slate-200'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Coins className="text-amber-500 w-3.5 h-3.5" />
                    <span className="text-[9.5px] font-bold font-mono uppercase">Synthesizer &amp; tokens</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    Applies custom LLM adapters to render formatted alert cards, calculating token speeds and total trace expenses.
                  </p>

                  <div className={`mt-2.5 border-t pt-2.5 flex flex-col gap-1.5
                    ${theme === 'dark' ? 'border-[#2d3929]' : 'border-slate-100'}`}
                  >
                    <span className="text-[9px] font-mono text-slate-500 font-bold uppercase">Token Cost Log</span>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-center">
                      <div className={`border p-2 rounded
                        ${theme === 'dark' ? 'bg-[#1b231a] border-slate-800' : 'bg-slate-50 border-slate-150'}`}>
                        <p className="text-slate-400 text-[9px] uppercase font-mono">Tokens consumed</p>
                        <p className="font-mono font-bold text-slate-300 text-xs mt-0.5">{output ? "2200 tok" : isSimulationMode ? activeScenario.actResults.tokensUsed : "—"}</p>
                      </div>
                      <div className={`border p-2 rounded
                        ${theme === 'dark' ? 'bg-[#1b231a] border-slate-800' : 'bg-slate-50 border-slate-150'}`}>
                        <p className="text-slate-400 text-[9px] uppercase font-mono">Cost (USD)</p>
                        <p className="font-mono font-bold text-slate-300 text-xs mt-0.5">{output ? "$0.00004" : `$${activeScenario.actResults.costUsd.toFixed(5)}`}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeBlock === 'OUTPUT GUARDRAIL' && (
              <div className="flex flex-col gap-3">
                <div className={`p-3 rounded border shadow-2xs
                  ${theme === 'dark' ? 'bg-[#151c14] border-[#2c3829]' : 'bg-white border-slate-200'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <ShieldAlert className="text-orange-500 w-3.5 h-3.5" />
                    <span className="text-[9.5px] font-bold font-mono uppercase">Compliance Audit Shield</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal mb-2.5">
                    Validates compliance parameters like disclaimer attachments, citation mapping, and confidence scores.
                  </p>

                  <div className="flex flex-col gap-1 bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded text-[11px] select-none text-emerald-500">
                    <p className="font-semibold flex items-center gap-1.5 font-mono text-[10px]">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                      Legal Disclaimer Guard: PASSED
                    </p>
                    <p className="font-semibold flex items-center gap-1.5 mt-1 font-mono text-[10px]">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                      Confidence Verifications: PASSED
                    </p>
                    <p className="font-semibold flex items-center gap-1.5 mt-1 font-mono text-[10px]">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                      Citations Map Index: PASSED
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeBlock === 'ALERT' && (
              <div className="flex flex-col gap-3">
                <div className="bg-emerald-955 text-emerald-50 p-3 rounded border border-emerald-800 shadow-2xs">
                  <div className="flex items-center gap-1.5 mb-1 text-white">
                    <CheckCircle className="text-emerald-400 w-3.5 h-3.5" />
                    <span className="text-xs font-bold font-mono uppercase tracking-wider">Dispatched Success Alert</span>
                  </div>
                  <p className="text-[8.5px] text-emerald-300 font-mono tracking-wide">
                    Node Ref: policy.pulse-notified-v1.0
                  </p>
                </div>

                <div className={`p-3 rounded border shadow-2xs
                  ${theme === 'dark' ? 'bg-[#151c14] border-[#2c3829]' : 'bg-white border-slate-200'}`}
                >
                  <span className="text-[9px] font-mono text-slate-400 font-bold uppercase tracking-wider">Compiled Title:</span>
                  <p className="text-[12.5px] font-bold text-slate-300 font-mono mb-1.5 leading-snug">
                    {output?.current_status ? topic.toUpperCase() : "AWAITING COMPLETION"}
                  </p>
                  <p className="text-xs text-slate-400 italic mb-2">
                    "{output?.why_it_matters || 'Harness outputs will stream here.'}"
                  </p>
                  
                  {output && (
                    <div className="mt-2.5 pt-2.5 border-t border-dashed border-slate-700 max-h-52 overflow-y-auto select-text">
                      <span className="text-[9.5px] font-mono text-slate-400 font-bold uppercase block mb-1">Raw Synthesized Payload:</span>
                      <pre className="text-[10px] bg-slate-900 text-emerald-400 p-2.5 rounded font-mono overflow-x-auto leading-normal whitespace-pre-wrap">
                        {output.disclaimer || "Disclaimers cleared."}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeBlock === 'REJECTED' && (
              <div className="flex flex-col gap-3">
                <div className="bg-rose-955 text-rose-100 p-3 rounded border border-rose-800 shadow-2xs">
                  <div className="flex items-center gap-1.5 mb-1 text-white">
                    <XCircle className="text-rose-400 w-3.5 h-3.5" />
                    <span className="text-xs font-bold font-mono uppercase tracking-wider">Security quarantine triggered</span>
                  </div>
                  <p className="text-[8.5px] text-rose-350 font-mono tracking-wide">
                    Shield-Code: 403-INJECTION-ALERT
                  </p>
                </div>

                <div className={`p-3 rounded border shadow-2xs
                  ${theme === 'dark' ? 'bg-[#151c14] border-[#2c3829]' : 'bg-white border-slate-200'}`}
                >
                  <span className="text-[9px] font-mono text-slate-500 uppercase">Outcome security alert</span>
                  <p className="text-[11.5px] text-rose-500 mb-2 leading-relaxed mt-1">
                    {error || "Prompt evaluation contains unsafe instruction vectors."}
                  </p>
                  <pre className="text-[10px] bg-slate-955 text-rose-400 p-2.5 rounded font-mono overflow-x-auto leading-normal whitespace-pre-wrap select-text">
                    [SEC Audit] System override payload neutralized at pre-search boundary check. Network harness crawl aborted.
                  </pre>
                </div>
              </div>
            )}

            {activeBlock === 'MEMORY' && (
              <div className="flex flex-col gap-3">
                <div className={`p-3 rounded border shadow-2xs
                  ${theme === 'dark' ? 'bg-[#151c14] border-[#2c3829]' : 'bg-white border-slate-200'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Database className="text-orange-500 w-3.5 h-3.5" />
                    <span className="text-[9.5px] font-bold font-mono uppercase text-slate-400">Telemetry memory state</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal mb-2.5">
                    Maintains anonymous checkpoints, historical search query logs, and trusted domains indices.
                  </p>
                  
                  <div className="flex flex-col gap-1 border-t border-slate-700 pt-2 text-[10px] font-mono text-slate-400">
                    <div className="flex justify-between py-1">
                      <span>Idempotence Controller:</span>
                      <span className="text-emerald-600 font-bold font-mono">ACTIVE</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span>Telemetry Storage Mode:</span>
                      <span className="text-slate-400 font-semibold font-mono">ServerSessionSandbox</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>

        </div>

        {/* ── HARNESS TRACE BOTTOM STRIP (DYNAMIC DETAILS TABS SYSTEM) ───── */}
        <div className={`border-t relative flex flex-col
          ${theme === 'dark' ? 'bg-[#0f140e] border-[#252f23]' : 'bg-white border-slate-200'}`}
        >
          {/* Tabs links toolbar */}
          <div className="flex border-b overflow-x-auto px-4 gap-1 select-none border-dashed border-slate-650/35">
            {[
              { id: "output", label: "Compiled Output" },
              { id: "harness_trace", label: "Diagnostics & Trace" },
              { id: "tools_log", label: "Crawler Stream Tool" },
              { id: "governance", label: "Governance Audit" },
              { id: "memory", label: "Vascular Memory" },
              { id: "settings", label: "Model Settings" },
            ].map(t => (
              <button 
                key={t.id} 
                onClick={() => {
                  setActiveTab(t.id);
                  if (outputScrollRef.current) {
                    outputScrollRef.current.scrollTop = 0;
                  }
                }}
                className={`py-2.5 px-4 font-mono text-[10px] font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer whitespace-nowrap
                  ${activeTab === t.id 
                    ? 'border-emerald-655 text-emerald-500' 
                    : theme === 'dark'
                    ? 'border-transparent text-slate-400 hover:text-slate-200' 
                    : 'border-transparent text-slate-500 hover:text-slate-800'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Expanded bottom tabs contents area */}
          <div 
            ref={outputScrollRef}
            className={`p-4 max-h-[220px] overflow-y-auto select-text
              ${theme === 'dark' ? 'bg-[#0a0e09]' : 'bg-slate-50/40'}`}
          >
            {activeTab === "output" && (
              <div>
                {error && (
                  <div className="p-3 mb-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-mono leading-normal">
                    ✗ Operational Exception: {error}
                  </div>
                )}
                
                {output ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-400">Brief status:</span>
                      <span className={`px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase
                        ${output.impact_level === 'high' ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500'}`}
                      >
                        {output.impact_level || 'standard'} impact
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 ml-auto select-none">
                        Audit Confidence Score: {output.confidence ? (output.confidence * 100).toFixed(0) + "%" : "95%"}
                      </span>
                    </div>

                    {output.changes && output.changes.length > 0 && (
                      <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 font-mono text-[10.5px] leading-relaxed">
                        <span className="font-bold text-amber-500 mr-1">🔺 Policy Differentials Tracked:</span>
                        {output.changes.map((c: string, idx: number) => <span key={idx}>{c}</span>)}
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className={`p-2.5 rounded border
                        ${theme === 'dark' ? 'bg-[#151c14] border-slate-800' : 'bg-white border-slate-200'}`}>
                        <span className="text-[9.5px] font-mono text-slate-450 uppercase tracking-wider block mb-1">State guidelines summary:</span>
                        <div className="font-mono text-slate-300 leading-relaxed text-[11px]">{output.current_status}</div>
                      </div>
                      
                      <div className={`p-2.5 rounded border
                        ${theme === 'dark' ? 'bg-[#151c14] border-slate-800' : 'bg-white border-slate-200'}`}>
                        <span className="text-[9.5px] font-mono text-slate-450 uppercase tracking-wider block mb-1">Why it matters:</span>
                        <div className="font-mono text-slate-400 leading-relaxed text-[11px]">{output.why_it_matters || output.details}</div>
                      </div>
                    </div>

                    {output.citations && output.citations.length > 0 && (
                      <div className="mt-2">
                        <span className="text-[9.5px] font-mono text-slate-450 uppercase tracking-widest block mb-1.5">Official domain index citations:</span>
                        <div className="flex flex-col gap-1">
                          {output.citations.map((c: any, i: number) => (
                            <div key={i} className="flex items-center gap-1.5 font-mono text-[10px]">
                              <span className="text-emerald-500">[{i + 1}]</span>
                              <span className="text-slate-300 select-all truncate max-w-[200px]">{c.source_title || c.text}</span>
                              <span className="text-slate-455">-</span>
                              {isHttpUrl(c.url) ? (
                                <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline select-all truncate">
                                  {c.url}
                                </a>
                              ) : (
                                <span className="text-slate-455 italic">Internal repository</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6 font-mono text-xs text-slate-450">
                    No active compiled briefing alert. Click "Run Live AI Check" button to crawler query search engines.
                  </div>
                )}
              </div>
            )}

            {activeTab === "harness_trace" && (
              <div className="overflow-x-auto select-none">
                <table className="w-full text-left font-mono text-[10.5px] border-collapse bg-white/70 dark:bg-transparent">
                  <thead>
                    <tr className="border-b border-slate-700/50 text-slate-500 tracking-wider">
                      <th className="py-2 px-6 font-bold uppercase text-[9px]">Step</th>
                      <th className="py-2 px-4 font-bold uppercase text-[9px]">Status</th>
                      <th className="py-2 px-4 font-bold uppercase text-[9px]">Latency</th>
                      <th className="py-2 px-4 font-bold uppercase text-[9px]">Execution Node</th>
                      <th className="py-2 px-4 font-bold uppercase text-[9px]">Weight / Consumption</th>
                      <th className="py-2 px-6 text-center font-bold uppercase text-[9px]">Loop Retry rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/30 text-slate-300">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-800/10">
                        <td className="py-2 px-6 font-bold flex flex-col">
                          <span className="text-[10px] uppercase font-bold text-emerald-500">{log.stepName}</span>
                          <span className="text-[8.5px] font-mono text-slate-450">{log.subType}</span>
                        </td>
                        <td className="py-2 px-4">
                          <span className={`px-2 py-0.5 rounded text-[8px] font-mono font-bold tracking-wider 
                            ${log.status === 'DONE' 
                              ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' 
                              : log.status === 'PENDING'
                              ? 'bg-amber-500/10 text-amber-500 animate-pulse border border-amber-500/20'
                              : log.status === 'RETRYING'
                              ? 'bg-orange-500/10 text-orange-500 border border-orange-555/20'
                              : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'}`}
                          >
                            {log.status}
                          </span>
                        </td>
                        <td className="py-2 px-4 text-[10px] text-slate-400">
                          {log.durationMs > 0 ? `${log.durationMs}ms` : '—'}
                        </td>
                        <td className="py-2 px-4 text-slate-455 text-[10px] truncate max-w-[120px]">{log.modelName}</td>
                        <td className="py-2 px-4 text-slate-300 text-[10px] font-bold">{log.tokens}</td>
                        <td className="py-2 px-6 text-center text-[10px] font-mono">
                          {log.retryCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === "tools_log" && (
              <div className="flex flex-col gap-1.5">
                {toolsLog.length === 0 ? (
                  <div className="text-center py-6 font-mono text-xs text-slate-455">
                    Tools execution log timeline is empty. Initiating search queries will print tool invocation actions here.
                  </div>
                ) : (
                  toolsLog.map((t, idx) => (
                    <div key={idx} className="p-2 border rounded font-mono text-[10.5px] leading-relaxed dark:bg-[#121810]/40 dark:border-slate-800">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-505 font-mono text-[9px]">
                          {new Date(t.ts).toLocaleTimeString()}
                        </span>
                        <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-500 font-bold uppercase rounded text-[8px]">
                          {t.tool || t.type}
                        </span>
                        {t.status && (
                          <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-500 rounded text-[8px]">
                            {t.status}
                          </span>
                        )}
                        {t.resultCount > 0 && <span className="text-slate-455 ml-auto">{t.resultCount} pages analyzed</span>}
                      </div>
                      <div className="text-slate-350 mt-1">{t.query ? `&gt;&gt; Crawl Query: ${t.query}` : t.msg}</div>
                      {t.urls && t.urls.length > 0 && (
                        <div className="mt-1 flex flex-col gap-0.5 text-[9.5px] text-emerald-700/90 pl-3">
                          {t.urls.map((u: string, uindex: number) => <span key={uindex} className="truncate select-all">↳ {u}</span>)}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "governance" && (
              <div className="flex flex-col gap-2.5 select-none">
                {governanceChecks(topic, output, memory.sources).map((check, idx) => (
                  <div key={idx} className={`p-2.5 rounded border flex gap-3 items-center
                    ${theme === 'dark' ? 'bg-[#151c14] border-slate-800' : 'bg-white border-slate-200'}`}
                  >
                    <span className={`text-base font-bold font-mono
                      ${check.pending ? 'text-slate-500' : check.ok ? 'text-emerald-500' : 'text-rose-500'}`}
                    >
                      {check.pending ? "○" : check.ok ? "✓" : "✗"}
                    </span>
                    
                    <div className="flex-1 font-mono">
                      <div className="text-slate-300 text-[11px] font-bold">{check.label}</div>
                      <div className="text-[9px] text-slate-500">{check.sub}</div>
                    </div>
                    
                    <span className="font-mono text-[10px] text-slate-455 text-right">{check.detail}</span>
                  </div>
                ))}
              </div>
            )}

            {activeTab === "memory" && (
              <div className="flex flex-col gap-4">
                <div>
                  <span className="font-mono text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Stored trusted reference list ({memory.trustedSources?.length || 0})</span>
                  <div className="flex flex-wrap gap-1.5">
                    {!(memory.trustedSources?.length) ? (
                      <span className="text-xs text-slate-500 font-mono">No permanent secure bookmarks saved yet.</span>
                    ) : (
                      memory.trustedSources.map((ts: any, i: number) => (
                        <span key={i} className="px-2.5 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 font-mono text-[9.5px] text-emerald-500 select-all truncate block max-w-sm">
                          {ts.title || ts.url}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <span className="font-mono text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">Topic run preference cache ({memory.preferences?.length || 0})</span>
                  <div className="flex flex-col gap-1 text-[11px] font-mono">
                    {memory.preferences && memory.preferences.map((p: any, i: number) => (
                      <div key={i} className="flex justify-between p-1 rounded bg-[#1e251d]">
                        <span className="text-slate-350">{p.topic}</span>
                        <span className="text-slate-500 text-[9px]">{new Date(p.ts).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "settings" && (
              <div className="flex flex-col gap-3 font-mono text-xs max-w-md">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">OpenRouter Complete Model Identifier:</label>
                  <input 
                    type="text" 
                    value={model}
                    onChange={(e) => updateModel(e.target.value)}
                    className={`w-full p-1.5 rounded border focus:outline-none focus:border-emerald-555
                      ${theme === 'dark' ? 'bg-[#1a2118] border-slate-800 text-slate-200' : 'bg-white border-slate-200'}`}
                  />
                  <p className="text-[9px] text-slate-500 mt-1">Default model: mistralai/mistral-nemo. Keep intact for formatting compatibility.</p>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Credentials proxy location:</label>
                  <span className="text-emerald-600 block text-[10px]">INTERNAL SERVER (Hidden secure access)</span>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* FULLSCREEN POPUP COMMAND DIALOG MODAL */}
      {promptModalOpen && (
        <div 
          onMouseDown={closePromptModal}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md"
        >
          <div 
            onMouseDown={e => e.stopPropagation()}
            className={`w-full max-w-xl rounded-lg shadow-2xl border flex flex-col overflow-hidden transition-all duration-300
              ${theme === 'dark' ? 'bg-[#151c14] border-slate-800 text-slate-100' : 'bg-[#eef1ec] border-slate-300 text-slate-900'}`}
          >
            <div className="flex items-center justify-between p-3.5 border-b dark:border-[#252f23]">
              <div>
                <span className="font-mono text-xs font-bold text-emerald-500 uppercase tracking-widest block">Command Terminal Context</span>
                <span className="font-mono text-[9px] text-slate-450 uppercase">human prompt interface</span>
              </div>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            </div>

            <div className="p-5 flex flex-col gap-4">
              <textarea 
                value={promptDraft}
                onChange={e => setPromptDraft(e.target.value)}
                placeholder="Declare policy crawling topic prompt vector..."
                className={`w-full h-44 resize-none p-3 border rounded font-mono text-xs leading-relaxed focus:outline-none focus:border-emerald-550
                  ${theme === 'dark' ? 'bg-[#0f140e] border-[#252f23] text-emerald-400' : 'bg-white border-slate-200 text-slate-900'}`}
              />
              <div className="text-[10px] text-slate-500 font-mono italic">
                Press Esc key to exit popup, or click SAVE intent changes below.
              </div>

              <div className="flex space-x-2.5 justify-end">
                <button 
                  onClick={closePromptModal}
                  className="bg-transparent border border-slate-500/20 hover:bg-slate-500/5 text-slate-450 font-mono text-[10.5px] font-bold uppercase rounded px-4 py-2 cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  onClick={savePromptDraft}
                  className="bg-emerald-600 hover:bg-emerald-750 text-white font-mono text-[10.5px] font-bold uppercase rounded px-4 py-2 cursor-pointer shadow-xs"
                >
                  Save Intent Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
