"""World change writes (LAI-0305; Treasure Rush's `record_world_change_once`, POST-MERGE-03)."""

from django.db import transaction
from django.utils import timezone

from apps.core.models import CrossChildReference
from apps.progression.models import WorldChange
from apps.progression.protected_changes import is_misplaced


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


def world_change_pairs(child) -> set[tuple[str, str]]:
    """Every recorded (location, change key) for the child, exactly as stored."""
    return set(WorldChange.objects.for_child(child).values_list("location_slug", "change_key"))


def world_change_keys(child) -> set[str]:
    """The change keys that count as progress for the child.

    A protected key (`protected_changes`) recorded at a location other than the one it belongs to
    is dropped: quest BUILD objectives, discovery requirements and the Great Storybook match on
    the key, so a forged copy elsewhere must not satisfy them. Unprotected keys and legacy rows
    with a blank location are kept as they always were.
    """
    return {key for location, key in world_change_pairs(child) if not is_misplaced(location, key)}
