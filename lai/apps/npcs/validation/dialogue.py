"""Release validation: dialogue (workstream C, LAI-NPC-011/012).

Called by `apps.npcs.validation.release_problems` with the built snapshot. Returns problems in
words staff can act on and never raises. Reads the content catalog (quests) only, never child
data.

Checks per dialogue: at least one node; the start node is set and present; every `next` (node
and choice) names a node of the same dialogue; no cycle made only of choice-less nodes; every
node reachable from the start; text and labels within limits, with no URL and no em dash; choice
actions from the closed set with the right value (OFFER_QUEST: an active catalog quest;
SET_LOCAL_FLAG: a flag slug that is not a quest memory flag); conditions well formed; every age
band the dialogue serves reaches a start node. Per character: two dialogues for the same trigger
with the same priority, the same conditions and overlapping age bands are ambiguous.
"""

from __future__ import annotations

import json

from apps.ai.content_safety import contains_url
from apps.users.models import AgeBand

from .. import conditions
from ..dialogue import is_flag
from ..models import MAX_LABEL_LENGTH, MAX_LINE_LENGTH
from ..vocabulary import ANIMATION_STATES, ChoiceAction, Emotion

EM_DASH = "—"
_VALUE_ACTIONS = (ChoiceAction.SET_LOCAL_FLAG, ChoiceAction.OFFER_QUEST)


def problems(snapshot: dict) -> list[str]:
    found: list[str] = []
    catalog = _Catalog()
    for npc_id, character in snapshot.get("characters", {}).items():
        dialogues = character.get("dialogues") or []
        for dialogue in dialogues:
            found.extend(_dialogue_problems(npc_id, character, dialogue, catalog))
        found.extend(_ambiguity_problems(npc_id, dialogues))
    return found


class _Catalog:
    """Lazy, cached catalog reads (quests only)."""

    def __init__(self):
        self._active: set[str] | None = None
        self._memory_flags: set[str] | None = None

    def active_quests(self) -> set[str]:
        if self._active is None:
            from apps.catalog.models import Quest

            self._active = set(Quest.objects.filter(active=True).values_list("slug", flat=True))
        return self._active

    def memory_flags(self) -> set[str]:
        """Every quest objective's `memoryFlag` (owned by `NpcRelationship`, never NPC-local)."""
        if self._memory_flags is None:
            from apps.catalog.models import Quest

            flags: set[str] = set()
            for source in Quest.objects.values_list("source", flat=True):
                for stage in (source or {}).get("stages", []) or []:
                    for objective in (stage or {}).get("objectives", []) or []:
                        flag = (objective or {}).get("memoryFlag")
                        if isinstance(flag, str) and flag:
                            flags.add(flag)
            self._memory_flags = flags
        return self._memory_flags


def _copy_problems(text: object, where: str, limit: int) -> list[str]:
    if not isinstance(text, str) or not text.strip():
        return [f"{where} is empty"]
    found = []
    if len(text) > limit:
        found.append(f"{where} is longer than {limit} characters")
    if contains_url(text.lower()):
        found.append(f"{where} contains a web address")
    if EM_DASH in text:
        found.append(f"{where} contains an em dash; use a comma or a full stop")
    return found


def _dialogue_problems(npc_id: str, character: dict, dialogue: dict, catalog) -> list[str]:
    where = f"{npc_id} dialogue {dialogue.get('dialogueKey')}"
    nodes = dialogue.get("nodes") or []
    found = conditions.problems(dialogue.get("conditions"), f"{where} conditions")
    if not nodes:
        return [*found, f"{where} has no nodes"]
    by_key = {node["nodeKey"]: node for node in nodes}
    start = dialogue.get("startNode")
    if not start:
        found.append(f"{where} has no start node")
    elif start not in by_key:
        found.append(f"{where} start node {start} is not in this dialogue")

    for node in nodes:
        at = f"{where} node {node['nodeKey']}"
        found.extend(_copy_problems(node.get("text"), f"{at} text", MAX_LINE_LENGTH))
        found.extend(conditions.problems(node.get("conditions"), f"{at} conditions"))
        if node.get("emotion") not in Emotion.values:
            found.append(f"{at} has an unknown emotion {node.get('emotion')!r}")
        state = node.get("animationState")
        if state and state not in ANIMATION_STATES:
            found.append(f"{at} has an unknown animation state {state!r}")
        if node.get("next") is not None and node["next"] not in by_key:
            found.append(f"{at} leads to {node['next']}, which is not in this dialogue")
        for choice in node.get("choices") or []:
            found.extend(_choice_problems(f"{at} choice {choice['choiceKey']}", choice, by_key))
            found.extend(_action_problems(f"{at} choice {choice['choiceKey']}", choice, catalog))

    found.extend(_cycle_problems(where, nodes, by_key))
    if start in by_key:
        reachable = _reachable(start, by_key)
        for node in nodes:
            if node["nodeKey"] not in reachable:
                found.append(f"{where} node {node['nodeKey']} cannot be reached from the start")
        found.extend(_coverage_problems(where, character, dialogue, by_key))
    return found


