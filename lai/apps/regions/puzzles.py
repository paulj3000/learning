"""Puzzle kinds: parameter rules and server-side graders (ADR-043 F, LAI-0812).

The mechanics are code; their parameters are authored content, edited in Django Admin as
versioned revisions of an `AreaPuzzle`. Each kind defines:

- `band_problems(params)`: what makes one age band's parameters invalid (every problem, never
  raises). Admin publishing refuses a body with any problem.
- `grade(params, submission)`: whether a submission solves the puzzle. Raises `InvalidSubmission`
  for a malformed one, so nothing is recorded for it.

Every kind is deterministic and fully described by its parameters, so the Three.js client can
simulate the same rules for instant feedback while the server stays the only judge (ADR-019
sub-decision 8). No kind needs a secret answer: the valve puzzle, for instance, is a graph of
channels the child reasons about, not a hidden order to guess.

Body shape (one revision):

    {"puzzleId", "kind", "title", "requiresChangeKeys": [...], "worldChangeKey",
     "rewardRuleId": str | null, "ageBands": {"PATHFINDER": {...}, "EXPLORER": {...}}}

Each band's parameters share `intro` (required), `hints` (0 to 4, shown when the child asks,
and offered after `hintAfterAttempts` tries), `completeMessage`, and `scienceNote` (optional,
an accurate explanation for the child's band). Adding a band later is adding a key.
"""

import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from apps.users.models import AgeBand

from .models import PuzzleKind

SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MAX_HINTS = 4


class InvalidSubmission(ValueError):
    """The submission does not have the kind's shape."""

    code = "invalid_submission"


def _text(params: dict, key: str, problems: list[str], where: str, *, optional=False) -> None:
    value = params.get(key)
    if value is None and optional:
        return
    if not isinstance(value, str) or not value.strip():
        problems.append(f"{where}.{key}: must be non-empty text")


def _items(
    params: dict, key: str, problems: list[str], where: str, low: int, high: int
) -> list[dict]:
    value = params.get(key)
    if not isinstance(value, list) or not low <= len(value) <= high:
        problems.append(f"{where}.{key}: must be a list of {low} to {high} entries")
        return []
    if not all(isinstance(item, dict) for item in value):
        problems.append(f"{where}.{key}: every entry must be an object")
        return []
    ids = [item.get("id") for item in value]
    for index, item_id in enumerate(ids):
        if not isinstance(item_id, str) or not SLUG.match(item_id):
            problems.append(f"{where}.{key}[{index}].id: must be a lowercase slug")
    if len(set(map(str, ids))) != len(ids):
        problems.append(f"{where}.{key}: ids must be unique")
    for index, item in enumerate(value):
        _text(item, "label", problems, f"{where}.{key}[{index}]")
    return value


def _int(item: dict, key: str, low: int, high: int, problems: list[str], where: str) -> None:
    value = item.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
        problems.append(f"{where}.{key}: must be a whole number from {low} to {high}")


def _common(params: dict, problems: list[str], where: str, allowed: set[str]) -> None:
    _text(params, "intro", problems, where)
    _text(params, "completeMessage", problems, where, optional=True)
    _text(params, "scienceNote", problems, where, optional=True)
    hints = params.get("hints", [])
    if not isinstance(hints, list) or len(hints) > MAX_HINTS:
        problems.append(f"{where}.hints: must be a list of at most {MAX_HINTS} hints")
    elif not all(isinstance(hint, str) and hint.strip() for hint in hints):
        problems.append(f"{where}.hints: every hint must be non-empty text")
    if "hintAfterAttempts" in params:
        _int(params, "hintAfterAttempts", 1, 5, problems, where)
    unknown = (
        set(params)
        - allowed
        - {
            "intro",
            "completeMessage",
            "scienceNote",
            "hints",
            "hintAfterAttempts",
        }
    )
    if unknown:
        problems.append(f"{where}: unknown settings {', '.join(sorted(unknown))}")


def _list_of_ids(submission: dict, key: str) -> list[str]:
    value = submission.get(key)
    if not isinstance(value, list) or len(value) > 20 or not all(isinstance(v, str) for v in value):
        raise InvalidSubmission
    return value


