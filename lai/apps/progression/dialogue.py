"""Server-authoritative NPC conversations (LAI-0605).

The client never says which node it reached. It asks to **talk** (the server selects the entry
node with `select_dialogue_node`) or to take a **choice** from a node the child was already shown
(the server follows it with `advance_dialogue`). Both are evaluated against the child's server
records, with the golden-vector port in `apps.progression.npc`. So a client cannot jump to a node
it was not led to, set a flag no shown node sets, or earn points twice.

Showing a node applies the client's former `recordDialogueNode`: its memory flags every time,
its relationship points the first time, and the node marked seen. In the same transaction it
then:
- moves the child's active quests (TALK_TO, HELP_NPC and DELIVER read memory flags;
  RELATIONSHIP_AT_LEAST reads the level);
- grants the authored NPC_RELATIONSHIP rewards (LAI-0604) for every level the child newly
  reached.

The Amplify client never fired those rewards; Django honours the authored rules, and adds none.

Trust boundary: being near the NPC is not verifiable on the server, so talking is accepted from
anywhere. The server verifies everything the conversation's effects depend on. `TIME_OF_DAY`
conditions cannot be evaluated (the server does not know the child's clock), so they never hold
on the server. No exported dialogue uses them.
"""

from dataclasses import dataclass, field

from django.db import transaction
from django.utils import timezone

from apps.catalog.models import ContentRelease, NpcDefinition
from apps.inventory import services as inventory
from apps.quests.services import refresh_active_quests
from apps.quests.models import QuestProgress, QuestStatus

from . import npc
from .models import NpcRelationship
from .services import world_change_keys


class NpcNotVisible(Exception):
    """Unknown, inactive, or not in the latest content release: a 404."""


class ChoiceNotAvailable(Exception):
    """The node was not shown to this child, or has no such choice for them now: a 409."""

    code = "dialogue_choice_unavailable"


@dataclass
class TalkResult:
    npc: NpcDefinition
    node: dict | None
    """The node shown now, or None: nothing to say (talk) or the conversation ended (choice)."""
    context: dict
    """The context after the node's effects, for the choices the child may take next."""
    relationship: NpcRelationship | None
    level_increased: bool = False
    quest_updates: list = field(default_factory=list)
    rewards: list = field(default_factory=list)


def visible_npc(npc_id: str) -> NpcDefinition:
    release = ContentRelease.objects.order_by("-imported_at", "-id").first()
    definition = NpcDefinition.objects.filter(
        npc_id=npc_id, active=True, last_seen_release=release
    ).first()
    if definition is None:
        raise NpcNotVisible
    return definition


def npc_context(child, relationship: NpcRelationship | None) -> dict:
    """`NpcContext` from server records. `timeOfDay` is unknown on the server (see above)."""
    points = relationship.relationship_points if relationship else 0
    completed = QuestProgress.objects.for_child(child).filter(status=QuestStatus.COMPLETED)
    return {
        "timeOfDay": None,
        "relationshipLevel": npc.relationship_level_for_points(points),
        "memoryFlags": npc.parse_memory_flags(relationship.memory_flags) if relationship else {},
        "worldChangeKeys": sorted(world_change_keys(child)),
        "completedQuestIds": sorted(completed.values_list("quest__slug", flat=True)),
    }


def _locked_relationship(child, npc_id: str) -> NpcRelationship | None:
    return NpcRelationship.objects.select_for_update().filter(child=child, npc_id=npc_id).first()


def _show(child, definition, node: dict, relationship, at) -> tuple[NpcRelationship, bool]:
    """`recordDialogueNode`: flags every time, points the first time, node marked seen."""
    seen = list(relationship.seen_node_ids) if relationship else []
    points = relationship.relationship_points if relationship else 0
    flags = npc.parse_memory_flags(relationship.memory_flags) if relationship else {}
    outcome = npc.dialogue_outcome(node, seen)
    previous_level = npc.relationship_level_for_points(points)
    points = npc.award_relationship_points(points, outcome["relationshipPointsAwarded"])
    level = npc.relationship_level_for_points(points)
    fields = {
        "relationship_points": points,
        "relationship_level": level,
        "memory_flags": npc.set_memory_flags(flags, outcome["memoryFlagsToSet"]),
        "seen_node_ids": seen if node["id"] in seen else [*seen, node["id"]],
        "last_interacted_at": at,
    }
    if relationship is None:
        relationship, created = NpcRelationship.objects.get_or_create(
            child=child, npc_id=definition.npc_id, defaults={**fields, "first_met_at": at}
        )
        if not created:  # a concurrent first talk won the row: apply on top of it
            return _show(child, definition, node, _locked_relationship(child, definition.npc_id), at)
        return relationship, level != previous_level
    for name, value in fields.items():
        setattr(relationship, name, value)
    relationship.save(update_fields=list(fields))
    return relationship, level != previous_level


def _levels_reached(previous_points: int, points: int) -> list[str]:
    before = npc.RELATIONSHIP_LEVEL_ORDER.index(npc.relationship_level_for_points(previous_points))
    after = npc.RELATIONSHIP_LEVEL_ORDER.index(npc.relationship_level_for_points(points))
    return list(npc.RELATIONSHIP_LEVEL_ORDER[before + 1 : after + 1])


@transaction.atomic
def converse(child, npc_id: str, *, from_node_id=None, choice_id=None, now=None) -> TalkResult:
    """Talk (no choice) or take a choice; show the node the authored rules lead to."""
    definition = visible_npc(npc_id)
    source = definition.source if isinstance(definition.source, dict) else {}
    relationship = _locked_relationship(child, definition.npc_id)
    context = npc_context(child, relationship)

    if choice_id is None:
        node = npc.select_dialogue_node(source, context)
    else:
        seen = relationship.seen_node_ids if relationship else []
        from_node = npc.find_dialogue_node(source, from_node_id) if from_node_id in seen else None
        if from_node is None:
            raise ChoiceNotAvailable
        choice = next(
            (c for c in npc.available_choices(from_node, context) if c.get("id") == choice_id),
            None,
        )
        if choice is None:
            raise ChoiceNotAvailable
        node = npc.advance_dialogue(source, choice, context)

    if node is None:
        return TalkResult(definition, None, context, relationship)

    previous_points = relationship.relationship_points if relationship else 0
    at = now or timezone.now()
    relationship, level_increased = _show(child, definition, node, relationship, at)
    updates = refresh_active_quests(child)
    rewards = [grant for update in updates for grant in update.rewards]
    for level in _levels_reached(previous_points, relationship.relationship_points):
        rewards += inventory.grant_for_trigger(
            child, {"type": "NPC_RELATIONSHIP", "npcId": definition.npc_id, "level": level}
        )
    return TalkResult(
        definition,
        node,
        npc_context(child, relationship),
        relationship,
        level_increased=level_increased,
        quest_updates=updates,
        rewards=rewards,
    )
