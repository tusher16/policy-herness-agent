import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

// ─── FONTS & GLOBAL CSS ──────────────────────────────────────────────────────
const GLOBAL = theme => `
@import url('https://fonts.googleapis.com/css2?family=Oxanium:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:${theme === "light" ? "#e8edf7" : "#0a0a18"}}
::-webkit-scrollbar-thumb{background:${theme === "light" ? "#b8c2d4" : "#252540"};border-radius:2px}
@keyframes glow{0%,100%{box-shadow:0 0 10px #00e67630,inset 0 0 8px #00e67610}50%{box-shadow:0 0 22px #00e67660,inset 0 0 16px #00e67620}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes fadein{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
@keyframes slide{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
.phase-active{animation:glow 1.6s ease-in-out infinite!important;border-color:#00e67660!important}
.spin{animation:spin 0.9s linear infinite}
.fadein{animation:fadein 0.35s ease-out}
.slide{animation:slide 0.2s ease-out}
.blink{animation:blink 1.2s ease-in-out infinite}
`;

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
const PALETTES = {
  dark: {
    bg:      "#070712",
    panel:   "#0d0d1e",
    card:    "#111124",
    border:  "#1d1d34",
    borderB: "#2a2a4a",
    green:   "#00e676",
    greenD:  "#00e67615",
    blue:    "#448aff",
    blueD:   "#448aff15",
    orange:  "#ff9100",
    orangeD: "#ff910015",
    red:     "#ff4444",
    redD:    "#ff444415",
    text:    "#7878a0",
    textB:   "#c8c8e0",
    textD:   "#333358",
    white:   "#eeeeff",
  },
  light: {
    bg:      "#f5f7fb",
    panel:   "#ffffff",
    card:    "#eef2f7",
    border:  "#d7deeb",
    borderB: "#b9c4d6",
    green:   "#087f5b",
    greenD:  "#e5f7ef",
    blue:    "#2563eb",
    blueD:   "#e8efff",
    orange:  "#c75d00",
    orangeD: "#fff0dc",
    red:     "#c62828",
    redD:    "#ffe7e7",
    text:    "#586477",
    textB:   "#172033",
    textD:   "#9aa5b8",
    white:   "#0b1020",
  },
};

let T = PALETTES.dark;

// ─── API ─────────────────────────────────────────────────────────────────────
const OLD_FREE_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const DEFAULT_MODEL = "mistralai/mistral-nemo";
const API_BASE = ((import.meta.env.VITE_POLICY_PULSE_API_BASE || "/api").trim()).replace(/\/+$/, "");
const apiPath = path => `${API_BASE}${path}`;
const API    = apiPath("/openrouter");
const TAVILY = apiPath("/tavily");
const EXA    = apiPath("/exa");
const SESSION_STATE = apiPath("/session-state");
const PYTHON_RUN = apiPath("/run");
const API_TOKEN = (import.meta.env.VITE_POLICY_PULSE_API_TOKEN || "").trim();

const mkHeaders = () => ({
  "Content-Type": "application/json",
  ...(API_TOKEN ? {"X-PolicyPulse-Token": API_TOKEN} : {}),
});

const pullText = data => {
  const msg = data?.choices?.[0]?.message;
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content)) {
    return msg.content.map(b => b?.text || b?.content || "").join("\n");
  }
  return "";
};

