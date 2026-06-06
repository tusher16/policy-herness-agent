"""diff_engine: what changed between the previous alert and the new one (mirrors diffAlerts)."""


def diff_alerts(prev: dict | None, nxt: dict) -> list:
    """Return human-readable change lines, or a baseline / no-change message."""
    if not prev:
        return ["First run for this topic — baseline saved."]

    out = []
    if prev.get("current_status") != nxt.get("current_status"):
        out.append(
            "Status changed:\n"
            f"  was: {prev.get('current_status')}\n"
            f"  now: {nxt.get('current_status')}"
        )
    if prev.get("impact_level") != nxt.get("impact_level"):
        out.append(f"Impact level: {prev.get('impact_level') or '—'} → {nxt.get('impact_level') or '—'}")

    def to_map(arr):
        return {k.get("label"): k.get("value") for k in (arr or [])}

    pn, nn = to_map(prev.get("key_numbers")), to_map(nxt.get("key_numbers"))
    for label, val in nn.items():
        if label not in pn:
            out.append(f"New figure — {label}: {val}")
        elif pn[label] != val:
            out.append(f"{label}: {pn[label]} → {val}")

    return out or ["No material changes since last run."]
