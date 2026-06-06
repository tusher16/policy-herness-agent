"""Part 1 demo — run a search for a topic and print the sources. Standalone & non-breaking.

Usage:
    python3 -m policypulse.demo_search "UK Skilled Worker visa minimum salary 2026" tavily
    python3 -m policypulse.demo_search "German student visa work rules" openrouter
"""
import sys

from . import config
from .search import search_with_source_policy


def main() -> None:
    topic = sys.argv[1] if len(sys.argv) > 1 else "German student visa work rules"
    provider = sys.argv[2] if len(sys.argv) > 2 else "tavily"

    print(f"env file:        {config.ENV_FILE}")
    print(f"search provider: {provider}")
    print(f"topic:           {topic}\n")

    res = search_with_source_policy(topic, provider)
    official = sum(1 for s in res["sources"] if s["type"] == "government")
    print(f"→ provider used: {res['provider']}   |   {len(res['sources'])} sources, {official} official\n")

    if res.get("summary"):
        print(f"answer: {res['summary']}\n")

    for i, s in enumerate(res["sources"], 1):
        tag = "GOV" if s["type"] == "government" else "src"
        print(f"[{i}] ({tag}, {int(s['reliability'] * 100)}%) {s['title'][:68]}")
        print(f"     {s['url']}")


if __name__ == "__main__":
    main()
