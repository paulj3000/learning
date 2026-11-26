"""Puzzle kinds: parameter rules and server-side graders (ADR-047 F, LAI-0812).

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

Each band's parameters share `hints` (0 to 4, shown when the child asks, and offered after
`hintAfterAttempts` tries). Adding a band later is adding a key.

What a character says about a puzzle (`intro`, `completeMessage`, `scienceNote`) is not a
parameter: it is NPC dialogue, a node with `puzzleLine` and `ageBands` (LAI-0817, FP-D9). The
3D Area bootstrap adds those lines to the parameters it serves (`play_state.puzzle_states`), so
the client reads them where it always has. `MOVED_TO_DIALOGUE` names them; a new revision that
still carries one is refused.
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


# LAI-0817 (FP-D9): these lines are NPC dialogue now, not puzzle parameters.
MOVED_TO_DIALOGUE = ("intro", "completeMessage", "scienceNote")


def _common(params: dict, problems: list[str], where: str, allowed: set[str]) -> None:
    for key in MOVED_TO_DIALOGUE:
        if key in params:
            problems.append(
                f"{where}.{key}: is NPC dialogue now (a node with puzzleLine), not a parameter"
            )
    hints = params.get("hints", [])
    if not isinstance(hints, list) or len(hints) > MAX_HINTS:
        problems.append(f"{where}.hints: must be a list of at most {MAX_HINTS} hints")
    elif not all(isinstance(hint, str) and hint.strip() for hint in hints):
        problems.append(f"{where}.hints: every hint must be non-empty text")
    if "hintAfterAttempts" in params:
        _int(params, "hintAfterAttempts", 1, 5, problems, where)
    unknown = set(params) - allowed - set(MOVED_TO_DIALOGUE) - {"hints", "hintAfterAttempts"}
    if unknown:
        problems.append(f"{where}: unknown settings {', '.join(sorted(unknown))}")


def _optional_skill(params: dict, problems: list[str], where: str) -> None:
    """Issue #102: a movement mechanic may name the concept its grader checks (matching a stone
    to a gap is comparing lengths; routing steam is cause and effect). Absent means the puzzle is
    an ordinary accomplishment and records no skill evidence."""
    if "skill" in params and (
        not isinstance(params["skill"], str) or not SLUG.match(params["skill"])
    ):
        problems.append(f"{where}.skill: must be a lowercase slug")


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
    _common(params, problems, where, {"stones", "slots", "showOutlines", "skill"})
    _optional_skill(params, problems, where)
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
    _common(
        params, problems, where, {"channels", "start", "goal", "valves", "showSteamPath", "skill"}
    )
    _optional_skill(params, problems, where)
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


# --- CHOOSE_ANSWER and ORDER_SEQUENCE: pick one answer, or put items in order (FPV, design 5) -----

PRESENTATIONS = {
    PuzzleKind.CHOOSE_ANSWER: {"PLATFORMS", "SAMPLES", "SHAPES", "PATHS", "CRYSTALS", "CARDS"},
    PuzzleKind.ORDER_SEQUENCE: {"SWITCHES", "CRYSTALS", "STORY", "PATH", "MAP_PIECES"},
    PuzzleKind.NAVIGATE_ROUTE: {"MAP", "GRID", "TRAIL"},
    PuzzleKind.SORT_ITEMS: {"BINS", "SHELVES", "NESTS"},
    PuzzleKind.SHARE_ITEMS: {"CHESTS", "BASKETS", "BARRELS"},
}
SUBJECTS = {"MATHEMATICS", "EARTH_SCIENCE", "LIFE_SCIENCE", "LITERACY", "LOGIC"}
SYMBOLS = {"circle", "square", "triangle", "star", "diamond", "hexagon", "heart", "moon"}
MAX_VARIANTS = 8
MAX_PROMPT, MAX_EXPLANATION, MAX_LABEL = 200, 240, 60


def _bounded(item: dict, key: str, limit: int, problems: list[str], where: str) -> None:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        problems.append(f"{where}.{key}: must be non-empty text")
    elif len(value) > limit:
        problems.append(f"{where}.{key}: must be at most {limit} characters")


def _symbols(entries: list[dict], problems: list[str], where: str) -> None:
    for index, entry in enumerate(entries):
        symbol = entry.get("symbol")
        if symbol is not None and symbol not in SYMBOLS:
            problems.append(f"{where}[{index}].symbol: must be one of {', '.join(sorted(SYMBOLS))}")
        label = entry.get("label")
        if isinstance(label, str) and len(label) > MAX_LABEL:
            problems.append(f"{where}[{index}].label: must be at most {MAX_LABEL} characters")


def _entity_map(params: dict, key: str, problems: list[str], where: str) -> dict:
    mapping = params.get(key)
    if mapping is None:
        return {}
    if not isinstance(mapping, dict) or not mapping:
        problems.append(f"{where}.{key}: must be an object of ids to placement ids")
        return {}
    for ref, entity in mapping.items():
        if not isinstance(ref, str) or not SLUG.match(ref):
            problems.append(f"{where}.{key}: key {ref!r} must be a lowercase slug")
        if not isinstance(entity, str) or not SLUG.match(entity):
            problems.append(f"{where}.{key}.{ref}: must be a placement id (a lowercase slug)")
    values = [v for v in mapping.values() if isinstance(v, str)]
    if len(set(values)) != len(values):
        problems.append(f"{where}.{key}: each id needs its own placement")
    return mapping


def _quiz_common(kind: str, params: dict, problems: list[str], where: str, allowed: set) -> list:
    _common(params, problems, where, {"presentation", "subject", "skill", "variants"} | allowed)
    if params.get("presentation") not in PRESENTATIONS[kind]:
        problems.append(
            f"{where}.presentation: must be one of {', '.join(sorted(PRESENTATIONS[kind]))}"
        )
    if params.get("subject") not in SUBJECTS:
        problems.append(f"{where}.subject: must be one of {', '.join(sorted(SUBJECTS))}")
    skill = params.get("skill")
    if not isinstance(skill, str) or not SLUG.match(skill):
        problems.append(f"{where}.skill: must be a lowercase slug")
    variants = params.get("variants")
    if not isinstance(variants, list) or not 1 <= len(variants) <= MAX_VARIANTS:
        problems.append(f"{where}.variants: must be a list of 1 to {MAX_VARIANTS} variants")
        return []
    if not all(isinstance(v, dict) for v in variants):
        problems.append(f"{where}.variants: every entry must be an object")
        return []
    ids = [v.get("id") for v in variants]
    for index, variant_id in enumerate(ids):
        if not isinstance(variant_id, str) or not SLUG.match(variant_id):
            problems.append(f"{where}.variants[{index}].id: must be a lowercase slug")
    if len(set(map(str, ids))) != len(ids):
        problems.append(f"{where}.variants: ids must be unique")
    return variants


def _variant_skill(variant: dict, problems: list[str], where: str) -> None:
    """An optional per-variant `skill` (FPV-D10) overrides the band's `skill` for that variant."""
    if "skill" in variant and (
        not isinstance(variant["skill"], str) or not SLUG.match(variant["skill"])
    ):
        problems.append(f"{where}.skill: must be a lowercase slug")


