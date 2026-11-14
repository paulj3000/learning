"""NPC relationships on the server (AMP-03): the Django form of `react/src/features/npc/api.ts`.

**No new model.** The record is `NpcRelationship`; the dialogue is the catalog `NpcDefinition`'s
imported `source` (the content export). The client names the dialogue node it showed; the
server decides what that is worth, with the client's rules (`dialogue.ts`, `relationship.ts`):

- the node must be one of that NPC's authored nodes;
- its authored memory flags are set (only ever to true; nothing here clears a flag);
- its authored relationship points are awarded the first time the node is seen, never again;
- the level is derived from the points (`level_for_points`), never sent by the client.

The row is locked for the write, so concurrent requests cannot lose an update.
"""

from django.db import transaction
from django.utils import timezone

from apps.catalog.models import NpcDefinition

from .models import NpcRelationship, RelationshipLevel

# react/src/features/npc/relationship.ts RELATIONSHIP_THRESHOLDS, in ladder order.
RELATIONSHIP_THRESHOLDS = (
    (RelationshipLevel.STRANGER, 0),
    (RelationshipLevel.ACQUAINTANCE, 2),
    (RelationshipLevel.FRIEND, 6),
    (RelationshipLevel.TRUSTED_FRIEND, 12),
)


class UnknownNpc(LookupError):
    pass


class UnknownDialogueNode(LookupError):
    pass


def level_for_points(points: int) -> str:
    level = RelationshipLevel.STRANGER
    for candidate, threshold in RELATIONSHIP_THRESHOLDS:
        if points >= threshold:
            level = candidate
    return level


def _npc(npc_id: str) -> NpcDefinition:
    npc = NpcDefinition.objects.filter(npc_id=npc_id).first()
    if npc is None:
        raise UnknownNpc(npc_id)
    return npc


def is_known_npc(npc_id: str) -> bool:
    return NpcDefinition.objects.filter(npc_id=npc_id).exists()


def record_dialogue(child, npc_id: str, node_id: str, *, now=None):
    """Apply one shown dialogue node. Returns (relationship, previous level)."""
    npc = _npc(npc_id)
    node = next(
        (
            n
            for n in npc.source.get("dialogue", [])
            if isinstance(n, dict) and n.get("id") == node_id
        ),
        None,
    )
    if node is None:
        raise UnknownDialogueNode(node_id)
    at = now or timezone.now()
    with transaction.atomic():
        NpcRelationship.objects.get_or_create(
            child=child,
            npc_id=npc_id,
            defaults={
                "relationship_level": RelationshipLevel.STRANGER,
                "memory_flags": {},
                "first_met_at": at,
                "last_interacted_at": at,
            },
        )
        relationship = NpcRelationship.objects.select_for_update().get(child=child, npc_id=npc_id)
        previous = level_for_points(relationship.relationship_points)
        seen = list(relationship.seen_node_ids)
        if node_id not in seen:
            award = node.get("awardsRelationshipPoints") or 0
            if isinstance(award, int) and not isinstance(award, bool) and award > 0:
                relationship.relationship_points += award
            seen.append(node_id)
        flags = dict(relationship.memory_flags or {})
        for flag in node.get("setsMemoryFlags", []) or []:
            if isinstance(flag, str) and flag:
                flags[flag] = True
        relationship.memory_flags = flags
        relationship.seen_node_ids = seen
        relationship.relationship_level = level_for_points(relationship.relationship_points)
        relationship.last_interacted_at = max(at, relationship.last_interacted_at)
        relationship.save()
        return relationship, previous


def set_memory_flags(child, npc_id: str, flags, *, now=None) -> NpcRelationship:
    """Set authored flags to true without a dialogue (a finished quest's `setsNpcMemoryFlags`).

    Awards no points. Creates the row for an NPC the child has not met yet, as the client did.
    Callers pass only flags read from content, never request values.
    """
    at = now or timezone.now()
    with transaction.atomic():
        NpcRelationship.objects.get_or_create(
            child=child,
            npc_id=npc_id,
            defaults={
                "relationship_level": RelationshipLevel.STRANGER,
                "memory_flags": {},
                "first_met_at": at,
                "last_interacted_at": at,
            },
        )
        relationship = NpcRelationship.objects.select_for_update().get(child=child, npc_id=npc_id)
        memory = dict(relationship.memory_flags or {})
        memory.update({flag: True for flag in flags if isinstance(flag, str) and flag})
        relationship.memory_flags = memory
        relationship.last_interacted_at = max(at, relationship.last_interacted_at)
        relationship.save(update_fields=["memory_flags", "last_interacted_at"])
        return relationship