// Official / government domain detector — hostname-based to avoid path/query spoofing.
const OFFICIAL_HOSTS = [
  "europa.eu", "bamf.de", "daad.de", "make-it-in-germany.com", "berlin.de", "bund.de",
  "auswaertiges-amt.de", "diplo.de", "germany.info", "studierendenwerke.de",
];
const hostMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);
const isOfficialUrl = url => {
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

// Map Tavily search results into PolicyPulse source objects (deduped by url).
const tavilyToSources = data => {
  const seen = new Set();
  return (data?.results || [])
    .filter(r => r?.url && !seen.has(r.url) && seen.add(r.url))
    .map(r => ({
      url: r.url,
      title: r.title || r.url,
      type: isOfficialUrl(r.url) ? "government" : "source",
      key_info: r.content ? r.content.slice(0, 500) : "Found via Tavily search.",
      reliability: isOfficialUrl(r.url) ? 0.9 : 0.72,
    }));
};

const tryJSON = txt => {
  try { const m = txt.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; }
  catch { return null; }
};

// Lightweight schema validation: which required keys are missing/empty.
const missingKeys = (obj, keys) => obj
  ? keys.filter(k => obj[k] === undefined || obj[k] === null || (Array.isArray(obj[k]) && obj[k].length === 0))
  : keys.slice();

// Call the LLM for strict JSON, validating against a key schema and RETRYING
// (with a corrective prompt) when the output is truncated or schema-invalid.
// Returns { data, json, attempts, valid }. attempts-1 = retries used.
const callJSON = async ({ model, messages, requiredKeys = [], maxRetries = 2, maxTokens = 2500 }) => {
  let lastData = null, lastText = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const convo = attempt === 0 ? messages : [
      ...messages,
      { role: "assistant", content: lastText.slice(0, 1200) },
      { role: "user", content: `Your previous reply was invalid or incomplete. Respond with ONLY one complete JSON object${requiredKeys.length ? ` containing keys: ${requiredKeys.join(", ")}` : ""}. No markdown, no prose.` },
    ];
    const res = await fetch(API, {
      method: "POST", headers: mkHeaders(),
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Normalize loaded memory: drop legacy duplicates (topic history / trusted URLs),
// keeping the first occurrence of each. Makes memory robust against past bloat.
const dedupeMemory = m => {
  const seenTopic = new Set();
  const seenUrl = new Set();
  return {
    ...m,
    preferences: (m.preferences || []).filter(p => p && !seenTopic.has(p.topic) && seenTopic.add(p.topic)),
    trustedSources: (m.trustedSources || []).filter(s => s?.url && !seenUrl.has(s.url) && seenUrl.add(s.url)),
  };
};

// diff_engine: what changed between the previous alert and the new one (same topic).
const diffAlerts = (prev, next) => {
  if (!prev) return ["First run for this topic — baseline saved."];
  const out = [];
  if (prev.current_status !== next.current_status) {
    out.push(`Status changed:\n  was: ${prev.current_status}\n  now: ${next.current_status}`);
  }
  if (prev.impact_level !== next.impact_level) {
    out.push(`Impact level: ${prev.impact_level || "—"} → ${next.impact_level || "—"}`);
  }
  const toMap = arr => Object.fromEntries((arr || []).map(k => [k.label, k.value]));
  const pn = toMap(prev.key_numbers), nn = toMap(next.key_numbers);
  for (const [label, val] of Object.entries(nn)) {
    if (pn[label] === undefined) out.push(`New figure — ${label}: ${val}`);
    else if (pn[label] !== val) out.push(`${label}: ${pn[label]} → ${val}`);
  }
  return out.length ? out : ["No material changes since last run."];
};

// Only allow http(s) links; blocks javascript:/data: URLs from model output.
const isHttpUrl = u => /^https?:\/\//i.test(u || "");

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

const makeTraceRows = model => TRACE_STEPS.map(([key, step, tool]) => ({
  key,
  step,
  status: "pending",
  duration: "—",
  model: model || "—",
  tool,
  tokensCost: "—",
  retries: 0,
  error: "",
  startedAt: null,
}));

const formatUsage = data => {
  const usage = data?.usage;
  if (!usage) return "—";
  const tokens = usage.total_tokens ?? usage.totalTokens ??
    ((usage.prompt_tokens || usage.input_tokens || 0) + (usage.completion_tokens || usage.output_tokens || 0));
  const cost = usage.cost ?? usage.total_cost ?? usage.estimated_cost;
  return `${tokens || "—"} tok${cost ? ` / $${Number(cost).toFixed(5)}` : ""}`;
};

const withCitationFallback = (output, sources) => {
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

const readLocal = (key, fallback = "") => {
  try { return localStorage.getItem(key) || fallback; }
  catch { return fallback; }
};

const writeLocal = (key, value) => {
  try { localStorage.setItem(key, value); }
  catch {}
};

const readModelLocal = () => {
  const value = readLocal("policypulse.model", DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const next = value === OLD_FREE_MODEL ? DEFAULT_MODEL : value;
  if (next !== value) writeLocal("policypulse.model", next);
  return next;
};

const loadSessionState = async () => {
  const res = await fetch(SESSION_STATE);
  if (!res.ok) throw new Error(`Session load failed: HTTP ${res.status}`);
  return res.json();
};

const saveSessionState = state => fetch(SESSION_STATE, {
  method: "POST",
  headers: {"Content-Type": "application/json"},
  body: JSON.stringify(state),
});

// ─── SEARCH PROVIDERS (toggleable, with automatic fallback) ──────────────────
// Each provider returns a uniform { sources, summary }. isOfficialUrl classifies hostnames.
const exaToSources = data => {
  const seen = new Set();
  return (data?.results || [])
    .filter(r => r?.url && !seen.has(r.url) && seen.add(r.url))
    .map(r => ({
      url: r.url,
      title: r.title || r.url,
      type: isOfficialUrl(r.url) ? "government" : "source",
      key_info: (r.text || r.summary || "Found via Exa search.").slice(0, 500),
      reliability: isOfficialUrl(r.url) ? 0.9 : 0.72,
    }));
};

const annotationsToSources = data => {
  const seen = new Set();
  return (data?.choices?.[0]?.message?.annotations || [])
    .filter(a => a.type === "url_citation" && a.url_citation?.url
      && !seen.has(a.url_citation.url) && seen.add(a.url_citation.url))
    .map(a => a.url_citation)
    .map(c => ({
      url: c.url,
      title: c.title || c.url,
      type: isOfficialUrl(c.url) ? "government" : "source",
      key_info: c.content ? c.content.slice(0, 500) : "Found via OpenRouter web search.",
      reliability: isOfficialUrl(c.url) ? 0.9 : 0.72,
    }));
};

const searchTavily = async query => {
	  const res = await fetch(TAVILY, {
	    method: "POST",
	    headers: mkHeaders(),
	    body: JSON.stringify({ query, search_depth: "advanced", max_results: 6, include_answer: true }),
	  });
  if (!res.ok) throw new Error(`Tavily: HTTP ${res.status}`);
  const data = await res.json();
  return { sources: tavilyToSources(data), summary: data.answer || "" };
};

const searchExa = async query => {
	  const res = await fetch(EXA, {
	    method: "POST",
	    headers: mkHeaders(),
	    body: JSON.stringify({ query, type: "auto", numResults: 6, contents: { text: { maxCharacters: 500 } } }),
	  });
  if (!res.ok) throw new Error(`Exa: HTTP ${res.status}`);
  const data = await res.json();
  return { sources: exaToSources(data), summary: "" };
};

// Legacy method: the LLM itself runs web_search and returns citation annotations.
const searchOpenRouter = async query => {
	  const res = await fetch(API, {
	    method: "POST",
	    headers: mkHeaders(),
    body: JSON.stringify({
      model: DEFAULT_MODEL, max_tokens: 1000,
      messages: [
        {role: "system", content: "Use web search to find 3-5 current official sources about the policy topic. Prefer government, BAMF, DAAD, EU, embassy, or official institutional pages."},
        {role: "user", content: `Policy topic to research: "${query}"`},
      ],
      tools: [{type: "openrouter:web_search"}],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter search: HTTP ${res.status}`);
  const data = await res.json();
  return { sources: annotationsToSources(data), summary: (pullText(data) || "").slice(0, 220) };
};

const SEARCH_PROVIDERS = {
  tavily:     { label: "Tavily (AI search)",      run: searchTavily },
  exa:        { label: "Exa.ai (neural search)",  run: searchExa },
  openrouter: { label: "LLM web search (legacy)", run: searchOpenRouter },
};
const PROVIDER_ORDER = ["tavily", "exa", "openrouter"];

// Try the chosen provider; on error or zero results, fall back to the others
// (e.g. when Tavily credits run out, Exa or the legacy LLM scrape takes over).
const runSearch = async (query, preferred) => {
  const order = [preferred, ...PROVIDER_ORDER.filter(p => p !== preferred)];
  let lastErr;
  for (const key of order) {
    try {
      const { sources, summary } = await SEARCH_PROVIDERS[key].run(query);
      if (sources.length) return { sources, summary, provider: key };
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return { sources: [], summary: "", provider: preferred };
};

// ─── PROMPTS ─────────────────────────────────────────────────────────────────
const SYS_RSN = `You are PolicyPulse's Reason module. Analyse and rank the sources, extract key rules with numbers and dates. Return ONLY raw JSON starting with {:
{"ranked_sources":[{"url":"...","title":"...","rank":1,"why":"..."}],"key_findings":["specific finding with number/date"],"current_rules":[{"rule":"...","value":"number or date","source_url":"..."}],"impact_level":"medium","affected_groups":["group"],"confidence":0.87,"analysis_summary":"2-3 sentence summary"}`;

const SYS_ACT = `You are PolicyPulse's Act module. Generate a clear, actionable PolicyPulse alert. Return ONLY raw JSON starting with {:
{"current_status":"one sentence on current rule/policy state","why_it_matters":"practical importance","who_is_affected":"specific description","key_numbers":[{"label":"label","value":"value"}],"recommended_action":"specific next step","citations":[{"text":"specific quoted fact","source_title":"...","url":"https://..."}],"impact_level":"medium","confidence":0.87,"disclaimer":"Informational summary only, not legal advice. Always verify with official sources before taking action."}
Include 2-3 key_numbers if specific numbers/thresholds exist. Include 2-3 citations.`;

// ─── MICRO COMPONENTS ────────────────────────────────────────────────────────
const Badge = ({ color = "green", children }) => {
  const cc = {
    green:  [T.greenD,  `${T.green}44`,  T.green],
    blue:   [T.blueD,   `${T.blue}44`,   T.blue],
    orange: [T.orangeD, `${T.orange}44`, T.orange],
    red:    [T.redD,    `${T.red}44`,    T.red],
  }[color] || [T.greenD, `${T.green}44`, T.green];
  return (
    <span style={{padding:"1px 6px",background:cc[0],border:`1px solid ${cc[1]}`,borderRadius:3,
      color:cc[2],fontSize:9,fontFamily:"Oxanium,sans-serif",fontWeight:700,
      letterSpacing:"1.5px",textTransform:"uppercase",lineHeight:"14px",whiteSpace:"nowrap"}}>
      {children}
    </span>
  );
};

const Dot = ({ on, error }) => (
  <span style={{display:"inline-block",width:7,height:7,borderRadius:"50%",flexShrink:0,
    background: error ? T.red : on ? T.green : T.textD,
    boxShadow: on && !error ? `0 0 8px ${T.green}` : "none"}} />
);

const Spinner = () => (
  <span className="spin" style={{display:"inline-block",width:10,height:10,
    border:`1.5px solid ${T.textD}`,borderTopColor:T.green,borderRadius:"50%"}} />
);

const Lbl = ({ children, style }) => (
  <div style={{fontFamily:"Oxanium,sans-serif",fontSize:9,fontWeight:700,
    letterSpacing:"2px",color:T.text,textTransform:"uppercase",...style}}>
    {children}
  </div>
);

const PanelBox = ({ children, style }) => (
  <div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:6,
    padding:"10px",flexShrink:0,...style}}>
    {children}
  </div>
);

// ─── PHASE BOX ───────────────────────────────────────────────────────────────
const PhaseBox = ({ id, label, badgeColor, phase }) => {
  const st = phase?.status || "idle";
  const active = st === "active";
  const done   = st === "done";
  const d      = phase?.data;

  const preview = (() => {
    if (!d) return null;
    const raw =
      id === "context" ? d.topic :
      id === "observe" ? d.summary :
      id === "reason"  ? d.analysis_summary :
      id === "act"     ? d.current_status : null;
    return raw ? (raw.length > 80 ? raw.slice(0,80)+"…" : raw) : null;
  })();

  return (
    <div className={active ? "phase-active" : ""}
      style={{border:`1px solid ${done ? T.green+"44" : T.border}`,borderRadius:5,
        padding:"7px 10px",background:done ? T.greenD : T.card,transition:"all 0.3s"}}>
      <div style={{display:"flex",alignItems:"center",gap:7}}>
        {active ? <Spinner /> : <Dot on={done} />}
        <span style={{fontFamily:"Oxanium,sans-serif",fontWeight:700,fontSize:11,
          letterSpacing:"2px",color:done||active?T.white:T.text,flex:1}}>
          {label}
        </span>
        <Badge color={badgeColor}>LLM</Badge>
        {done && <span style={{fontSize:9,color:T.green,marginLeft:2}}>✓</span>}
      </div>
      {active && (
        <div className="blink" style={{paddingLeft:15,marginTop:4,fontSize:9,
          fontFamily:"JetBrains Mono,monospace",color:`${T.green}99`}}>
          processing…
        </div>
      )}
      {done && preview && (
        <div className="fadein" style={{marginTop:5,paddingLeft:14,
          borderLeft:`2px solid ${T.green}33`,fontSize:9,
          fontFamily:"JetBrains Mono,monospace",color:T.text,lineHeight:1.6}}>
          {preview}
        </div>
      )}
    </div>
  );
};

// ─── HARNESS LOOP (center) ───────────────────────────────────────────────────
const HarnessLoop = ({ phases }) => (
  <div style={{border:`1px solid ${T.borderB}`,borderRadius:8,padding:10,
    background:T.panel,position:"relative",height:"100%",display:"flex",
    flexDirection:"column"}}>
    <div style={{position:"absolute",top:-9,left:10,fontFamily:"Oxanium,sans-serif",
      fontSize:8,color:T.text,letterSpacing:"2px",background:T.bg,padding:"0 6px"}}>
      AGENT HARNESS
    </div>

    {/* Inner loop box */}
    <div style={{border:`1px solid ${T.textD}44`,borderRadius:6,padding:10,
      background:T.bg,flex:1,position:"relative"}}>
      <div style={{position:"absolute",top:-8,right:8,fontFamily:"JetBrains Mono,monospace",
        fontSize:7,color:T.textD,background:T.bg,padding:"0 4px"}}>
        ↺ LOOP
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {[
          {id:"context", label:"CONTEXT", bc:"blue"},
          {id:"observe", label:"OBSERVE", bc:"green"},
          {id:"reason",  label:"REASON",  bc:"green"},
          {id:"act",     label:"ACT",     bc:"green"},
        ].map((p,i) => (
          <div key={p.id}>
            {i > 0 && (
              <div style={{textAlign:"center",fontSize:10,lineHeight:"14px",marginBottom:6,
                color:phases[p.id]?.status==="done"?T.green:T.textD}}>▼</div>
            )}
            <PhaseBox id={p.id} label={p.label} badgeColor={p.bc} phase={phases[p.id]} />
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ─── LEFT PANEL ──────────────────────────────────────────────────────────────
const LeftPanel = ({ topic, setTopic, onRun, status }) => {
  const running = status === "running";
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8,height:"100%"}}>
      <PanelBox>
        <Lbl style={{marginBottom:8}}>Prompt</Lbl>
        <textarea value={topic} onChange={e=>setTopic(e.target.value)}
          disabled={running} placeholder="Enter topic e.g. German student visa work rules"
          style={{width:"100%",background:T.card,border:`1px solid ${T.border}`,borderRadius:4,
            color:T.textB,fontFamily:"JetBrains Mono,monospace",fontSize:11,padding:"7px",
            resize:"none",height:62,outline:"none",lineHeight:1.5,display:"block"}} />
        <button onClick={onRun} disabled={running||!topic.trim()}
          style={{width:"100%",marginTop:7,padding:"8px",
            background:running||!topic.trim()?T.card:T.green,
            border:`1px solid ${running||!topic.trim()?T.border:T.green}`,
            borderRadius:4,color:running||!topic.trim()?"#555":"#000",
            fontFamily:"Oxanium,sans-serif",fontWeight:800,fontSize:11,
            letterSpacing:"2px",cursor:running||!topic.trim()?"not-allowed":"pointer",
            transition:"all 0.2s"}}>
          {running ? "▶ RUNNING…" : "▶ RUN AGENT"}
        </button>
      </PanelBox>

      <PanelBox style={{flex:1}}>
        <Lbl style={{marginBottom:8}}>Orchestration</Lbl>
        {["Observe → Reason → Act loop","Source approval gate","Budget enforcer","Hallucination guard","Retry on failure"].map((f,i)=>(
          <div key={i} style={{fontSize:9,color:T.text,fontFamily:"JetBrains Mono,monospace",
            display:"flex",gap:5,marginBottom:4,lineHeight:1.4}}>
            <span style={{color:T.green}}>·</span>{f}
          </div>
        ))}
        <div style={{display:"flex",gap:4,marginTop:10}}><Badge color="blue">CPU</Badge></div>
      </PanelBox>
    </div>
  );
};

// ─── RIGHT PANEL ─────────────────────────────────────────────────────────────
const RightPanel = ({ toolsLog }) => {
  const used = new Set(toolsLog.map(l=>l.type));
  const tools = [
    {name:"web_search", badge:"LLM", bc:"green"},
    {name:"page_fetcher",badge:"CPU", bc:"blue"},
    {name:"playwright",  badge:"CUDA",bc:"orange"},
    {name:"pdf_reader",  badge:"CPU", bc:"blue"},
    {name:"diff_engine", badge:"CPU", bc:"blue"},
    {name:"summarizer",  badge:"LLM", bc:"green"},
    {name:"notifier",    badge:"NET", bc:"orange"},
  ];
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8,height:"100%"}}>
      <PanelBox>
        <Lbl style={{marginBottom:8}}>Tools &amp; Skills</Lbl>
        {tools.map(t=>(
          <div key={t.name} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 4px",
            borderRadius:3,background:used.has(t.name)?`${T.green}0a`:"transparent",marginBottom:2}}>
            <Dot on={used.has(t.name)} />
            <span style={{fontFamily:"JetBrains Mono,monospace",fontSize:9,
              color:used.has(t.name)?T.textB:T.text,flex:1}}>{t.name}</span>
            <Badge color={t.bc}>{t.badge}</Badge>
          </div>
        ))}
        <div style={{display:"flex",gap:3,marginTop:10,flexWrap:"wrap"}}>
          <Badge color="blue">CPU</Badge>
          <Badge color="orange">CUDA</Badge>
          <Badge color="green">LLM</Badge>
        </div>
      </PanelBox>

      <PanelBox style={{flex:1}}>
        <Lbl style={{marginBottom:8}}>Security &amp; Governance</Lbl>
        {["Approved URLs only","No legal advice label","Confidence scoring","Source citations required","Human approval gate"].map((r,i)=>(
          <div key={i} style={{fontSize:9,color:T.text,fontFamily:"JetBrains Mono,monospace",
            display:"flex",gap:5,marginBottom:4,lineHeight:1.4}}>
            <span style={{color:T.green}}>✓</span>{r}
          </div>
        ))}
        <div style={{display:"flex",gap:3,marginTop:10}}>
          <Badge color="blue">CPU</Badge>
          <Badge color="orange">DPU</Badge>
        </div>
      </PanelBox>
    </div>
  );
};

// ─── MEMORY BAR ──────────────────────────────────────────────────────────────
const MemoryBar = ({ memory }) => (
  <PanelBox style={{display:"flex",alignItems:"center",gap:10,padding:"7px 12px"}}>
    <Lbl style={{flexShrink:0}}>Memory</Lbl>
    <div style={{display:"flex",gap:14,flex:1}}>
      {[["Sources",memory.sources.length],["Prefs",memory.preferences.length],["Alerts",memory.alerts.length]].map(([l,n])=>(
        <span key={l} style={{fontFamily:"JetBrains Mono,monospace",fontSize:9}}>
          <span style={{color:T.text}}>{l}: </span>
          <span style={{color:n>0?T.green:T.textD}}>{n}</span>
        </span>
      ))}
    </div>
    <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
      <Badge color="blue">CPU</Badge>
      <Badge color="orange">DPU</Badge>
      <Badge color="orange">CUDA</Badge>
      <Badge color="green">LLM</Badge>
      <Badge color="blue">NET</Badge>
    </div>
  </PanelBox>
);

// ─── OUTPUT TAB ──────────────────────────────────────────────────────────────
const OutputTab = ({ output, error }) => {
  if (error) return (
    <div style={{color:T.red,fontFamily:"JetBrains Mono,monospace",fontSize:11,padding:4}}>
      ✗ {error}
    </div>
  );
  if (!output) return (
    <div style={{color:T.textD,fontFamily:"JetBrains Mono,monospace",fontSize:11}}>
      Run the agent to see results here.
    </div>
  );

  const impColor = {low:T.green,medium:T.orange,high:T.red}[output.impact_level]||T.text;
  const impBadge = {low:"green",medium:"orange",high:"red"}[output.impact_level]||"green";

  return (
    <div className="fadein" style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span style={{fontFamily:"Oxanium,sans-serif",fontWeight:800,fontSize:14,color:T.green}}>
          PolicyPulse Alert
        </span>
        <Badge color={impBadge}>{(output.impact_level||"medium").toUpperCase()} IMPACT</Badge>
        <span style={{fontFamily:"JetBrains Mono,monospace",fontSize:9,color:T.text,marginLeft:"auto"}}>
          confidence: {output.confidence ? (output.confidence*100).toFixed(0)+"%" : "—"}
        </span>
      </div>

      {output.changes?.length>0 && (
        <div style={{background:T.card,border:`1px solid ${T.orange}55`,borderRadius:4,padding:8}}>
          <Lbl style={{marginBottom:4,color:T.orange}}>🔺 What changed since last run</Lbl>
          {output.changes.map((c,i)=>(
            <div key={i} style={{fontSize:10,fontFamily:"JetBrains Mono,monospace",
              color:T.textB,lineHeight:1.6,whiteSpace:"pre-wrap"}}>• {c}</div>
          ))}
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        {[
          {l:"Current status",v:output.current_status,span:2},
          {l:"Why it matters",v:output.why_it_matters},
          {l:"Who is affected",v:output.who_is_affected},
        ].map(f=>f.v?(
          <div key={f.l} style={{gridColumn:f.span?`span ${f.span}`:undefined,
            background:T.card,border:`1px solid ${T.border}`,borderRadius:4,padding:8}}>
            <Lbl style={{marginBottom:4}}>{f.l}</Lbl>
            <div style={{fontSize:11,fontFamily:"JetBrains Mono,monospace",
              color:T.textB,lineHeight:1.6}}>{f.v}</div>
          </div>
        ):null)}
      </div>

      {output.key_numbers?.length>0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {output.key_numbers.map((kn,i)=>(
            <div key={i} style={{background:T.greenD,border:`1px solid ${T.green}33`,
              borderRadius:4,padding:"5px 14px",textAlign:"center"}}>
              <div style={{fontSize:16,fontFamily:"Oxanium,sans-serif",fontWeight:800,
                color:T.green}}>{kn.value}</div>
              <div style={{fontSize:8,fontFamily:"Oxanium,sans-serif",color:T.text,
                letterSpacing:1}}>{kn.label}</div>
            </div>
          ))}
        </div>
      )}

      {output.recommended_action && (
        <div style={{background:T.orangeD,border:`1px solid ${T.orange}33`,borderRadius:4,padding:8}}>
          <Lbl style={{color:T.orange,marginBottom:4}}>Recommended action</Lbl>
          <div style={{fontSize:11,fontFamily:"JetBrains Mono,monospace",
            color:T.textB,lineHeight:1.6}}>{output.recommended_action}</div>
        </div>
      )}

      {output.citations?.length>0 && (
        <div>
          <Lbl style={{marginBottom:6}}>Citations</Lbl>
          {output.citations.map((c,i)=>(
            <div key={i} style={{display:"flex",gap:8,background:T.card,
              border:`1px solid ${T.border}`,borderRadius:3,padding:"5px 8px",
              marginBottom:4,alignItems:"flex-start"}}>
              <span style={{color:T.blue,fontFamily:"JetBrains Mono,monospace",
                fontSize:9,flexShrink:0,marginTop:1}}>[{i+1}]</span>
              <div>
                <div style={{fontSize:10,fontFamily:"JetBrains Mono,monospace",
                  color:T.textB,lineHeight:1.5}}>{c.text}</div>
                {isHttpUrl(c.url) && (
                  <a href={c.url} target="_blank" rel="noopener noreferrer"
                    style={{fontSize:9,color:T.blue,fontFamily:"JetBrains Mono,monospace",
                      textDecoration:"none"}}>
                    {c.source_title||c.url}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {output.disclaimer && (
        <div style={{fontSize:9,color:T.textD,fontFamily:"JetBrains Mono,monospace",
          fontStyle:"italic",borderTop:`1px solid ${T.border}`,paddingTop:6}}>
          ⚠ {output.disclaimer}
        </div>
      )}
    </div>
  );
};

// ─── TOOLS LOG TAB ───────────────────────────────────────────────────────────
// ─── GOVERNANCE ──────────────────────────────────────────────────────────────
// Real input guardrail: reject empty/too-short or injection-style topics.
const MALICIOUS_RE = /(ignore (all |the )?(previous|above)|system prompt|disregard (all|previous)|jailbreak|<script|drop table|rm -rf|reveal (your )?(api[_ ]?key|secret)|bearer\s)/i;
const checkTopic = topic => {
  const t = (topic || "").trim();
  if (t.length < 8) return { ok:false, detail:"topic too short (min 8 chars)" };
  if (MALICIOUS_RE.test(t)) return { ok:false, detail:"blocked: possible prompt-injection / malicious pattern" };
  return { ok:true, detail:"allowed — looks like a genuine policy topic" };
};

const governanceChecks = (topic, output, sources = []) => {
  const input = checkTopic(topic);
  const official = sources.filter(s => s.type === "government").length;
  const citations = output?.citations?.length || 0;
  const noRun = !output;
  return [
    { label:"Input guardrail", sub:"topic is allowed / not malicious",
      ok:input.ok, pending:false, detail:input.detail },
    { label:"Source policy", sub:"official sources preferred",
      ok:official > 0, warn: sources.length > 0 && official === 0, pending:!sources.length,
      detail: sources.length ? `${official}/${sources.length} official (government) sources${official===0?" — none found (preference not met)":""}` : "awaiting run" },
    { label:"Citation check", sub:"every claim has a source",
      ok:citations > 0, pending:noRun,
      detail: noRun ? "awaiting run" : `${citations} citation(s) attached to the alert` },
    { label:"Output guardrail", sub:"disclaimer + confidence included",
      ok:!!(output?.disclaimer && output?.confidence), pending:noRun,
      detail: noRun ? "awaiting run" : `disclaimer ${output.disclaimer?"✓":"✗"} · confidence ${output.confidence?Math.round(output.confidence*100)+"%":"✗"}` },
    { label:"API key status", sub:"server-side proxy active",
      ok:true, pending:false, detail:"keys read server-side via /api proxy — never sent to the browser" },
  ];
};

const GovernanceTab = ({ topic, output, memory }) => {
  const checks = governanceChecks(topic, output, memory.sources);
  const passed = checks.filter(c => !c.pending && c.ok).length;
  const active = checks.filter(c => !c.pending).length;
  const warns = checks.filter(c => c.warn).length;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <Lbl>Governance checks — {passed}/{active} passing{warns?` · ${warns} warning`:""}</Lbl>
      {checks.map(c => {
        const color = c.pending ? T.textD : c.warn ? T.orange : (c.ok ? T.green : T.red);
        const mark = c.pending ? "•" : c.warn ? "!" : (c.ok ? "✓" : "✗");
        return (
          <div key={c.label} style={{display:"flex",gap:10,alignItems:"flex-start",
            background:T.card,border:`1px solid ${c.pending?T.border:color+"55"}`,borderRadius:4,padding:"8px 10px"}}>
            <span style={{color,fontFamily:"Oxanium,sans-serif",fontWeight:800,fontSize:15,flexShrink:0,marginTop:1}}>{mark}</span>
            <div style={{flex:1}}>
              <div style={{fontSize:11,fontFamily:"Oxanium,sans-serif",fontWeight:700,color:T.textB,letterSpacing:.5}}>{c.label}</div>
              <div style={{fontSize:9,fontFamily:"JetBrains Mono,monospace",color:T.textD}}>{c.sub}</div>
              <div style={{fontSize:10,fontFamily:"JetBrains Mono,monospace",color,marginTop:2,lineHeight:1.5}}>{c.detail}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── TOOL CALLS TAB ──────────────────────────────────────────────────────────
const ToolsLogTab = ({ toolsLog }) => (
  <div style={{display:"flex",flexDirection:"column",gap:4}}>
    {toolsLog.length === 0
      ? <div style={{color:T.textD,fontFamily:"JetBrains Mono,monospace",fontSize:10}}>
          No tool calls yet.
        </div>
      : toolsLog.map((e,i)=>(
        <div key={i} className="slide" style={{padding:"7px 9px",
          background:T.card,border:`1px solid ${T.border}`,borderRadius:3}}>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontSize:8,color:T.textD,fontFamily:"JetBrains Mono,monospace",flexShrink:0}}>
              {new Date(e.ts).toLocaleTimeString("en-US",{hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"})}
            </span>
            <Badge color={e.type==="web_search"||e.type==="summarizer"?"green":e.type==="notifier"?"orange":"blue"}>
              {e.tool || e.type}
            </Badge>
            {e.status && <Badge color={e.status==="approved"?"green":"red"}>{e.status}</Badge>}
            {typeof e.resultCount==="number" && (
              <span style={{fontSize:9,color:T.text,fontFamily:"JetBrains Mono,monospace"}}>{e.resultCount} results</span>
            )}
          </div>
          {(e.query||e.msg) && (
            <div style={{fontSize:10,color:T.textB,fontFamily:"JetBrains Mono,monospace",lineHeight:1.45,marginTop:4}}>
              {e.query ? <><span style={{color:T.textD}}>query: </span>{e.query}</> : e.msg}
            </div>
          )}
          {e.why && (
            <div style={{fontSize:9,color:T.textD,fontFamily:"JetBrains Mono,monospace",marginTop:2}}>
              why: {e.why}
            </div>
          )}
          {e.urls?.length>0 && (
            <div style={{marginTop:4,display:"flex",flexDirection:"column",gap:1}}>
              {e.urls.map((u,j)=>(
                <span key={j} style={{fontSize:8,color:T.blue,fontFamily:"JetBrains Mono,monospace",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>↳ {u}</span>
              ))}
            </div>
          )}
        </div>
      ))
    }
  </div>
);

// ─── HARNESS TRACE TAB ───────────────────────────────────────────────────────
const HarnessTraceTab = ({ traceLog }) => {
  const statusColor = {
    pending: T.textD,
    active: T.orange,
    done: T.green,
    error: T.red,
  };

  return (
    <div style={{overflowX:"auto"}}>
      <div style={{minWidth:820}}>
        <div style={{display:"grid",
          gridTemplateColumns:"1.4fr 82px 82px 1.2fr 100px 70px 1.4fr",
          gap:6,padding:"0 8px 6px",borderBottom:`1px solid ${T.border}`}}>
          {["Step","Status","Duration","Model","Tokens / Cost","Retry","Error"].map(h=>(
            <Lbl key={h}>{h}</Lbl>
          ))}
        </div>
        {traceLog.length === 0
          ? <div style={{color:T.textD,fontFamily:"JetBrains Mono,monospace",fontSize:10,
              padding:8}}>Run the agent to see the harness trace.</div>
          : traceLog.map(row=>(
            <div key={row.key} className={row.status==="active"?"blink":""}
              style={{display:"grid",
                gridTemplateColumns:"1.4fr 82px 82px 1.2fr 100px 70px 1.4fr",
                gap:6,alignItems:"center",padding:"7px 8px",
                borderBottom:`1px solid ${T.border}`,background:row.status==="active"?T.orangeD:"transparent"}}>
              <div>
                <div style={{fontFamily:"Oxanium,sans-serif",fontSize:11,fontWeight:800,
                  letterSpacing:"1px",color:T.textB,textTransform:"uppercase"}}>{row.step}</div>
                <div style={{fontFamily:"JetBrains Mono,monospace",fontSize:8,color:T.textD,
                  marginTop:2}}>{row.tool}</div>
              </div>
              <span style={{fontFamily:"JetBrains Mono,monospace",fontSize:9,
                color:statusColor[row.status]||T.textD,textTransform:"uppercase"}}>
                {row.status}
              </span>
              <span style={{fontFamily:"JetBrains Mono,monospace",fontSize:9,color:T.text}}>
                {row.duration}
              </span>
              <span style={{fontFamily:"JetBrains Mono,monospace",fontSize:9,color:T.text,
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {row.model}
              </span>
              <span style={{fontFamily:"JetBrains Mono,monospace",fontSize:9,color:T.text}}>
                {row.tokensCost}
              </span>
              <span style={{fontFamily:"JetBrains Mono,monospace",fontSize:9,color:T.text}}>
                {row.retries}
              </span>
              <span style={{fontFamily:"JetBrains Mono,monospace",fontSize:9,
                color:row.error?T.red:T.textD,overflow:"hidden",textOverflow:"ellipsis",
                whiteSpace:"nowrap"}}>
                {row.error || "—"}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
};

// ─── MEMORY TAB ──────────────────────────────────────────────────────────────
const MemoryTab = ({ memory }) => (
  <div style={{display:"flex",flexDirection:"column",gap:16}}>
    {[
      {title:`Run memory — current sources (${memory.sources.length})`, note:memory.runNote,
        items:memory.sources.map(s=>({
          primary:s.title||s.url, secondary:s.key_info, badge:s.type,
          meta:s.reliability?`reliability: ${(s.reliability*100).toFixed(0)}%`:null, metaC:T.green,
        }))},
      {title:`User preference memory — topic history (${memory.preferences.length})`,
        items:[...memory.preferences].reverse().map(p=>({
          primary:p.topic, meta:new Date(p.ts).toLocaleString(), metaC:T.textD,
        }))},
      {title:`Source memory — trusted URLs (${(memory.trustedSources||[]).length})`,
        items:(memory.trustedSources||[]).map(s=>({
          primary:s.title||s.url, secondary:s.url, badge:s.type,
          meta:s.reliability?`${(s.reliability*100).toFixed(0)}%`:null, metaC:T.green,
        }))},
      {title:`Checkpoints — saved states (${(memory.checkpoints||[]).length})`,
        items:[...(memory.checkpoints||[])].reverse().map(c=>({
          primary:c.topic,
          secondary:c.steps.map(s=>`${s.step} → ${s.summary}`).join("   ·   "),
          meta:new Date(c.run).toLocaleTimeString(), metaC:T.textD,
        }))},
    ].map(section=>(
      <div key={section.title}>
        <Lbl style={{marginBottom:7}}>{section.title}</Lbl>
        {section.note&&(
          <div style={{fontSize:9,color:T.text,fontFamily:"JetBrains Mono,monospace",
            marginBottom:6,lineHeight:1.5,fontStyle:"italic"}}>note: {section.note}</div>
        )}
        {section.items.length===0
          ? <div style={{fontSize:9,color:T.textD,fontFamily:"JetBrains Mono,monospace"}}>Empty.</div>
          : section.items.map((item,i)=>(
            <div key={i} style={{background:T.card,border:`1px solid ${T.border}`,
              borderRadius:3,padding:"6px 8px",marginBottom:4}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                {item.badge&&<Badge color="blue">{item.badge}</Badge>}
                <span style={{fontSize:10,fontFamily:"JetBrains Mono,monospace",
                  color:T.textB,flex:1}}>{item.primary}</span>
                {item.meta&&<span style={{fontSize:8,fontFamily:"JetBrains Mono,monospace",
                  color:item.metaC||T.text}}>{item.meta}</span>}
              </div>
              {item.secondary&&(
                <div style={{fontSize:9,fontFamily:"JetBrains Mono,monospace",
                  color:T.text,marginTop:2}}>{item.secondary}</div>
              )}
            </div>
          ))
        }
      </div>
    ))}
  </div>
);

// ─── SETTINGS TAB ────────────────────────────────────────────────────────────
const SettingsTab = ({ model, onModelChange }) => (
  <div style={{display:"flex",flexDirection:"column",gap:14,maxWidth:460}}>
    <div>
      <Lbl style={{marginBottom:6}}>OpenRouter API key</Lbl>
      <div style={{padding:"7px 10px",background:T.card,border:`1px solid ${T.border}`,
        borderRadius:4,fontFamily:"JetBrains Mono,monospace",fontSize:11,color:T.textB}}>
        Server-side proxy
      </div>
      <div style={{fontSize:9,fontFamily:"JetBrains Mono,monospace",color:T.textD,marginTop:4}}>
        The key is read by the local dev server and is not exposed to browser JavaScript.
      </div>
    </div>
    <div>
      <Lbl style={{marginBottom:6}}>Session storage</Lbl>
      <div style={{padding:"7px 10px",background:T.card,border:`1px solid ${T.border}`,
        borderRadius:4,fontFamily:"JetBrains Mono,monospace",fontSize:11,color:T.textB}}>
        Anonymous server session
      </div>
      <div style={{fontSize:9,fontFamily:"JetBrains Mono,monospace",color:T.textD,marginTop:4}}>
        Output, trace, tools log, memory, and settings persist across reloads.
      </div>
    </div>
    <div>
      <Lbl style={{marginBottom:6}}>Model</Lbl>
      <input value={model} onChange={e=>onModelChange(e.target.value)}
        placeholder="provider/model"
        style={{width:"100%",background:T.card,border:`1px solid ${T.border}`,borderRadius:4,
          color:T.textB,fontFamily:"JetBrains Mono,monospace",fontSize:11,
          padding:"8px 10px",outline:"none",display:"block"}} />
    </div>
    <div>
      <Lbl style={{marginBottom:6}}>Governance rules</Lbl>
      {["Only approved URLs are monitored","All outputs labelled informational only",
        "Source citations required in every alert","Confidence score shown on each result",
        "3 LLM calls per run (observe / reason / act)",
        "API key stays on the local server proxy"].map((r,i)=>(
        <div key={i} style={{fontSize:9,fontFamily:"JetBrains Mono,monospace",color:T.text,
          display:"flex",gap:6,marginBottom:4,lineHeight:1.4}}>
          <span style={{color:T.green}}>✓</span>{r}
        </div>
      ))}
    </div>
  </div>
);

// ─── HEADER ──────────────────────────────────────────────────────────────────
const Header = ({ status, onSettings, theme, onToggleTheme }) => {
  const sc = {
    idle:    {c:T.textD, l:"STANDBY"},
    running: {c:T.green, l:"RUNNING"},
    done:    {c:T.green, l:"COMPLETE"},
    error:   {c:T.red,   l:"ERROR"},
  }[status] || {c:T.textD,l:"STANDBY"};

  return (
    <div style={{display:"flex",alignItems:"center",padding:"8px 14px",
      borderBottom:`1px solid ${T.border}`,background:T.panel,borderRadius:6}}>
      <div style={{display:"flex",alignItems:"baseline",gap:1}}>
        <span style={{fontFamily:"Oxanium,sans-serif",fontWeight:800,fontSize:18,
          color:T.green,letterSpacing:"3px"}}>POLICY</span>
        <span style={{fontFamily:"Oxanium,sans-serif",fontWeight:800,fontSize:18,
          color:T.white,letterSpacing:"3px"}}>PULSE</span>
      </div>
      <span style={{fontFamily:"JetBrains Mono,monospace",fontSize:9,color:T.textD,marginLeft:10}}>
        AGENT = LLM + HARNESS
      </span>
      <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:14}}>
        <button onClick={onToggleTheme}
          style={{background:"none",border:`1px solid ${T.border}`,borderRadius:4,
            padding:"3px 10px",color:T.text,fontFamily:"Oxanium,sans-serif",fontSize:10,
            cursor:"pointer",letterSpacing:"1px",textTransform:"uppercase"}}>
          {theme==="dark" ? "☀ LIGHT" : "☾ DARK"}
        </button>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          <Dot on={status==="running"||status==="done"} error={status==="error"} />
          <span style={{fontFamily:"Oxanium,sans-serif",fontSize:10,color:sc.c,letterSpacing:"1px"}}>
            {sc.l}
          </span>
        </div>
        <button onClick={onSettings}
          style={{background:"none",border:`1px solid ${T.border}`,borderRadius:4,
            padding:"3px 10px",color:T.text,fontFamily:"Oxanium,sans-serif",fontSize:10,
            cursor:"pointer",letterSpacing:"1px"}}>
          ⚙ SETTINGS
        </button>
      </div>
    </div>
  );
};

// ─── CONNECTOR ARROW ─────────────────────────────────────────────────────────
const Arrow = ({ dir = "h" }) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"center",
    color:T.textD,fontSize:dir==="v"?14:12,flexShrink:0,
    width:dir==="v"?"100%":"22px",height:dir==="v"?"20px":"auto"}}>
    {dir==="v" ? "↕" : "↔"}
  </div>
);

// ─── EXPERIMENTAL DIAGRAM ───────────────────────────────────────────────────
const DiagramCard = ({ title, subtitle, accent = "blue", children, style }) => {
  const c = {blue:T.blue, green:T.green, orange:T.orange, red:T.red}[accent] || T.blue;
  return (
    <div style={{background:T.panel,border:`1px solid ${T.border}`,borderLeft:`3px solid ${c}`,
      borderRadius:7,boxShadow:`0 10px 28px ${T.bg}66`,overflow:"hidden",...style}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        gap:8,padding:"8px 10px",borderBottom:`1px solid ${T.border}`,background:T.card}}>
        <div>
          <div style={{fontFamily:"Oxanium,sans-serif",fontSize:11,fontWeight:800,
            letterSpacing:"1.5px",color:T.white,textTransform:"uppercase"}}>{title}</div>
          {subtitle && (
            <div style={{fontFamily:"JetBrains Mono,monospace",fontSize:8,color:T.text,
              marginTop:2,lineHeight:1.4}}>{subtitle}</div>
          )}
        </div>
        <span style={{width:7,height:7,borderRadius:"50%",background:c,boxShadow:`0 0 10px ${c}`}} />
      </div>
      <div style={{padding:10}}>{children}</div>
    </div>
  );
};

const DiagramConnector = ({ direction = "right", label }) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"center",
    flexDirection:direction==="down"?"column":"row",gap:0,minHeight:direction==="down"?34:"auto"}}>
    {direction === "down" ? (
      <>
        <div style={{width:1,height:22,background:T.textD}} />
        <span style={{width:0,height:0,borderLeft:"4px solid transparent",
          borderRight:"4px solid transparent",borderTop:`6px solid ${T.textD}`}} />
      </>
    ) : (
      <>
        <div style={{height:1,width:26,background:T.textD}} />
        <span style={{width:0,height:0,borderTop:"4px solid transparent",
          borderBottom:"4px solid transparent",borderLeft:`6px solid ${T.textD}`}} />
      </>
    )}
    {label && (
      <span style={{fontFamily:"JetBrains Mono,monospace",fontSize:8,color:T.textD,
        textTransform:"uppercase",letterSpacing:"1px"}}>{label}</span>
    )}
  </div>
);

const MiniChip = ({ color = "blue", children }) => (
  <Badge color={color}>{children}</Badge>
);

const PhaseNode = ({ id, label, phase }) => {
  const st = phase?.status || "idle";
  const active = st === "active";
  const done = st === "done";
  return (
    <div className={active ? "phase-active" : ""}
      style={{display:"grid",gridTemplateColumns:"22px 1fr auto",alignItems:"center",
        gap:8,background:done?T.greenD:T.card,border:`1px solid ${done?T.green+"55":T.border}`,
        borderRadius:7,padding:"8px 10px",position:"relative"}}>
      {active ? <Spinner /> : <Dot on={done} />}
      <div>
        <div style={{fontFamily:"Oxanium,sans-serif",fontSize:12,fontWeight:800,
          letterSpacing:"2px",color:done||active?T.white:T.textB}}>{label}</div>
        <div style={{fontFamily:"JetBrains Mono,monospace",fontSize:8,color:T.textD,
          marginTop:2}}>{id === "context" ? "topic + constraints" :
            id === "observe" ? "official source search" :
            id === "reason" ? "policy analysis" : "actionable alert"}</div>
      </div>
      <MiniChip color={id==="context"?"blue":"green"}>LLM</MiniChip>
    </div>
  );
};

const PhaseFlowMarker = ({ first, last }) => (
  <div style={{position:"relative",height:"100%",minHeight:54,display:"flex",
    alignItems:"center",justifyContent:"center"}}>
    {!first && (
      <div style={{position:"absolute",top:-12,height:22,width:1,background:T.textD}} />
    )}
    {!last && (
      <div style={{position:"absolute",bottom:-12,height:22,width:1,background:T.textD}} />
    )}
    <span style={{width:0,height:0,borderTop:"4px solid transparent",
      borderBottom:"4px solid transparent",borderLeft:`6px solid ${T.textD}`,
      transform:"translateX(2px)"}} />
  </div>
);

const DiagramMemoryCard = ({ memory }) => (
  <DiagramCard title="Memory" subtitle="sources · preferences · alerts" accent="orange">
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
      gap:10,flexWrap:"wrap"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",minWidth:0}}>
        {[["Sources",memory.sources.length],["Prefs",memory.preferences.length],["Alerts",memory.alerts.length]].map(([label,value])=>(
          <span key={label} style={{fontFamily:"JetBrains Mono,monospace",fontSize:10,color:T.text,
            whiteSpace:"nowrap"}}>
            {label}: <span style={{color:value?T.green:T.textD}}>{value}</span>
          </span>
        ))}
      </div>
      <div style={{display:"flex",gap:4,flexWrap:"wrap",justifyContent:"flex-end"}}>
        <MiniChip color="blue">CPU</MiniChip>
        <MiniChip color="orange">DPU</MiniChip>
        <MiniChip color="orange">CUDA</MiniChip>
        <MiniChip color="green">LLM</MiniChip>
        <MiniChip color="blue">NET</MiniChip>
      </div>
    </div>
  </DiagramCard>
);

const PromptModal = ({ draft, setDraft, onCancel, onDone }) => {
  const textareaRef = useRef(null);
  const actionsRef = useRef({ onCancel, onDone });

  useEffect(() => {
    actionsRef.current = { onCancel, onDone };
  }, [onCancel, onDone]);

  useEffect(() => {
    const node = textareaRef.current;
    node?.focus();
    node?.setSelectionRange(node.value.length, node.value.length);
    const onKeyDown = e => {
      if (e.key === "Escape") actionsRef.current.onCancel();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") actionsRef.current.onDone();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div onMouseDown={onCancel}
      style={{position:"fixed",inset:0,zIndex:50,display:"flex",alignItems:"center",
        justifyContent:"center",padding:24,background:`${T.bg}cc`,
        backdropFilter:"blur(10px)",WebkitBackdropFilter:"blur(10px)"}}>
      <div onMouseDown={e=>e.stopPropagation()}
        style={{width:"min(660px, calc(100vw - 48px))",minHeight:360,
          background:T.panel,border:`1px solid ${T.borderB}`,borderRadius:8,
          boxShadow:`0 24px 80px ${T.bg}cc`,overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
          gap:12,padding:"12px 14px",borderBottom:`1px solid ${T.border}`,background:T.card}}>
          <div>
            <div style={{fontFamily:"Oxanium,sans-serif",fontSize:14,fontWeight:800,
              letterSpacing:"2px",color:T.white,textTransform:"uppercase"}}>Prompt</div>
            <div style={{fontFamily:"JetBrains Mono,monospace",fontSize:9,color:T.text,
              marginTop:3}}>human intent</div>
          </div>
          <span style={{width:8,height:8,borderRadius:"50%",background:T.blue,
            boxShadow:`0 0 12px ${T.blue}`}} />
        </div>
        <div style={{padding:14}}>
          <textarea ref={textareaRef} value={draft} onChange={e=>setDraft(e.target.value)}
            placeholder="Policy topic"
            style={{width:"100%",height:230,resize:"vertical",background:T.bg,
              border:`1px solid ${T.borderB}`,borderRadius:6,padding:12,
              color:T.textB,fontFamily:"JetBrains Mono,monospace",fontSize:12,
              lineHeight:1.6,outline:"none",display:"block"}} />
          <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:12}}>
            <button onClick={onCancel}
              style={{padding:"8px 14px",background:T.card,border:`1px solid ${T.borderB}`,
                borderRadius:4,color:T.textB,fontFamily:"Oxanium,sans-serif",
                fontWeight:800,fontSize:10,letterSpacing:"1.5px",cursor:"pointer"}}>
              CANCEL
            </button>
            <button onClick={onDone} disabled={!draft.trim()}
              style={{padding:"8px 18px",background:draft.trim()?T.green:T.card,
                border:`1px solid ${draft.trim()?T.green:T.border}`,borderRadius:4,
                color:draft.trim()?"#000":T.textD,fontFamily:"Oxanium,sans-serif",
                fontWeight:800,fontSize:10,letterSpacing:"1.5px",
                cursor:draft.trim()?"pointer":"not-allowed"}}>
              DONE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ExperimentalAgentDiagram = ({ topic, setTopic, onPromptOpen, onRun, status, phases, toolsLog, memory, searchProvider, setSearchProvider, approvalGate, setApprovalGate, engine, setEngine }) => {
  const running = status === "running";
  const used = new Set(toolsLog.map(l=>l.type));
  const toolRows = [
    ["web_search","green"],["page_fetcher","blue"],["diff_engine","blue"],
    ["summarizer","green"],["notifier","orange"],
  ];

  return (
    <div style={{position:"relative",border:`1px solid ${T.borderB}`,borderRadius:8,
      background:T.bg,padding:"14px 16px 12px",minHeight:390,overflow:"hidden"}}>
      <div style={{position:"absolute",inset:0,pointerEvents:"none",
        backgroundImage:`linear-gradient(90deg, ${T.border}33 1px, transparent 1px),
          linear-gradient(180deg, ${T.border}26 1px, transparent 1px)`,
        backgroundSize:"42px 42px",opacity:.22}} />
      <div style={{position:"relative",zIndex:1}}>
        <div style={{textAlign:"center",fontFamily:"Oxanium,sans-serif",fontSize:18,
          fontWeight:800,letterSpacing:"2px",color:T.textB,marginBottom:12}}>
          AGENT = LLM + HARNESS
        </div>

        <div style={{display:"grid",gridTemplateColumns:"190px 36px minmax(360px,1fr) 36px 210px",
          gap:0,alignItems:"center"}}>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <DiagramCard title="Prompt" subtitle="human intent" accent="blue">
              <textarea value={topic} onChange={e=>setTopic(e.target.value)}
                onFocus={() => { if (!running) onPromptOpen(); }}
                onClick={() => { if (!running) onPromptOpen(); }}
                disabled={running} placeholder="Policy topic"
                style={{width:"100%",height:70,resize:"none",background:T.bg,
                  border:`1px solid ${T.border}`,borderRadius:5,padding:8,
                  color:T.textB,fontFamily:"JetBrains Mono,monospace",fontSize:11,
                  lineHeight:1.45,outline:"none",cursor:running?"not-allowed":"text"}} />
              <select value={searchProvider} onChange={e=>setSearchProvider(e.target.value)}
                disabled={running} title="Search provider (auto-falls back if one fails)"
                style={{width:"100%",marginTop:8,padding:"6px",background:T.bg,
                  border:`1px solid ${T.border}`,borderRadius:4,color:T.textB,
                  fontFamily:"JetBrains Mono,monospace",fontSize:10,outline:"none",cursor:running?"not-allowed":"pointer"}}>
                {Object.entries(SEARCH_PROVIDERS).map(([key,p])=>(
                  <option key={key} value={key}>{p.label}</option>
                ))}
              </select>
              <select value={approvalGate} onChange={e=>setApprovalGate(e.target.value)}
                disabled={running} title="Human approval gate for policy/legal output"
                style={{width:"100%",marginTop:6,padding:"6px",background:T.bg,
                  border:`1px solid ${T.border}`,borderRadius:4,color:T.textB,
                  fontFamily:"JetBrains Mono,monospace",fontSize:10,outline:"none",cursor:running?"not-allowed":"pointer"}}>
                <option value="off">No approval gate</option>
                <option value="sources">Approve sources before Reason</option>
                <option value="alert">Approve alert before saving</option>
              </select>
              <select value={engine} onChange={e=>setEngine(e.target.value)}
                disabled={running} title="Where the agent logic runs"
                style={{width:"100%",marginTop:6,padding:"6px",background:T.bg,
                  border:`1px solid ${engine==="python"?T.blue:T.border}`,borderRadius:4,color:T.textB,
                  fontFamily:"JetBrains Mono,monospace",fontSize:10,outline:"none",cursor:running?"not-allowed":"pointer"}}>
                <option value="browser">Engine: Browser (JS)</option>
                <option value="python">Engine: Python backend</option>
              </select>
              <button onClick={onRun} disabled={running||!topic.trim()}
                style={{width:"100%",marginTop:8,padding:"8px",background:running||!topic.trim()?T.card:T.green,
                  border:`1px solid ${running||!topic.trim()?T.border:T.green}`,borderRadius:4,
                  color:running||!topic.trim()?T.textD:"#000",fontFamily:"Oxanium,sans-serif",
                  fontWeight:800,fontSize:10,letterSpacing:"1.5px",cursor:running||!topic.trim()?"not-allowed":"pointer"}}>
                {running ? "RUNNING" : "RUN AGENT"}
              </button>
            </DiagramCard>
            <DiagramCard title="Orchestration" subtitle="control harness" accent="blue">
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                <MiniChip color="blue">CPU</MiniChip>
                <MiniChip color="orange">DPU</MiniChip>
              </div>
              {["approval gate","budget guard","retry policy","citations"].map(x=>(
                <div key={x} style={{fontFamily:"JetBrains Mono,monospace",fontSize:9,
                  color:T.text,marginTop:7,display:"flex",gap:6}}>
                  <span style={{color:T.green}}>✓</span>{x}
                </div>
              ))}
            </DiagramCard>
          </div>

          <DiagramConnector />

          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div style={{border:`2px dashed ${T.borderB}`,borderRadius:16,
              background:T.panel,padding:14,position:"relative"}}>
              <div style={{position:"absolute",top:-10,left:16,background:T.bg,
                border:`1px solid ${T.borderB}`,borderRadius:5,padding:"2px 8px",
                fontFamily:"JetBrains Mono,monospace",fontSize:9,color:T.text}}>
                agent harness · observe → reason → act
              </div>
              <div style={{position:"relative",border:`1px solid ${T.textD}55`,
                borderRadius:12,padding:"18px 16px",background:T.bg,overflow:"visible"}}>
                <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none"
                  style={{display:"none",position:"absolute",inset:10,width:"calc(100% - 20px)",
                    height:"calc(100% - 20px)",pointerEvents:"none",color:T.textD,opacity:.55}}>
                  <path d="M15 8 H88 Q94 8 94 16 V84 Q94 92 86 92 H20 Q12 92 12 84 V72 H22"
                    fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M78 24 Q88 24 88 34 Q88 44 78 44 H15 Q8 44 8 52 H20"
                    fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M78 50 Q88 50 88 60 Q88 70 78 70 H15 Q8 70 8 78 H20"
                    fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <div style={{display:"grid",gridTemplateColumns:"24px 1fr",columnGap:10,
                  rowGap:12,position:"relative",zIndex:1}}>
                  {[
                    ["context","CONTEXT"],["observe","OBSERVE"],["reason","REASON"],["act","ACT"],
                  ].map(([id,label],i,arr) => (
                    <Fragment key={id}>
                      <PhaseFlowMarker first={i===0} last={i===arr.length-1} />
                      <PhaseNode id={id} label={label} phase={phases[id]} />
                    </Fragment>
                  ))}
                </div>
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"center",height:26,alignItems:"center"}}>
              <DiagramConnector direction="down" />
            </div>
            <DiagramMemoryCard memory={memory} />
          </div>

          <DiagramConnector />

          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <DiagramCard title="Tools & Skills" subtitle="runtime capabilities" accent="green">
              {toolRows.map(([name,color])=>(
                <div key={name} style={{display:"flex",alignItems:"center",gap:7,
                  padding:"4px 0",fontFamily:"JetBrains Mono,monospace",fontSize:9,
                  color:used.has(name)?T.textB:T.text}}>
                  <Dot on={used.has(name)} />
                  <span style={{flex:1}}>{name}</span>
                  <MiniChip color={color}>{name==="web_search"||name==="summarizer"?"LLM":name==="notifier"?"NET":"CPU"}</MiniChip>
                </div>
              ))}
            </DiagramCard>
            <DiagramCard title="Security" subtitle="governance layer" accent="orange">
              <div style={{display:"flex",gap:4,marginBottom:8}}>
                <MiniChip color="blue">CPU</MiniChip><MiniChip color="orange">DPU</MiniChip>
              </div>
              {["approved URLs","legal disclaimer","confidence score","source citations"].map(x=>(
                <div key={x} style={{fontFamily:"JetBrains Mono,monospace",fontSize:9,
                  color:T.text,marginTop:6,display:"flex",gap:6}}>
                  <span style={{color:T.green}}>✓</span>{x}
                </div>
              ))}
            </DiagramCard>
          </div>
        </div>

      </div>
    </div>
  );
};

// ─── ROOT ────────────────────────────────────────────────────────────────────
export default function PolicyPulse() {
  const [model,     setModel]     = useState(readModelLocal);
  const [theme,     setTheme]     = useState(()=>readLocal("policypulse.theme","dark"));
  const [topic,     setTopic]     = useState("German student visa work rules");
  const [searchProvider, setSearchProvider] = useState(()=>readLocal("policypulse.searchProvider","tavily"));
  const [approvalGate, setApprovalGate] = useState(()=>readLocal("policypulse.approvalGate","off"));
  const [engine, setEngine] = useState(()=>readLocal("policypulse.engine","browser"));
  const [pending,   setPending]   = useState(null);
  const approvalRef = useRef(null);
  const [status,    setStatus]    = useState("idle");
  const [phases,    setPhases]    = useState({
    context:{status:"idle",data:null},
    observe:{status:"idle",data:null},
    reason: {status:"idle",data:null},
    act:    {status:"idle",data:null},
  });
  const [toolsLog,  setToolsLog]  = useState([]);
  const [memory,    setMemory]    = useState({sources:[],preferences:[],alerts:[],checkpoints:[],trustedSources:[]});
  const [output,    setOutput]    = useState(null);
  const [activeTab, setActiveTab] = useState("output");
  const [error,     setError]     = useState(null);
  const [traceLog,  setTraceLog]  = useState(()=>makeTraceRows(model));
  const [sessionReady, setSessionReady] = useState(false);
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState(topic);
  const outputScrollRef = useRef(null);

  T = PALETTES[theme] || PALETTES.dark;

  useLayoutEffect(() => {
    const node = outputScrollRef.current;
    if (!node) return;
    const reset = () => {
      node.scrollTop = 0;
      node.scrollLeft = 0;
    };
    reset();
    const raf = requestAnimationFrame(reset);
    const timer = setTimeout(reset, 80);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [activeTab, output, error]);

  const upd = (id,u) => setPhases(p=>({...p,[id]:{...p[id],...u}}));
  const log = e => setToolsLog(p=>[...p,{...e,ts:Date.now()}]);
  const traceStart = (key, startedAt, updates = {}) => setTraceLog(rows => rows.map(row =>
    row.key === key
      ? {...row,status:"active",startedAt,duration:"—",error:"",...updates}
      : row
  ));
  const traceDone = (key, startedAt, updates = {}) => setTraceLog(rows => rows.map(row =>
    row.key === key
      ? {...row,status:"done",startedAt:null,duration:`${Math.max(0,Math.round(performance.now()-startedAt))}ms`,...updates}
      : row
  ));
  const traceFailActive = message => setTraceLog(rows => rows.map(row =>
    row.status === "active"
      ? {...row,status:"error",duration:row.startedAt?`${Math.max(0,Math.round(performance.now()-row.startedAt))}ms`:row.duration,error:message,startedAt:null}
      : row
  ));
  const updateModel = value => {
    setModel(value);
    writeLocal("policypulse.model", value);
  };
  const updateProvider = value => {
    setSearchProvider(value);
    writeLocal("policypulse.searchProvider", value);
  };
  const updateApprovalGate = value => {
    setApprovalGate(value);
    writeLocal("policypulse.approvalGate", value);
  };
  const updateEngine = value => {
    setEngine(value);
    writeLocal("policypulse.engine", value);
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
  // Pause the pipeline and wait for a human Approve/Reject click.
  const requestApproval = (stage, summary) => new Promise(resolve => {
    approvalRef.current = resolve;
    setPending({ stage, summary });
  });
  const resolveApproval = ok => {
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

	  useEffect(() => {
	    let cancelled = false;
	    loadSessionState()
	      .then(({ state }) => {
	        if (cancelled || !state) return;
        setModel(state.model === OLD_FREE_MODEL ? DEFAULT_MODEL : state.model || DEFAULT_MODEL);
        setTheme(state.theme || "dark");
        setTopic(state.topic || "German student visa work rules");
        setStatus(state.status === "running" ? "idle" : state.status || "idle");
        setPhases(state.phases || {
          context:{status:"idle",data:null},
          observe:{status:"idle",data:null},
          reason: {status:"idle",data:null},
          act:    {status:"idle",data:null},
        });
        setToolsLog(state.toolsLog || []);
        setMemory(dedupeMemory({sources:[],preferences:[],alerts:[],checkpoints:[],trustedSources:[],...(state.memory||{})}));
        setOutput(state.output || null);
        setActiveTab(state.activeTab || "output");
        setError(state.status === "running" ? "Restored from a previous in-progress run. Start a new run to continue." : state.error || null);
	        setTraceLog(state.traceLog || makeTraceRows(state.model || DEFAULT_MODEL));
	      })
	      .catch(() => {
	        if (!cancelled) setError("Session persistence is unavailable; using local page state.");
	      })
	      .finally(() => {
	        if (!cancelled) setSessionReady(true);
	      });
	    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    const handle = setTimeout(() => {
      saveSessionState({
        model, theme, topic, status, phases, toolsLog, memory, output, activeTab, error, traceLog,
        savedAt: new Date().toISOString(),
      }).catch(() => {});
    }, 350);
    return () => clearTimeout(handle);
  }, [sessionReady, model, theme, topic, status, phases, toolsLog, memory, output, activeTab, error, traceLog]);

  // Part 4: run the full agent in the Python backend instead of the browser.
  // The browser `runAgent` below is left completely intact; this is a parallel path.
	  const runAgentPython = async () => {
	    if (!topic.trim()||status==="running") return;
	    if (approvalGate !== "off") {
	      setStatus("error");
	      setError("Approval gates are only available with the Browser (JS) engine until the backend supports interactive pauses.");
	      setActiveTab("governance");
	      return;
	    }
	    setStatus("running"); setError(null); setOutput(null); setToolsLog([]);
    setPhases({
      context:{status:"idle",data:null},
      observe:{status:"idle",data:null},
      reason: {status:"idle",data:null},
      act:    {status:"idle",data:null},
    });
    setActiveTab("harness_trace");

    const runModel = model.trim() || DEFAULT_MODEL;
    const traceRow = (rows, key, updates) => rows.map(row =>
      row.key === key ? {...row, ...updates} : row
    );
    let rows = makeTraceRows(runModel);
    rows = traceRow(rows, "input_received", {status:"done", duration:"0ms", model:runModel, tool:"UI", tokensCost:"0 tok"});
    setTraceLog(rows);

    const contextStarted = performance.now();
    rows = traceRow(rows, "context_built", {status:"active", startedAt:contextStarted, model:runModel, tool:"context"});
    setTraceLog(rows);
    upd("context",{status:"active"});
    await sleep(700);
    upd("context",{status:"done",data:{topic}});
    rows = traceRow(rows, "context_built", {
      status:"done",
      startedAt:null,
      duration:`${Math.max(0,Math.round(performance.now()-contextStarted))}ms`,
      tokensCost:"0 tok",
    });

    const guardrail = checkTopic(topic);
    const guardStarted = performance.now();
    rows = traceRow(rows, "guardrail_checked", {
      status: guardrail.ok ? "done" : "error",
      startedAt:null,
      duration:`${Math.max(0,Math.round(performance.now()-guardStarted))}ms`,
      model:runModel,
      tool:"input_guardrail",
      tokensCost:"0 tok",
      error: guardrail.ok ? "" : guardrail.detail,
    });
    if (!guardrail.ok) {
      setTraceLog(rows);
      setError(`Input guardrail failed: ${guardrail.detail}`);
      setStatus("error");
      return;
    }

    const observeStarted = performance.now();
    rows = traceRow(rows, "web_search_called", {
      status:"active",
      startedAt:observeStarted,
      duration:"—",
      model:searchProvider,
      tool:"web_search",
    });
    setTraceLog(rows);
    upd("observe",{status:"active"});
    log({type:"web_search", tool:"python-backend", query:`POST /run · ${topic}`,
      why:"Run the full Observe→Reason→Act pipeline in the Python backend"});
    try {
	      const res = await fetch(PYTHON_RUN, {
	        method:"POST", headers:mkHeaders(),
	        body:JSON.stringify({topic, provider:searchProvider}),
	      });
      const text = await res.text();
      let result;
      try { result = JSON.parse(text); }
      catch { throw new Error(`Python backend returned a non-JSON response (HTTP ${res.status}). Is the backend running and the /api/run proxy configured?`); }
      if(!res.ok) throw new Error(result.error || `Python backend HTTP ${res.status} (is it running? python3 -m policypulse.server)`);
      if(result.error) throw new Error(result.error);
      const actualModel = result.model || runModel;
      (result.checkpoints||[]).forEach(cp=>log({type:"diff_engine", msg:`${cp.step}: ${cp.summary}`}));
      setMemory(p=>({...p,
        sources: result.obs?.sources || [],
        checkpoints:[...(p.checkpoints||[]), {run:Date.now(), topic, steps:result.checkpoints||[]}],
      }));
      setTraceLog(current => current.map(row => {
        if (row.key === "web_search_called") {
          return {...row,status:"done",startedAt:null,duration:`${Math.max(0,Math.round(performance.now()-observeStarted))}ms`,model:result.obs?.provider || searchProvider,tokensCost:`${(result.obs?.sources||[]).length} sources`};
        }
        if (["input_received","context_built","guardrail_checked"].includes(row.key)) {
          return {...row,model:actualModel};
        }
        return row;
      }));
      upd("observe",{status:"done",data:result.obs});

      upd("reason",{status:"active"});
      setTraceLog(current => current.map(row =>
        row.key === "sources_ranked"
          ? {...row,status:"active",model:actualModel,tool:"LLM",duration:"—",error:""}
          : row
      ));
      await sleep(350);
      setTraceLog(current => current.map(row => {
        if (row.key === "sources_ranked") return {...row,status:"done",duration:"backend",tokensCost:"backend",error:""};
        if (row.key === "reasoning_done") return {...row,status:"done",model:actualModel,tool:"reason",duration:"backend",tokensCost:`${result.loops || 1} pass`,error:""};
        return row;
      }));
      upd("reason",{status:"done",data:result.reason});

      upd("act",{status:"active"});
      setTraceLog(current => current.map(row =>
        row.key === "alert_generated"
          ? {...row,status:"active",model:actualModel,tool:"summarizer",duration:"—",error:""}
          : row
      ));
      await sleep(350);
      setTraceLog(current => current.map(row => {
        if (row.key === "output_checked") return {...row,status:"done",model:actualModel,tool:"output_guardrail",duration:"backend",tokensCost:"0 tok",error:""};
        if (row.key === "alert_generated") return {...row,status:"done",duration:"backend",tokensCost:"backend",error:""};
        return row;
      }));
      upd("act",{status:"done",data:result.alert});
      setOutput(result.alert);
      log({type:"notifier", msg:`Python backend done · ${result.saved?"alert saved":"no material change"}`});
      setStatus("done");
      setActiveTab("output");
    } catch(e) {
      const failKey = /LLM HTTP|OpenRouter|JSON/i.test(e.message) ? "reasoning_done" : "web_search_called";
      setTraceLog(current => current.map(row => {
        if (row.key === "web_search_called" && failKey !== "web_search_called") {
          return {...row,status:"done",startedAt:null,duration:`${Math.max(0,Math.round(performance.now()-observeStarted))}ms`};
        }
        if (row.key === failKey) {
          return {...row,status:"error",startedAt:null,duration:row.startedAt?`${Math.max(0,Math.round(performance.now()-row.startedAt))}ms`:"0ms",error:e.message};
        }
        return row;
      }));
      upd("observe",{status:failKey === "web_search_called" ? "idle" : "done"});
      upd("reason",{status:failKey === "reasoning_done" ? "idle" : "idle"});
      upd("act",{status:"idle"});
      setError(e.message);
      setStatus("error");
    }
  };

  const runAgent = async () => {
    if (!topic.trim()||status==="running") return;
    if (!model.trim()) {
      setStatus("error");
      setError("Model is required. Add an OpenRouter model in Settings.");
      setActiveTab("settings");
      return;
    }
    const runModel = model.trim();
    setStatus("running"); setError(null); setOutput(null); setToolsLog([]);
    setTraceLog(makeTraceRows(runModel));
    setActiveTab("harness_trace");
    setPhases({
      context:{status:"idle",data:null},
      observe:{status:"idle",data:null},
      reason: {status:"idle",data:null},
      act:    {status:"idle",data:null},
    });

    try {
      // ── TRACE: INPUT ───────────────────────────────────────────────────────
      let t = performance.now();
      traceStart("input_received", t, {model:runModel, tool:"UI"});
      traceDone("input_received", t, {tokensCost:"0 tok"});

      // ── CONTEXT ────────────────────────────────────────────────────────────
      t = performance.now();
      traceStart("context_built", t, {model:runModel, tool:"context"});
      upd("context",{status:"active"});
      await sleep(700);
      upd("context",{status:"done",data:{topic}});
      log({type:"context",msg:`Topic loaded: "${topic}"`});
      traceDone("context_built", t, {tokensCost:"0 tok"});

      // ── GUARDRAIL ─────────────────────────────────────────────────────────
      t = performance.now();
      traceStart("guardrail_checked", t, {model:runModel, tool:"input_guardrail"});
      const guardrail = checkTopic(topic);
      traceDone("guardrail_checked", t, {
        tokensCost:"0 tok",
        error:guardrail.ok ? "" : guardrail.detail,
      });
      if (!guardrail.ok) {
        throw new Error(`Input guardrail failed: ${guardrail.detail}`);
      }

      // ── OBSERVE → REASON (ReAct loop: refine & re-search until confident) ───
      const MAX_LOOPS = 2;
      const checkpoints = [];
      let obsJSON, rsnJSON, rsnData;
      // Steer search toward official/government sources (source-policy preference).
      let query = `${topic} official government guidance`, loops = 0, enough = false;

      while (!enough && loops < MAX_LOOPS) {
        loops++;

        // OBSERVE
        t = performance.now();
        traceStart("web_search_called", t, {model:searchProvider, tool:"web_search"});
        upd("observe",{status:"active"});
        log({type:"web_search",query:`${searchProvider} search (pass ${loops}): ${query}`});

        let search = await runSearch(query, searchProvider);

        // Source-policy self-heal: if the chosen provider returned NO official
        // (government) sources, escalate to the LLM web search — it is better at
        // surfacing primary government pages. Replace only if it does better.
        if (search.sources.filter(s=>s.type==="government").length === 0 && search.provider !== "openrouter") {
          log({type:"diff_engine",msg:"⚠ no official sources — escalating to LLM web search…"});
          try {
            const esc = await searchOpenRouter(query);
            const escOfficial = esc.sources.filter(s=>s.type==="government").length;
            if (escOfficial > 0) {
              search = { ...esc, provider:"openrouter (escalated)" };
              log({
                type:"web_search", tool:"openrouter", query,
                resultCount:esc.sources.length, status:"approved",
                urls:esc.sources.map(s=>s.url),
                why:"Escalated to LLM web search to satisfy source policy (official sources preferred)",
              });
            } else {
              log({type:"diff_engine",msg:"escalation found no official sources either — keeping original results"});
            }
          } catch(e) { log({type:"diff_engine",msg:`escalation failed: ${e.message}`}); }
        }

        obsJSON = {
          sources: search.sources,
          search_queries: [query],
          summary: search.summary || `${search.sources.length} sources retrieved via ${search.provider}.`,
        };
        upd("observe",{status:"done",data:obsJSON});
        log({
          type:"web_search", tool:search.provider, query,
          resultCount:search.sources.length,
          status:search.sources.length ? "approved" : "blocked",
          urls:search.sources.map(s=>s.url),
          why:`Gather current official sources for the policy topic (pass ${loops})`,
        });
        traceDone("web_search_called", t, {
          model:search.provider,
          tokensCost:`${search.sources.length} sources`,
          retries:loops-1,
          error:search.sources.length ? "" : "no sources recovered",
        });
        setMemory(p=>{
          // trusted sources: keep what's already known, append only genuinely new official URLs
          const known = new Set((p.trustedSources||[]).map(s=>s.url));
          const fresh = obsJSON.sources.filter(s=>s.type==="government" && !known.has(s.url));
          return {...p,
            sources:obsJSON.sources,              // run memory: current snapshot (intentionally replaced)
            trustedSources:[...(p.trustedSources||[]), ...fresh],
          };
        });
        checkpoints.push({step:"Observe", ts:Date.now(), summary:`pass ${loops}: ${obsJSON.sources.length} sources via ${search.provider}`});

        // APPROVAL GATE: human signs off on the sources before reasoning on them
        if (approvalGate==="sources" && loops===1) {
          log({type:"notifier",msg:`⏸ Awaiting human approval of ${obsJSON.sources.length} sources…`});
          const ok = await requestApproval("sources", `${obsJSON.sources.length} sources from ${searchProvider} — approve to proceed to Reason.`);
          if (!ok) { log({type:"notifier",msg:"✗ Sources rejected — run halted."}); upd("reason",{status:"idle"}); upd("act",{status:"idle"}); setStatus("idle"); return; }
          log({type:"notifier",msg:"✓ Sources approved by human."});
        }

        // REASON
        t = performance.now();
        traceStart("sources_ranked", t, {model:runModel, tool:"diff_engine"});
        upd("reason",{status:"active"});
        log({type:"diff_engine",msg:`Ranking sources, classifying impact… (pass ${loops})`});

        const rsn = await callJSON({
          model:runModel,
          messages:[
            {role:"system",content:SYS_RSN},
            {role:"user",content:`Topic: "${topic}"\nSources:\n${JSON.stringify(obsJSON,null,2)}`},
          ],
          requiredKeys:["key_findings","confidence"],
        });
        rsnData = rsn.data;
        rsnJSON = rsn.json || {key_findings:[],analysis_summary:pullText(rsnData).slice(0,220),confidence:0.7};

        const conf = Number(rsnJSON.confidence) || 0;
        enough = obsJSON.sources.length >= 2 && conf >= 0.6;
        upd("reason",{status:"done",data:rsnJSON});
        log({type:"diff_engine",msg:`Impact: ${rsnJSON.impact_level||"medium"} · Confidence: ${conf?Math.round(conf*100)+"%":"—"}${rsn.attempts>1?` · retried ${rsn.attempts-1}×`:""} · ${enough?"sufficient":(loops<MAX_LOOPS?"refining query…":"max passes reached")}`});
        traceDone("sources_ranked", t, {tokensCost:formatUsage(rsnData), retries:rsn.attempts-1, error:rsn.valid?"":"schema fallback used"});
	        checkpoints.push({step:"Reason", ts:Date.now(), summary:`pass ${loops}: confidence ${Math.round(conf*100)}%, ${rsnJSON.key_findings?.length||0} findings`});

	        // ReAct re-search: refine the query for the next Observe pass
	        if (!enough && loops < MAX_LOOPS) {
	          query = `${topic} — official government source, exact current rules with specific numbers and effective dates`;
	        }
	      }
	      const officialSources = (obsJSON?.sources || []).filter(s => s.type === "government").length;
	      if (!(obsJSON?.sources || []).length) {
	        throw new Error("Source policy failed: no sources recovered; alert was not generated.");
	      }
	      if (officialSources === 0) {
	        throw new Error("Source policy failed: no official sources recovered; alert was not generated.");
	      }

	      t = performance.now();
      traceStart("reasoning_done", t, {model:runModel, tool:"reason"});
      traceDone("reasoning_done", t, {
        tokensCost:`${loops} pass${loops>1?"es":""}`,
        retries:loops-1,
        error:rsnJSON.confidence ? "" : "confidence missing",
      });

      // ── ACT ────────────────────────────────────────────────────────────────
      const actStarted = performance.now();
      upd("act",{status:"active"});
      log({type:"summarizer",msg:"Generating PolicyPulse alert…"});

      const act = await callJSON({
        model:runModel,
        messages:[
          {role:"system",content:SYS_ACT},
          {role:"user",content:`Topic: "${topic}"\nAnalysis:\n${JSON.stringify(rsnJSON,null,2)}\nSources:\n${JSON.stringify(obsJSON.sources,null,2)}`},
        ],
        requiredKeys:["current_status","disclaimer","confidence"],
      });
      const actData = act.data;
      const actJSON = withCitationFallback(
        act.json || {current_status:pullText(actData).slice(0,220),impact_level:"medium",confidence:0.7,disclaimer:"Informational only."},
        obsJSON.sources
      );

      t = performance.now();
      traceStart("output_checked", t, {model:runModel, tool:"output_guardrail"});
      const missingOutput = [
        !actJSON.current_status && "status",
        !actJSON.disclaimer && "disclaimer",
        !actJSON.confidence && "confidence",
        !(actJSON.citations?.length) && "citations",
      ].filter(Boolean);
      traceDone("output_checked", t, {
        tokensCost:"0 tok",
        error:missingOutput.length ? `missing ${missingOutput.join(", ")}` : "",
      });
      t = performance.now();
      traceStart("alert_generated", t, {model:runModel, tool:"summarizer"});
      traceDone("alert_generated", t, {
        duration:`${Math.max(0,Math.round(performance.now()-actStarted))}ms`,
        tokensCost:formatUsage(actData),
        retries:act.attempts-1,
        error:act.valid?"":"schema fallback used",
      });
      // ── DIFF ENGINE: what changed vs the last alert for this topic ─────────
      const prevAlert = [...memory.alerts].reverse().find(a => a.topic === topic);
      const changes = diffAlerts(prevAlert?.out, actJSON);
      actJSON.changes = changes;
      log({type:"diff_engine", msg: prevAlert ? `🔺 ${changes.length} change(s) since last run` : "baseline saved (first run for this topic)"});
      checkpoints.push({step:"Act", ts:Date.now(), summary:`${actJSON.impact_level||"medium"} impact · ${changes.length} change(s)`});

      upd("act",{status:"done",data:actJSON});
      setOutput(actJSON);

      // APPROVAL GATE: human signs off on the final alert before it is persisted
      if (approvalGate==="alert") {
        log({type:"notifier",msg:"⏸ Awaiting human approval of final alert…"});
        const ok = await requestApproval("alert", actJSON.current_status || "Approve this alert before it is saved.");
        if (!ok) { log({type:"notifier",msg:"✗ Alert rejected — not saved to memory."}); setStatus("idle"); return; }
        log({type:"notifier",msg:"✓ Alert approved by human."});
      }

      const noChange = !!prevAlert && changes.length===1 && /^No material changes/i.test(changes[0]);
      setMemory(p=>({...p,
        // alerts: store the first run or a materially-changed alert; skip exact duplicates
        alerts: noChange ? p.alerts : [...p.alerts,{topic,out:actJSON,ts:Date.now()}],
        // checkpoints: per-run audit trail (each run is a distinct event)
        checkpoints:[...(p.checkpoints||[]),{run:Date.now(),topic,steps:checkpoints}],
        // preferences (topic history): add only if this topic isn't already tracked
        preferences: p.preferences.some(x=>x.topic===topic) ? p.preferences : [...p.preferences,{topic,ts:Date.now()}],
        runNote:rsnJSON.analysis_summary || obsJSON.summary || "",
      }));
      log({type:"notifier",msg: noChange
        ? "No material change — alert not re-saved (memory unchanged)"
        : `Alert saved${prevAlert?` · ${changes.length} change(s) flagged`:" · baseline"}`});
      setStatus("done");

    } catch(e) {
      traceFailActive(e.message);
      setError(e.message);
      setStatus("error");
    }
  };

  const TABS = [
    {id:"output",   label:"Output"},
    {id:"harness_trace",label:"Harness / Trace"},
    {id:"tools_log",label:"Tool calls"},
    {id:"governance",label:"Governance"},
    {id:"memory",   label:"Memory"},
    {id:"settings", label:"Settings"},
  ];

  return (
    <div style={{background:T.bg,minHeight:"100vh",padding:10,
      fontFamily:"Oxanium,sans-serif"}}>
      <style>{GLOBAL(theme)}</style>

      <div style={{display:"flex",flexDirection:"column",gap:8,
        filter:promptModalOpen?"blur(8px)":"none",transform:promptModalOpen?"scale(0.992)":"none",
        transition:"filter 0.18s ease, transform 0.18s ease",
        pointerEvents:promptModalOpen?"none":"auto",userSelect:promptModalOpen?"none":"auto"}}>
        <Header status={status} onSettings={()=>setActiveTab("settings")}
          theme={theme} onToggleTheme={toggleTheme} />

        {pending && (
          <div style={{border:`1px solid ${T.orange}`,background:`${T.orange}1a`,borderRadius:6,
            padding:"12px 16px",marginBottom:4,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <span style={{fontFamily:"Oxanium,sans-serif",fontWeight:800,fontSize:12,color:T.orange,letterSpacing:1}}>
              ⏸ APPROVAL REQUIRED — {pending.stage==="sources"?"SOURCES":"FINAL ALERT"}
            </span>
            <span style={{flex:1,minWidth:200,fontFamily:"JetBrains Mono,monospace",fontSize:10,color:T.textB}}>
              {pending.summary}
            </span>
            <button onClick={()=>resolveApproval(true)} style={{padding:"6px 16px",background:T.green,border:"none",
              borderRadius:4,color:"#000",fontFamily:"Oxanium,sans-serif",fontWeight:800,fontSize:10,letterSpacing:1,cursor:"pointer"}}>✓ APPROVE</button>
            <button onClick={()=>resolveApproval(false)} style={{padding:"6px 16px",background:T.card,border:`1px solid ${T.red}`,
              borderRadius:4,color:T.red,fontFamily:"Oxanium,sans-serif",fontWeight:800,fontSize:10,letterSpacing:1,cursor:"pointer"}}>✗ REJECT</button>
          </div>
        )}

        <ExperimentalAgentDiagram topic={topic} setTopic={setTopic}
          onPromptOpen={openPromptModal}
          onRun={engine==="python" ? runAgentPython : runAgent}
          status={status} phases={phases} toolsLog={toolsLog} memory={memory}
          searchProvider={searchProvider} setSearchProvider={updateProvider}
          approvalGate={approvalGate} setApprovalGate={updateApprovalGate}
          engine={engine} setEngine={updateEngine} />

        {/* Output section */}
        <PanelBox style={{flex:"0 0 auto",display:"flex",flexDirection:"column"}}>
          <div style={{display:"flex",gap:2,borderBottom:`1px solid ${T.border}`,
            marginBottom:6,flexShrink:0,overflowX:"auto"}}>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>{
                setActiveTab(t.id);
                if (outputScrollRef.current) {
                  outputScrollRef.current.scrollTop = 0;
                  outputScrollRef.current.scrollLeft = 0;
                }
              }}
                style={{padding:"5px 14px",background:"none",border:"none",
                  borderBottom:activeTab===t.id?`2px solid ${T.green}`:"2px solid transparent",
                  color:activeTab===t.id?T.white:T.textD,fontFamily:"Oxanium,sans-serif",
                  fontSize:10,fontWeight:700,letterSpacing:"1.5px",cursor:"pointer",
                  marginBottom:-1,textTransform:"uppercase"}}>
                {t.label}
              </button>
            ))}
          </div>
          <div ref={outputScrollRef} style={{overflow:"visible",
            padding:"6px 10px 12px"}}>
            {activeTab==="output"    && <OutputTab    output={output} error={error} />}
            {activeTab==="harness_trace" && <HarnessTraceTab traceLog={traceLog} />}
            {activeTab==="tools_log" && <ToolsLogTab  toolsLog={toolsLog} />}
            {activeTab==="governance" && <GovernanceTab topic={topic} output={output} memory={memory} />}
            {activeTab==="memory"    && <MemoryTab    memory={memory} />}
            {activeTab==="settings"  && <SettingsTab  model={model} onModelChange={updateModel} />}
          </div>
        </PanelBox>
      </div>
      {promptModalOpen && (
        <PromptModal draft={promptDraft} setDraft={setPromptDraft}
          onCancel={closePromptModal} onDone={savePromptDraft} />
      )}
    </div>
  );
}