def _check_entities(mapping: dict, entries: list[dict], problems: list[str], where: str) -> None:
    if mapping and {e.get("id") for e in entries if isinstance(e, dict)} != set(mapping):
        problems.append(f"{where}: ids must equal the keys of the entity map")


def _choose_problems(params: dict, where: str) -> list[str]:
    problems: list[str] = []
    variants = _quiz_common(PuzzleKind.CHOOSE_ANSWER, params, problems, where, {"optionEntities"})
    mapping = _entity_map(params, "optionEntities", problems, where)
    for index, variant in enumerate(variants):
        at = f"{where}.variants[{index}]"
        _bounded(variant, "prompt", MAX_PROMPT, problems, at)
        _bounded(variant, "explanation", MAX_EXPLANATION, problems, at)
        options = _items(variant, "options", problems, at, 2, 4)
        _symbols(options, problems, f"{at}.options")
        _check_entities(mapping, options, problems, f"{at}.options")
        if variant.get("answer") not in {o.get("id") for o in options}:
            problems.append(f"{at}.answer: must be one of the options")
        _variant_skill(variant, problems, at)
        extra = set(variant) - {"id", "prompt", "options", "answer", "explanation", "skill"}
        if extra:
            problems.append(f"{at}: unknown settings {', '.join(sorted(extra))}")
    return problems