def _closed(submission: object, keys: set[str]) -> dict:
    if not isinstance(submission, dict) or set(submission) - keys:
        raise InvalidSubmission
    return submission


# --- OBSERVE_FEATURES: look at every feature (the telescope) -------------------------------------


def _observe_problems(params: dict, where: str) -> list[str]:
    problems: list[str] = []
    _common(params, problems, where, {"features"})
    for index, feature in enumerate(_items(params, "features", problems, where, 1, 6)):
        _text(feature, "explanation", problems, f"{where}.features[{index}]")
    return problems


def _observe_grade(params: dict, submission: object) -> bool:
    observed = _list_of_ids(_closed(submission, {"observed"}), "observed")
    return set(observed) == {feature["id"] for feature in params["features"]}


# --- PLACE_PLATFORMS: one stone per gap, its size matching the gap (the lava crossing) ------------


def _platform_problems(params: dict, where: str) -> list[str]:
    problems: list[str] = []
    _common(params, problems, where, {"stones", "slots", "showOutlines"})
    stones = _items(params, "stones", problems, where, 1, 6)
    slots = _items(params, "slots", problems, where, 1, 5)
    for index, stone in enumerate(stones):
        _int(stone, "size", 1, 4, problems, f"{where}.stones[{index}]")
    for index, slot in enumerate(slots):
        _int(slot, "gap", 1, 4, problems, f"{where}.slots[{index}]")
    if "showOutlines" in params and not isinstance(params["showOutlines"], bool):
        problems.append(f"{where}.showOutlines: must be true or false")
    if not problems:
        sizes = Counter(stone["size"] for stone in stones)
        gaps = Counter(slot["gap"] for slot in slots)
        if any(sizes[gap] < count for gap, count in gaps.items()):
            problems.append(f"{where}: some gap has no stone of its size, so it cannot be solved")
    return problems


def _platform_grade(params: dict, submission: object) -> bool:
    placements = _closed(submission, {"placements"}).get("placements")
    if not isinstance(placements, dict) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in placements.items()
    ):
        raise InvalidSubmission
    stones = {stone["id"]: stone["size"] for stone in params["stones"]}
    slots = {slot["id"]: slot["gap"] for slot in params["slots"]}
    if set(placements) - set(slots) or set(placements.values()) - set(stones):
        raise InvalidSubmission
    if set(placements) != set(slots) or len(set(placements.values())) != len(placements):
        return False
    return all(stones[stone] == slots[slot] for slot, stone in placements.items())


# --- VALVE_SEQUENCE: move the steam along channels to the vent (the steam passage) ----------------


def _valve_problems(params: dict, where: str) -> list[str]:
    problems: list[str] = []
    _common(params, problems, where, {"channels", "start", "goal", "valves", "showSteamPath"})
    channels = _items(params, "channels", problems, where, 2, 6)
    valves = _items(params, "valves", problems, where, 2, 5)
    channel_ids = {channel.get("id") for channel in channels}
    for key in ("start", "goal"):
        if params.get(key) not in channel_ids:
            problems.append(f"{where}.{key}: must be one of the channels")
    if params.get("start") == params.get("goal"):
        problems.append(f"{where}: the steam must start somewhere other than the goal")
    for index, valve in enumerate(valves):
        for key in ("from", "to"):
            if valve.get(key) not in channel_ids:
                problems.append(f"{where}.valves[{index}].{key}: must be one of the channels")
        if valve.get("from") == valve.get("to"):
            problems.append(f"{where}.valves[{index}]: must move steam somewhere else")
    if "showSteamPath" in params and not isinstance(params["showSteamPath"], bool):
        problems.append(f"{where}.showSteamPath: must be true or false")
    if not problems and solve_valves(params) is None:
        problems.append(f"{where}: no order of valves moves the steam to the goal")
    return problems


def simulate_valves(params: dict, sequence: list[str]) -> str:
    """Where the steam ends. A valve whose `from` channel has no steam does nothing."""
    valves = {valve["id"]: valve for valve in params["valves"]}
    steam = params["start"]
    for valve_id in sequence:
        valve = valves[valve_id]
        if valve["from"] == steam:
            steam = valve["to"]
    return steam


