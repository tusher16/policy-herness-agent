"""Part 2 demo — Observe (search) → Reason (call_json) → Governance + Diff.

Usage:
    python3 -m policypulse.demo_part2 "UK Skilled Worker visa minimum salary 2026" tavily
"""
import json
import sys

from .diff import diff_alerts
from .governance import governance_checks
from .llm import call_json
from .prompts import SYS_RSN
from .search import search_with_source_policy


def main() -> None:
    topic = sys.argv[1] if len(sys.argv) > 1 else "German student visa work rules"
    provider = sys.argv[2] if len(sys.argv) > 2 else "tavily"
    print(f"topic: {topic}\n")

    # 1) OBSERVE
    obs = search_with_source_policy(topic, provider)
    print(f"OBSERVE → {len(obs['sources'])} sources via {obs['provider']}")

    # 2) REASON (schema-validated, retrying)
    rsn = call_json(
        messages=[
                {"role": "system", "content": SYS_RSN},
                {"role": "user", "content":
                    f'Topic: "{topic}"\nSearch summary:\n{obs.get("summary") or ""}\n'
                    f'Sources:\n{json.dumps({"sources": obs["sources"]}, indent=2)}'},
        ],
        required_keys=["key_findings", "confidence"],
    )
    r = rsn["json"] or {}
    print(f"REASON  → valid={rsn['valid']} retries={rsn['attempts'] - 1} "
          f"confidence={r.get('confidence')} findings={len(r.get('key_findings') or [])}")
    if r.get("analysis_summary"):
        print(f"          summary: {r['analysis_summary']}")

    # 3) GOVERNANCE (no Act output yet → citation/output checks are pending)
    print("\nGOVERNANCE:")
    for c in governance_checks(topic, None, obs["sources"]):
        mark = "·" if c["pending"] else ("!" if c["warn"] else ("PASS" if c["ok"] else "FAIL"))
        print(f"  [{mark:>4}] {c['label']}: {c['detail']}")

    # 4) DIFF ENGINE (hand-made before/after to show the change detection)
    print("\nDIFF (demo — last run £38,700 → new run £41,700):")
    prev = {"current_status": "Threshold is £38,700.", "impact_level": "medium",
            "key_numbers": [{"label": "General threshold", "value": "£38,700"}]}
    nxt = {"current_status": "Threshold is £41,700.", "impact_level": "high",
           "key_numbers": [{"label": "General threshold", "value": "£41,700"},
                           {"label": "New entrant", "value": "£33,400"}]}
    for line in diff_alerts(prev, nxt):
        print(f"  * {line}")


if __name__ == "__main__":
    main()