def _order_problems(params: dict, where: str) -> list[str]:
    problems: list[str] = []
    variants = _quiz_common(PuzzleKind.ORDER_SEQUENCE, params, problems, where, {"itemEntities"})
    mapping = _entity_map(params, "itemEntities", problems, where)
    for index, variant in enumerate(variants):
        at = f"{where}.variants[{index}]"
        _bounded(variant, "prompt", MAX_PROMPT, problems, at)
        _bounded(variant, "explanation", MAX_EXPLANATION, problems, at)
        items = _items(variant, "items", problems, at, 2, 6)
        _symbols(items, problems, f"{at}.items")
        _check_entities(mapping, items, problems, f"{at}.items")
        answer = variant.get("answer")
        item_ids = [i.get("id") for i in items]
        if (
            not isinstance(answer, list)
            or not all(isinstance(a, str) for a in answer)
            or sorted(answer) != sorted(map(str, item_ids))
        ):
            problems.append(f"{at}.answer: must list every item exactly once")
        _variant_skill(variant, problems, at)
        extra = set(variant) - {"id", "prompt", "items", "answer", "explanation", "skill"}
        if extra:
            problems.append(f"{at}: unknown settings {', '.join(sorted(extra))}")
    return problems


def _variant(params: dict, submission: dict) -> dict:
    variant_id = submission.get("variantId")
    if not isinstance(variant_id, str):
        raise InvalidSubmission
    found = next((v for v in params["variants"] if v["id"] == variant_id), None)
    if found is None:
        raise InvalidSubmission
    return found


def _choose_grade(params: dict, submission: object) -> bool:
    data = _closed(submission, {"variantId", "choice"})
    variant = _variant(params, data)
    choice = data.get("choice")
    if not isinstance(choice, str) or choice not in {o["id"] for o in variant["options"]}:
        raise InvalidSubmission
    return choice == variant["answer"]


def _order_grade(params: dict, submission: object) -> bool:
    data = _closed(submission, {"variantId", "order"})
    variant = _variant(params, data)
    order = _list_of_ids(data, "order")
    if sorted(order) != sorted(item["id"] for item in variant["items"]):
        raise InvalidSubmission
    return order == variant["answer"]


# --- NAVIGATE_ROUTE, SORT_ITEMS, SHARE_ITEMS: interactive learning mechanics (issue #102) --------
#
# Each is a quiz-style kind (presentation, subject, skill, variants) so replay variation and
# per-variant skills work as for CHOOSE_ANSWER. The child's action *is* the answer: walking a
# route, dropping items into bins, sharing coins into chests. A movement alone never grades
# true; the grader checks the concept (a reached goal, a correct bin, an equal share).

MOVES = {"N": (0, -1), "E": (1, 0), "S": (0, 1), "W": (-1, 0)}
MAX_GRID, MAX_MOVES, MAX_SHARE_TOTAL = 6, 12, 20


def _cell(value, columns: int, rows: int) -> tuple[int, int] | None:
    if (
        isinstance(value, list)
        and len(value) == 2
        and all(isinstance(v, int) and not isinstance(v, bool) for v in value)
        and 0 <= value[0] < columns
        and 0 <= value[1] < rows
    ):
        return value[0], value[1]
    return None


def shortest_route(variant: dict) -> int | None:
    """The fewest moves from start to goal around blocked cells, or None when unreachable."""
    columns, rows = variant["columns"], variant["rows"]
    start, goal = tuple(variant["start"]), tuple(variant["goal"])
    blocked = {tuple(cell) for cell in variant.get("blocked", [])}
    frontier, seen = [(start, 0)], {start}
    while frontier:
        (x, y), steps = frontier.pop(0)
        if (x, y) == goal:
            return steps
        for dx, dy in MOVES.values():
            nxt = (x + dx, y + dy)
            if 0 <= nxt[0] < columns and 0 <= nxt[1] < rows and nxt not in blocked | seen:
                seen.add(nxt)
                frontier.append((nxt, steps + 1))
    return None


def walk_route(variant: dict, moves: list[str]) -> tuple[int, int] | None:
    """Where the moves end, or None if one leaves the map or enters a blocked cell."""
    columns, rows = variant["columns"], variant["rows"]
    blocked = {tuple(cell) for cell in variant.get("blocked", [])}
    x, y = variant["start"]
    for move in moves:
        dx, dy = MOVES[move]
        x, y = x + dx, y + dy
        if not (0 <= x < columns and 0 <= y < rows) or (x, y) in blocked:
            return None
    return x, y


