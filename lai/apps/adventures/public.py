"""What a child's client may read of an authored step (LAI-0503, ADR-047 K).

Pure functions over the exported step record, no Django. A step read must never carry the
answer: the correct value, the accepted options, the order, the pairing, the hint ladder (its
later rungs give the answer away) or the transitions (which branch is "correct"). Grading,
hints and advancing stay on the server (`session-answers`, `session-hints`).
"""

import hashlib
from typing import Any

Step = dict[str, Any]

# Keys removed from a presentation, per kind. Everything else is served as authored.
_ANSWER_KEYS = {
    "number-input": ("correctValue",),
    "choice": ("correctOptionId",),
    "ordering": ("correctOrder",),
    "short-response": ("acceptedOptionIds",),
}


def _stable_shuffle(items: list, seed: str, avoid: list | None = None) -> list:
    """A repeatable order that is the same for every child, and never the authored answer."""
    ordered = sorted(items, key=lambda item: hashlib.sha256(f"{seed}:{item}".encode()).hexdigest())
    if avoid is not None and len(ordered) > 1 and ordered == avoid:
        ordered = ordered[1:] + ordered[:1]
    return ordered


def public_presentation(presentation: dict, step_id: str) -> dict:
    kind = presentation.get("kind")
    shown = {k: v for k, v in presentation.items() if k not in _ANSWER_KEYS.get(kind, ())}
    if kind == "ordering":
        correct = list(presentation.get("correctOrder", []))
        by_id = {item["id"]: item for item in presentation.get("items", [])}
        ids = list(by_id)
        shown["items"] = [
            by_id[i]
            for i in _stable_shuffle(
                ids, step_id, avoid=correct if set(ids) == set(correct) else None
            )
        ]
    elif kind == "matching":
        pairs = presentation.get("pairs", [])
        shown.pop("pairs", None)
        shown["left"] = [{"id": p["leftId"]} for p in pairs]
        shown["right"] = [
            {"id": i} for i in _stable_shuffle([p["rightId"] for p in pairs], step_id)
        ]
    return shown


def public_step(step: Step) -> dict:
    """One step as a client may read it: no answers, hints or transitions."""
    return {
        "id": step["id"],
        "type": step["type"],
        "objectiveIds": list(step.get("objectiveIds", [])),
        "presentation": public_presentation(step["presentation"], step["id"]),
        # Whether the hint button has anything behind it; the ladder itself is only served one
        # rung at a time by the hints route.
        "hasHints": bool(step.get("hintPolicy")),
    }
