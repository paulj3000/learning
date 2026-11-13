"""The authored dialogue engine (LAI-NPC-011/012): pure functions over the published snapshot.

Input is one character's `dialogues` from the ACTIVE release snapshot (contract section 3), a
`ConditionContext` (whose `age_band` is the child's) and the dialogue keys this child has seen.
Nothing here touches the database, awards, unlocks, completes or writes progress. The only state
a step can change is the NPC-local flag map it returns, which `apps.npcs.state` stores in
`NpcConversationState.local_flags`.

Semantics:

- A dialogue applies when its `ageBands` (empty: every band) include the child's band, its
  `conditions` hold, and it is not a `oncePerChild` dialogue the child has already seen. The
  highest `priority` wins; ties go to the smallest `dialogueKey`. A dialogue whose start cannot
  be entered for this child (every node on the `next` path is hidden) is skipped.
- Entering a node skips forward along `next` past nodes whose own bands or conditions do not
  hold, at most `MAX_STEPS` nodes (a cycle guard). A hidden node with no `next` ends the
  conversation.
- Visible choices are the node's choices whose conditions hold. A node with no visible choice
  advances (even when it has authored choices this child cannot see, so nobody is stuck).
- Transitions only target nodes of the same dialogue; an unknown target ends the conversation.
"""

from __future__ import annotations

import dataclasses
import re
from dataclasses import dataclass

from . import conditions
from .conditions import ConditionContext
from .vocabulary import ChoiceAction

#: Most nodes `enter` walks past before giving up (cycle guard).
MAX_STEPS = 32
#: The cap on NPC-local flags per child and NPC (`NpcConversationState.MAX_LOCAL_FLAGS`).
MAX_LOCAL_FLAGS = 32
_FLAG = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


class InvalidChoice(ValueError):
    """The choice is not a visible choice of the current node, or the node has choices and the
    client asked to advance."""

    code = "invalid_choice"


@dataclass(frozen=True)
class Step:
    """The result of starting or moving a conversation.

    `node` is the node now shown, or None when the conversation ended. `local_flags` is the
    complete flag map after the step. `quest_offer` is a quest slug an OFFER_QUEST choice named;
    the caller still checks it is an active catalog quest before showing it.
    """

    node: dict | None
    local_flags: dict[str, bool]
    quest_offer: str | None = None

    @property
    def ended(self) -> bool:
        return self.node is None


def band_allows(bands: list[str] | None, age_band: str) -> bool:
    return not bands or age_band in bands


def dialogue_applies(dialogue: dict, ctx: ConditionContext, seen: set[str] | list[str]) -> bool:
    if not band_allows(dialogue.get("ageBands"), ctx.age_band):
        return False
    if dialogue.get("oncePerChild") and dialogue["dialogueKey"] in seen:
        return False
    return conditions.holds(dialogue.get("conditions"), ctx)


def candidates(dialogues: list[dict], trigger: str, ctx, seen) -> list[dict]:
    """Applicable dialogues for a trigger, best first."""
    matching = [
        d for d in dialogues if d.get("trigger") == trigger and dialogue_applies(d, ctx, seen)
    ]
    return sorted(matching, key=lambda d: (-int(d.get("priority", 0)), d["dialogueKey"]))


def node_by_key(dialogue: dict, node_key: str | None) -> dict | None:
    if not node_key:
        return None
    for node in dialogue.get("nodes", []):
        if node["nodeKey"] == node_key:
            return node
    return None


def node_visible(node: dict, ctx: ConditionContext) -> bool:
    return band_allows(node.get("ageBands"), ctx.age_band) and conditions.holds(
        node.get("conditions"), ctx
    )


def enter(dialogue: dict, node_key: str | None, ctx: ConditionContext) -> dict | None:
    """The first visible node from `node_key` following `next`, or None (the conversation ends)."""
    seen: set[str] = set()
    for _ in range(MAX_STEPS):
        node = node_by_key(dialogue, node_key)
        if node is None or node["nodeKey"] in seen:
            return None
        if node_visible(node, ctx):
            return node
        seen.add(node["nodeKey"])
        node_key = node.get("next")
    return None


def select(
    dialogues: list[dict], trigger: str, ctx: ConditionContext, seen
) -> tuple[dict, dict] | None:
    """The dialogue a trigger starts and its entered start node, or None when nothing applies."""
    for dialogue in candidates(dialogues, trigger, ctx, seen):
        node = enter(dialogue, dialogue.get("startNode"), ctx)
        if node is not None:
            return dialogue, node
    return None


def visible_choices(node: dict, ctx: ConditionContext) -> list[dict]:
    return [c for c in node.get("choices", []) if conditions.holds(c.get("conditions"), ctx)]


def is_flag(value: object) -> bool:
    return isinstance(value, str) and bool(_FLAG.match(value))


def with_flag(flags: dict[str, bool], flag: object) -> dict[str, bool]:
    """`flags` with `flag` set true. An invalid flag, or a new one past the cap, changes nothing."""
    result = dict(flags)
    if not is_flag(flag):
        return result
    if flag not in result and len(result) >= MAX_LOCAL_FLAGS:
        return result
    result[flag] = True
    return result


def choose(dialogue: dict, node: dict, choice_key: str, ctx: ConditionContext) -> Step:
    """Apply a visible choice of `node`, then move to its `next` or end."""
    choice = next((c for c in visible_choices(node, ctx) if c["choiceKey"] == choice_key), None)
    if choice is None:
        raise InvalidChoice(choice_key)
    action = choice.get("action", ChoiceAction.NONE)
    flags = dict(ctx.local_flags)
    offer = None
    if action == ChoiceAction.SET_LOCAL_FLAG:
        flags = with_flag(flags, choice.get("actionValue"))
    elif action == ChoiceAction.OFFER_QUEST:
        value = choice.get("actionValue")
        offer = value if isinstance(value, str) and value else None
    elif action not in ChoiceAction.values:
        raise InvalidChoice(choice_key)  # fail closed on an action outside the closed set
    if action == ChoiceAction.END:
        return Step(node=None, local_flags=flags, quest_offer=offer)
    moved = dataclasses.replace(ctx, local_flags=flags)
    return Step(
        node=enter(dialogue, choice.get("next"), moved), local_flags=flags, quest_offer=offer
    )


def advance(dialogue: dict, node: dict, ctx: ConditionContext) -> Step:
    """Move past a node the child cannot choose on. A node with visible choices refuses."""
    if visible_choices(node, ctx):
        raise InvalidChoice(node["nodeKey"])
    return Step(node=enter(dialogue, node.get("next"), ctx), local_flags=dict(ctx.local_flags))