def _route_problems(params: dict, where: str) -> list[str]:
    problems: list[str] = []
    variants = _quiz_common(PuzzleKind.NAVIGATE_ROUTE, params, problems, where, set())
    for index, variant in enumerate(variants):
        at = f"{where}.variants[{index}]"
        _bounded(variant, "prompt", MAX_PROMPT, problems, at)
        if "explanation" in variant:
            _bounded(variant, "explanation", MAX_EXPLANATION, problems, at)
        _int(variant, "columns", 2, MAX_GRID, problems, at)
        _int(variant, "rows", 2, MAX_GRID, problems, at)
        _int(variant, "maxMoves", 1, MAX_MOVES, problems, at)
        _variant_skill(variant, problems, at)
        extra = set(variant) - {
            "id",
            "prompt",
            "explanation",
            "columns",
            "rows",
            "start",
            "goal",
            "blocked",
            "maxMoves",
            "skill",
        }
        if extra:
            problems.append(f"{at}: unknown settings {', '.join(sorted(extra))}")
        if any(p.startswith(at) for p in problems):
            continue
        columns, rows = variant["columns"], variant["rows"]
        start, goal = (
            _cell(variant.get("start"), columns, rows),
            _cell(variant.get("goal"), columns, rows),
        )
        if start is None or goal is None:
            problems.append(f"{at}: start and goal must be [column, row] cells on the map")
            continue
        blocked = variant.get("blocked", [])
        if not isinstance(blocked, list) or any(_cell(c, columns, rows) is None for c in blocked):
            problems.append(f"{at}.blocked: must be a list of [column, row] cells on the map")
            continue
        if {start, goal} & {tuple(c) for c in blocked}:
            problems.append(f"{at}.blocked: the start and goal cannot be blocked")
            continue
        if start == goal:
            problems.append(f"{at}: the goal must be somewhere other than the start")
            continue
        steps = shortest_route(variant)
        if steps is None or steps > variant["maxMoves"]:
            problems.append(
                f"{at}: no route reaches the goal within maxMoves, so it cannot be solved"
            )
    return problems


def _route_grade(params: dict, submission: object) -> bool:
    data = _closed(submission, {"variantId", "moves"})
    variant = _variant(params, data)
    moves = data.get("moves")
    if (
        not isinstance(moves, list)
        or len(moves) > 2 * MAX_MOVES
        or not all(isinstance(m, str) and m in MOVES for m in moves)
    ):
        raise InvalidSubmission
    if len(moves) > variant["maxMoves"]:
        return False
    return walk_route(variant, moves) == tuple(variant["goal"])


def _sort_problems(params: dict, where: str) -> list[str]:
    problems: list[str] = []
    variants = _quiz_common(
        PuzzleKind.SORT_ITEMS, params, problems, where, {"itemEntities", "binEntities"}
    )
    item_map = _entity_map(params, "itemEntities", problems, where)
    bin_map = _entity_map(params, "binEntities", problems, where)
    for index, variant in enumerate(variants):
        at = f"{where}.variants[{index}]"
        _bounded(variant, "prompt", MAX_PROMPT, problems, at)
        if "explanation" in variant:
            _bounded(variant, "explanation", MAX_EXPLANATION, problems, at)
        bins = _items(variant, "bins", problems, at, 2, 4)
        items = _items(variant, "items", problems, at, 2, 8)
        _symbols(bins, problems, f"{at}.bins")
        _symbols(items, problems, f"{at}.items")
        _check_entities(bin_map, bins, problems, f"{at}.bins")
        _check_entities(item_map, items, problems, f"{at}.items")
        bin_ids = {b.get("id") for b in bins}
        for item_index, item in enumerate(items):
            if item.get("bin") not in bin_ids:
                problems.append(f"{at}.items[{item_index}].bin: must be one of the bins")
        if items and bins and {i.get("bin") for i in items} != bin_ids:
            problems.append(f"{at}.bins: every bin needs at least one item")
        _variant_skill(variant, problems, at)
        extra = set(variant) - {"id", "prompt", "explanation", "bins", "items", "skill"}
        if extra:
            problems.append(f"{at}: unknown settings {', '.join(sorted(extra))}")
    return problems


def _sort_grade(params: dict, submission: object) -> bool:
    data = _closed(submission, {"variantId", "placements"})
    variant = _variant(params, data)
    placements = data.get("placements")
    bins = {b["id"] for b in variant["bins"]}
    items = {i["id"]: i["bin"] for i in variant["items"]}
    if (
        not isinstance(placements, dict)
        or not all(isinstance(k, str) and isinstance(v, str) for k, v in placements.items())
        or set(placements) - set(items)
        or set(placements.values()) - bins
    ):
        raise InvalidSubmission
    return placements == items


