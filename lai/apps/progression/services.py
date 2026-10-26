"""World change writes (LAI-0305; Treasure Rush's `record_world_change_once`, POST-MERGE-03)."""

from django.db import transaction
from django.utils import timezone

from apps.core.models import CrossChildReference
from apps.progression import npc
from apps.progression.models import NpcRelationship, WorldChange


def record_world_change(
    child,
    *,
    location_slug: str,
    change_type: str,
    change_key: str,
    payload=None,
    source_session=None,
    source_session_id: str = "",
    now=None,
) -> tuple[WorldChange, bool]:
    """Idempotent: the same (location, change key) for a child is recorded once.

    Safe under concurrency: the unique constraint decides, and a losing concurrent insert
    returns the winner's row. `source_session` (a session row) or `source_session_id` (the id
    of an adventure, story or co-op session, as Amplify records it) names the cause.
    """
    if source_session is not None:
        # The id is stored as a string, so the database cannot check whose session it is;
        # refuse a link to another child's session here, as `ChildOwnedModel` does for keys.
        if source_session.child_id != child.pk:
            raise CrossChildReference("WorldChange.source_session belongs to another child")
        source_session_id = str(source_session.pk)
    with transaction.atomic():
        return WorldChange.objects.get_or_create(
            child=child,
            location_slug=location_slug,
            change_key=change_key,
            defaults={
                "change_type": change_type,
                "payload": payload,
                "source_session_id": source_session_id,
                "created_at": now or timezone.now(),
            },
        )


def world_change_keys(child) -> set[str]:
    return set(WorldChange.objects.for_child(child).values_list("change_key", flat=True))


def set_npc_memory_flags_for_quest(child, npc_id: str, flags, *, now=None) -> NpcRelationship | None:
    """A completed quest's `setsNpcMemoryFlags` (`setNpcMemoryFlagsForQuest`, LAI-0605).

    Deliberately narrow, as on the client: it sets flags to true and nothing else. It awards no
    relationship points (those are earned by talking) and creates a row for an NPC the child has
    never met only because a quest can be finished before its giver is spoken to.
    """
    flags = [flag for flag in flags or [] if isinstance(flag, str) and flag]
    if not flags:
        return None
    at = now or timezone.now()
    with transaction.atomic():
        row = (
            NpcRelationship.objects.select_for_update()
            .filter(child=child, npc_id=npc_id)
            .first()
        )
        if row is None:
            row, _ = NpcRelationship.objects.get_or_create(
                child=child,
                npc_id=npc_id,
                defaults={
                    "relationship_points": 0,
                    "relationship_level": npc.relationship_level_for_points(0),
                    "memory_flags": {},
                    "seen_node_ids": [],
                    "first_met_at": at,
                    "last_interacted_at": at,
                },
            )
            row = NpcRelationship.objects.select_for_update().get(pk=row.pk)
        row.memory_flags = npc.set_memory_flags(npc.parse_memory_flags(row.memory_flags), flags)
        row.last_interacted_at = max(at, row.last_interacted_at)
        row.save(update_fields=["memory_flags", "last_interacted_at"])
        return row
