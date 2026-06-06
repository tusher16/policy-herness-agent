"""Memory store: JSON persistence + idempotent, dedup-aware updates.

Mirrors the JS memory logic: run memory (current sources), user preferences (topic history),
source memory (trusted official URLs), alerts, and checkpoints — all "add only if new".
"""
import json
from pathlib import Path

_SECTIONS = ("sources", "preferences", "alerts", "checkpoints", "trustedSources")


def _empty() -> dict:
    return {**{k: [] for k in _SECTIONS}, "runNote": ""}


def dedupe_memory(mem: dict) -> dict:
    """Drop legacy duplicate topics / trusted URLs, keeping the first occurrence of each."""
    seen_topic, seen_url = set(), set()
    prefs = []
    for p in mem.get("preferences") or []:
        topic = (p or {}).get("topic")
        if p and topic not in seen_topic:
            seen_topic.add(topic)
            prefs.append(p)
    trusted = []
    for s in mem.get("trustedSources") or []:
        url = (s or {}).get("url")
        if s and url and url not in seen_url:
            seen_url.add(url)
            trusted.append(s)
    return {**mem, "preferences": prefs, "trustedSources": trusted}


class Memory:
    def __init__(self, path: str | None = None):
        self.path = Path(path) if path else None
        self.data = dedupe_memory({**_empty(), **(self._load() or {})})

    def _load(self):
        if self.path and self.path.exists():
            try:
                return json.loads(self.path.read_text())
            except json.JSONDecodeError as e:
                raise RuntimeError(f"Memory file is corrupt: {self.path}") from e
        return None

    def save(self) -> None:
        if self.path:
            tmp = self.path.with_name(f".{self.path.name}.tmp")
            tmp.write_text(json.dumps(self.data, indent=2, ensure_ascii=False))
            tmp.replace(self.path)

    # ── idempotent updates ────────────────────────────────────────────────────
    def set_run_sources(self, sources: list) -> None:
        """Run memory = current snapshot; trusted sources = keep existing, add only new official URLs."""
        self.data["sources"] = sources
        known = {s.get("url") for s in self.data["trustedSources"]}
        fresh = [s for s in sources if s.get("type") == "government" and s.get("url") not in known]
        self.data["trustedSources"].extend(fresh)

    def add_preference(self, topic: str, ts: int) -> None:
        if not any(p.get("topic") == topic for p in self.data["preferences"]):
            self.data["preferences"].append({"topic": topic, "ts": ts})

    def last_alert(self, topic: str):
        for a in reversed(self.data["alerts"]):
            if a.get("topic") == topic:
                return a.get("out")
        return None

    def add_alert(self, topic: str, alert: dict, ts: int) -> None:
        self.data["alerts"].append({"topic": topic, "out": alert, "ts": ts})

    def add_checkpoint(self, topic: str, steps: list, run_ts: int) -> None:
        self.data["checkpoints"].append({"run": run_ts, "topic": topic, "steps": steps})