def _choice_problems(at: str, choice: dict, by_key: dict) -> list[str]:
    found = _copy_problems(choice.get("label"), f"{at} label", MAX_LABEL_LENGTH)
    found.extend(conditions.problems(choice.get("conditions"), f"{at} conditions"))
    target = choice.get("next")
    if target is not None and target not in by_key:
        found.append(f"{at} leads to {target}, which is not in this dialogue")
    return found


def _action_problems(at: str, choice: dict, catalog) -> list[str]:
    action, value = choice.get("action"), choice.get("actionValue")
    if action not in ChoiceAction.values:
        return [f"{at} has an unknown action {action!r}"]
    if action not in _VALUE_ACTIONS:
        return [f"{at}: {action} takes no value"] if value else []
    if not value:
        return [f"{at}: {action} needs a value"]
    if action == ChoiceAction.OFFER_QUEST and value not in catalog.active_quests():
        return [f"{at} offers quest {value}, which is not an active quest"]
    if action == ChoiceAction.SET_LOCAL_FLAG:
        if not is_flag(value):
            return [f"{at} sets flag {value!r}, which is not a valid flag name"]
        if value in catalog.memory_flags():
            return [
                f"{at} sets flag {value}, which is a quest memory flag; "
                "NPC dialogue may only set its own flags"
            ]
    return []


def _cycle_problems(where: str, nodes: list[dict], by_key: dict) -> list[str]:
    """A loop of choice-less nodes would advance forever."""
    found: list[str] = []
    reported: set[str] = set()
    for node in nodes:
        path: list[str] = []
        key: str | None = node["nodeKey"]
        while key in by_key and not by_key[key].get("choices") and key not in path:
            path.append(key)
            key = by_key[key].get("next")
        if key in path:
            loop = path[path.index(key) :]
            if not reported.intersection(loop):
                reported.update(loop)
                found.append(f"{where} loops forever through {' -> '.join([*loop, key])}")
    return found


def _reachable(start: str, by_key: dict) -> set[str]:
    seen: set[str] = set()
    todo = [start]
    while todo:
        key = todo.pop()
        if key in seen or key not in by_key:
            continue
        seen.add(key)
        node = by_key[key]
        todo.append(node.get("next"))
        todo.extend(choice.get("next") for choice in node.get("choices") or [])
    return seen


def _served_bands(character: dict, dialogue: dict) -> list[str]:
    bands = list(AgeBand.values)
    for limit in (character.get("ageBands"), dialogue.get("ageBands")):
        if limit:
            bands = [b for b in bands if b in limit]
    return bands


def _coverage_problems(where: str, character: dict, dialogue: dict, by_key: dict) -> list[str]:
    """Each served band must find a node it may see on the start node's `next` path."""
    found = []
    for band in _served_bands(character, dialogue):
        key, seen = dialogue["startNode"], set()
        reached = False
        while key in by_key and key not in seen:
            seen.add(key)
            bands = by_key[key].get("ageBands")
            if not bands or band in bands:
                reached = True
                break
            key = by_key[key].get("next")
        if not reached:
            found.append(f"{where} has no start line for age band {band}")
    return found


def _canonical(value) -> str:
    return json.dumps(value or [], sort_keys=True)


def _ambiguity_problems(npc_id: str, dialogues: list[dict]) -> list[str]:
    found = []
    for index, first in enumerate(dialogues):
        for second in dialogues[index + 1 :]:
            if first.get("trigger") != second.get("trigger"):
                continue
            if first.get("priority", 0) != second.get("priority", 0):
                continue
            if _canonical(first.get("conditions")) != _canonical(second.get("conditions")):
                continue
            a, b = set(first.get("ageBands") or []), set(second.get("ageBands") or [])
            if a and b and not a & b:
                continue
            keys = sorted([first["dialogueKey"], second["dialogueKey"]])
            found.append(
                f"{npc_id} dialogues {keys[0]} and {keys[1]} answer {first.get('trigger')} with "
                "the same priority and conditions; give one a higher priority or a condition"
            )
    return found
