"""Part 3 demo — run the full agent end-to-end (the Python equivalent of clicking RUN AGENT).

Usage:
    python3 -m policypulse.run_agent "UK Skilled Worker visa minimum salary 2026" tavily

Run it twice on the same topic to see the diff engine + memory dedup in action.
State persists in .policypulse-memory.json (in the current directory).
"""
import sys

from .memory import Memory
from .pipeline import run_agent


def _mark(c: dict) -> str:
    if c["pending"]:
        return "  · "
    if c["warn"]:
        return "WARN"
    return "PASS" if c["ok"] else "FAIL"


def main() -> None:
    topic = sys.argv[1] if len(sys.argv) > 1 else "German student visa work rules"
    provider = sys.argv[2] if len(sys.argv) > 2 else "tavily"

    mem = Memory(".policypulse-memory.json")
    print(f"=== PolicyPulse agent ===\ntopic:    {topic}\nprovider: {provider}\n")

    try:
        result = run_agent(topic, provider, memory=mem)
    except ValueError as e:
        print(f"error: {e}")
        raise SystemExit(2) from None
    a = result["alert"]

    print("\n──────── ALERT ────────")
    print(f"impact: {a.get('impact_level')} · confidence: {int(float(a.get('confidence') or 0) * 100)}%")
    print(f"current status:  {a.get('current_status')}")
    if a.get("why_it_matters"):
        print(f"why it matters:  {a['why_it_matters']}")
    if a.get("who_is_affected"):
        print(f"who is affected: {a['who_is_affected']}")
    for kn in a.get("key_numbers") or []:
        print(f"  - {kn.get('label')}: {kn.get('value')}")
    if a.get("recommended_action"):
        print(f"recommended:     {a['recommended_action']}")
    for i, c in enumerate(a.get("citations") or [], 1):
        print(f"  [{i}] {c.get('source_title', '')[:60]}  {c.get('url', '')}")

    print("\n──────── WHAT CHANGED ────────")
    for line in result["changes"]:
        print(f"  + {line}")

    print("\n──────── GOVERNANCE ────────")
    for c in result["governance"]:
        print(f"  [{_mark(c)}] {c['label']}: {c['detail']}")

    print("\n──────── CHECKPOINTS ────────")
    for cp in result["checkpoints"]:
        print(f"  {cp['step']:<8} {cp['summary']}")

    saved = "saved" if result["saved"] else "no material change — not re-saved"
    print(f"\nmemory -> {mem.path}  (alert {saved})")


if __name__ == "__main__":
    main()