def _share_problems(params: dict, where: str) -> list[str]:
    problems: list[str] = []
    variants = _quiz_common(PuzzleKind.SHARE_ITEMS, params, problems, where, {"containerEntities"})
    mapping = _entity_map(params, "containerEntities", problems, where)
    for index, variant in enumerate(variants):
        at = f"{where}.variants[{index}]"
        _bounded(variant, "prompt", MAX_PROMPT, problems, at)
        if "explanation" in variant:
            _bounded(variant, "explanation", MAX_EXPLANATION, problems, at)
        _int(variant, "total", 2, MAX_SHARE_TOTAL, problems, at)
        containers = _items(variant, "containers", problems, at, 2, 5)
        _symbols(containers, problems, f"{at}.containers")
        _check_entities(mapping, containers, problems, f"{at}.containers")
        for c_index, container in enumerate(containers):
            _int(container, "target", 0, MAX_SHARE_TOTAL, problems, f"{at}.containers[{c_index}]")
        _variant_skill(variant, problems, at)
        extra = set(variant) - {"id", "prompt", "explanation", "total", "containers", "skill"}
        if extra:
            problems.append(f"{at}: unknown settings {', '.join(sorted(extra))}")
        if not any(p.startswith(at) for p in problems):
            if sum(c["target"] for c in containers) != variant["total"]:
                problems.append(f"{at}: the container targets must add up to the total")
    return problems


def _share_grade(params: dict, submission: object) -> bool:
    data = _closed(submission, {"variantId", "counts"})
    variant = _variant(params, data)
    counts = data.get("counts")
    targets = {c["id"]: c["target"] for c in variant["containers"]}
    if (
        not isinstance(counts, dict)
        or set(counts) - set(targets)
        or not all(
            isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= variant["total"]
            for v in counts.values()
        )
    ):
        raise InvalidSubmission
    return all(counts.get(cid, 0) == target for cid, target in targets.items())


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
    PuzzleKind.CHOOSE_ANSWER: PuzzleRules(_choose_problems, _choose_grade),
    PuzzleKind.ORDER_SEQUENCE: PuzzleRules(_order_problems, _order_grade),
    PuzzleKind.NAVIGATE_ROUTE: PuzzleRules(_route_problems, _route_grade),
    PuzzleKind.SORT_ITEMS: PuzzleRules(_sort_problems, _sort_grade),
    PuzzleKind.SHARE_ITEMS: PuzzleRules(_share_problems, _share_grade),
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


#: Quiz-style kinds: a required band `skill`, variants (replay variation), and an optional
#: per-variant `skill` (FPV-D10). Every graded submission is an educational decision.
SKILL_KINDS = frozenset(
    {
        PuzzleKind.CHOOSE_ANSWER,
        PuzzleKind.ORDER_SEQUENCE,
        PuzzleKind.NAVIGATE_ROUTE,
        PuzzleKind.SORT_ITEMS,
        PuzzleKind.SHARE_ITEMS,
    }
)
#: Movement kinds whose grader checks a concept, so they *may* name a `skill` (issue #102):
#: matching a stone to its gap is comparing lengths, routing steam is cause and effect.
OPTIONAL_SKILL_KINDS = frozenset({PuzzleKind.PLACE_PLATFORMS, PuzzleKind.VALVE_SEQUENCE})
#: Every kind that can record skill evidence. OBSERVE_FEATURES, COLLECT_OBJECT and RETURN_TO_NPC
#: never do: looking, picking up, jumping to or walking back are accomplishments, not evidence.
EVIDENCE_KINDS = SKILL_KINDS | OPTIONAL_SKILL_KINDS


def skill_for(kind: str, params: dict, submission: object) -> str | None:
    """The skill a graded submission practised: its variant's `skill`, else the band's.

    None for a kind that teaches no curriculum skill, or a movement kind that names none. Call it
    after `grade`, which has already refused a malformed submission or an unknown variant.
    """
    if kind not in EVIDENCE_KINDS:
        return None
    variant = (
        _variant(params, submission) if kind in SKILL_KINDS and isinstance(submission, dict) else {}
    )
    skill = variant.get("skill") or params.get("skill")
    return skill if isinstance(skill, str) and skill else None
