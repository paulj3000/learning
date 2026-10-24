"""Persistence for world changes (LAI-0305). Server-side only; LAI-0605 wires the cascade."""

from django.utils import timezone

from apps.progression.models import WorldChange


def record_world_change(
    child, *, location_slug: str, change_type: str, change_key: str, payload=None,
    source_session_id: str = "", now=None,
) -> tuple[WorldChange, bool]:
    """Idempotent: the same (location, change key) for a child is recorded once."""
    return WorldChange.objects.get_or_create(
        child=child, location_slug=location_slug, change_key=change_key,
        defaults={
            "change_type": change_type, "payload": payload,
            "source_session_id": source_session_id, "created_at": now or timezone.now(),
        },
    )
