"""The agent pipeline: Observe → Reason → Act, as a ReAct loop. Mirrors `runAgent` in the JS app.

Steps:
  1. Observe  — search for official sources (with provider fallback + escalation)
  2. Reason   — rank/analyse sources, extract rules (schema-validated, retrying)
  3. (loop)   — if confidence is low / sources weak, refine the query and re-Observe (capped)
  4. Act      — produce the actionable alert
  5. Diff     — compare against the last stored alert for the topic
  6. Memory   — idempotent writes + checkpoints
"""
import json
import time

from . import config
from .diff import diff_alerts
from .governance import check_topic, governance_checks
from .llm import call_json, pull_text
from .memory import Memory
from .prompts import SYS_ACT, SYS_RSN
from .search import run_search, search_with_source_policy

MAX_LOOPS = 2


def _now() -> int:
    return int(time.time() * 1000)


def _with_citation_fallback(output: dict, sources: list) -> dict:
    """If Act omitted citations, backfill them from the recovered sources."""
    if output.get("citations") or not sources:
        return output
    output = dict(output)
    output["citations"] = [
        {
            "text": s.get("key_info") or f"Source used for {output.get('current_status', 'the alert')}",
            "source_title": s.get("title") or s.get("url"),
            "url": s.get("url"),
        }
        for s in sources[:3]
    ]
    return output


def run_agent(topic: str, provider: str = "tavily", memory: Memory | None = None, log=print) -> dict:
    guardrail = check_topic(topic)
    if not guardrail["ok"]:
        raise ValueError(f"Input guardrail failed: {guardrail['detail']}")

    mem = memory or Memory()
    checkpoints: list = []
    obs: dict = {"sources": [], "summary": "", "provider": provider}
    rsn_json: dict = {}
    query = f"{topic} official government guidance"   # steer toward official sources
    loops, enough = 0, False

    def checkpoint(step: str, summary: str) -> None:
        checkpoints.append({"step": step, "ts": _now(), "summary": summary})

    # ── OBSERVE → REASON (ReAct loop) ─────────────────────────────────────────
    while not enough and loops < MAX_LOOPS:
        loops += 1

        log(f"[observe pass {loops}] {query}")
        # first pass uses source-policy self-heal (escalates if no official sources)
        search = search_with_source_policy(query, provider) if loops == 1 else run_search(query, provider)
        obs = {"sources": search["sources"], "summary": search.get("summary") or "",
               "provider": search.get("provider", provider)}
        log(f"            -> {len(obs['sources'])} sources via {obs['provider']}")
        mem.set_run_sources(obs["sources"])
        checkpoint("Observe", f"pass {loops}: {len(obs['sources'])} sources via {obs['provider']}")

        log(f"[reason  pass {loops}] analysing...")
        rsn = call_json(
            messages=[
                {"role": "system", "content": SYS_RSN},
                {"role": "user", "content":
                    f'Topic: "{topic}"\nSearch summary:\n{obs["summary"]}\n'
                    f'Sources:\n{json.dumps({"sources": obs["sources"]}, indent=2)}'},
            ],
            required_keys=["key_findings", "confidence"],
        )
        rsn_json = rsn["json"] or {
            "key_findings": [], "analysis_summary": pull_text(rsn["data"])[:220], "confidence": 0.7}
        conf = float(rsn_json.get("confidence") or 0)
        enough = len(obs["sources"]) >= 2 and conf >= 0.6
        decision = "sufficient" if enough else ("refining query..." if loops < MAX_LOOPS else "max passes")
        log(f"            -> confidence {int(conf * 100)}% · {decision}")
        checkpoint("Reason", f"pass {loops}: confidence {int(conf * 100)}%, "
                             f"{len(rsn_json.get('key_findings') or [])} findings")
        if not enough and loops < MAX_LOOPS:
            query = f"{topic} — official government source, exact current rules with specific numbers and effective dates"

    official_sources = sum(1 for s in obs["sources"] if s.get("type") == "government")
    if not obs["sources"]:
        raise RuntimeError("Source policy failed: no sources recovered; alert was not generated.")
    if official_sources == 0:
        raise RuntimeError("Source policy failed: no official sources recovered; alert was not generated.")

    # ── ACT ───────────────────────────────────────────────────────────────────
    log("[act] generating alert...")
    act = call_json(
        messages=[
            {"role": "system", "content": SYS_ACT},
            {"role": "user", "content":
                f'Topic: "{topic}"\nAnalysis:\n{json.dumps(rsn_json, indent=2)}\n'
                f'Sources:\n{json.dumps(obs["sources"], indent=2)}'},
        ],
        required_keys=["current_status", "disclaimer", "confidence"],
    )
    alert = act["json"] or {
        "current_status": pull_text(act["data"])[:220], "impact_level": "medium",
        "confidence": 0.7, "disclaimer": "Informational only."}
    alert = _with_citation_fallback(alert, obs["sources"])

    # ── DIFF ──────────────────────────────────────────────────────────────────
    prev = mem.last_alert(topic)
    changes = diff_alerts(prev, alert)
    alert["changes"] = changes
    no_change = bool(prev) and len(changes) == 1 and changes[0].startswith("No material changes")
    checkpoint("Act", f"{alert.get('impact_level', 'medium')} impact · {len(changes)} change(s)")

    # ── MEMORY (idempotent) ───────────────────────────────────────────────────
    if not no_change:
        mem.add_alert(topic, alert, _now())
    mem.add_preference(topic, _now())
    mem.add_checkpoint(topic, checkpoints, _now())
    mem.data["runNote"] = rsn_json.get("analysis_summary") or obs.get("summary") or ""
    mem.save()

    return {
        "model": config.DEFAULT_MODEL,
        "alert": alert,
        "changes": changes,
        "obs": obs,
        "reason": rsn_json,
        "governance": governance_checks(topic, alert, obs["sources"]),
        "checkpoints": checkpoints,
        "loops": loops,
        "saved": not no_change,
    }