def solve_valves(params: dict) -> list[str] | None:
    """The shortest valve order that brings the steam to the goal, using each valve once."""
    frontier: list[tuple[str, list[str]]] = [(params["start"], [])]
    while frontier:
        steam, used = frontier.pop(0)
        if steam == params["goal"]:
            return used
        for valve in params["valves"]:
            if valve["id"] not in used and valve["from"] == steam:
                frontier.append((valve["to"], [*used, valve["id"]]))
    return None


def _valve_grade(params: dict, submission: object) -> bool:
    sequence = _list_of_ids(_closed(submission, {"sequence"}), "sequence")
    if set(sequence) - {valve["id"] for valve in params["valves"]}:
        raise InvalidSubmission
    return simulate_valves(params, sequence) == params["goal"]


# --- COLLECT_OBJECT and RETURN_TO_NPC: no answer; the stage order is the rule -------------------


def _collect_problems(params: dict, where: str) -> list[str]:
    problems: list[str] = []
    _common(params, problems, where, {"discoveryMessage"})
    _text(params, "discoveryMessage", problems, where)
    return problems


def _return_problems(params: dict, where: str) -> list[str]:
    problems: list[str] = []
    _common(params, problems, where, {"npcEntityId"})
    _text(params, "npcEntityId", problems, where)
    return problems


def _no_answer(params: dict, submission: object) -> bool:
    _closed(submission, set())
    return True


@dataclass(frozen=True)
class PuzzleRules:
    band_problems: Callable[[dict, str], list[str]]
    grade: Callable[[dict, object], bool]


RULES: dict[str, PuzzleRules] = {
    PuzzleKind.OBSERVE_FEATURES: PuzzleRules(_observe_problems, _observe_grade),
    PuzzleKind.PLACE_PLATFORMS: PuzzleRules(_platform_problems, _platform_grade),
    PuzzleKind.VALVE_SEQUENCE: PuzzleRules(_valve_problems, _valve_grade),
    PuzzleKind.COLLECT_OBJECT: PuzzleRules(_collect_problems, _no_answer),
    PuzzleKind.RETURN_TO_NPC: PuzzleRules(_return_problems, _no_answer),
}
BODY_KEYS = {
    "puzzleId",
    "kind",
    "title",
    "requiresChangeKeys",
    "worldChangeKey",
    "rewardRuleId",
    "ageBands",
}


def body_problems(kind: str, body: Any) -> list[str]:
    """Every problem with a puzzle body, apart from references the database must check."""
    if not isinstance(body, dict):
        return ["$: must be a JSON object"]
    problems: list[str] = []
    unknown = set(body) - BODY_KEYS
    if unknown:
        problems.append(f"$: unknown keys {', '.join(sorted(unknown))}")
    if body.get("kind") != kind:
        problems.append(f"$.kind: must stay {kind} (the mechanic is code)")
    if not isinstance(body.get("title"), str) or not body["title"].strip():
        problems.append("$.title: must be non-empty text")
    change_key = body.get("worldChangeKey")
    if not isinstance(change_key, str) or not re.match(r"^[A-Z0-9_]{3,80}$", change_key):
        problems.append("$.worldChangeKey: must be UPPER_SNAKE_CASE")
    required = body.get("requiresChangeKeys")
    if not isinstance(required, list) or not all(isinstance(k, str) for k in required):
        problems.append("$.requiresChangeKeys: must be a list of change keys")
    elif change_key in required:
        problems.append("$.requiresChangeKeys: a puzzle cannot require its own change")
    rule = body.get("rewardRuleId")
    if rule is not None and not isinstance(rule, str):
        problems.append("$.rewardRuleId: must be a reward rule id or null")
    bands = body.get("ageBands")
    if not isinstance(bands, dict) or not bands:
        problems.append("$.ageBands: needs parameters for at least one age band")
        return problems
    rules = RULES.get(kind)
    for band, params in bands.items():
        if band not in AgeBand.values:
            problems.append(f"$.ageBands.{band}: not an age band")
        elif not isinstance(params, dict):
            problems.append(f"$.ageBands.{band}: must be an object")
        elif rules is not None:
            problems.extend(rules.band_problems(params, f"$.ageBands.{band}"))
    return problems


def grade(kind: str, params: dict, submission: object) -> bool:
    return RULES[kind].grade(params, submission)
