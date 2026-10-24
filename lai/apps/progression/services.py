"""World change writes. The Django form of the client's `recordWorldChangeOnce`."""

from django.db import transaction

from .models import WorldChange


def record_world_change_once(
    child,
    *,
    location_slug: str,
    change_type: str,
    change_key: str,
    payload: dict | None = None,
    source_session=None,
) -> tuple[WorldChange, bool]:
    """Record a change unless this child already has it. Returns (row, created).

    Safe under concurrency: the unique constraint decides, and a losing concurrent insert
    returns the winner's row instead of failing.
    """
    with transaction.atomic():
        return WorldChange.objects.get_or_create(
            child=child,
            location_slug=location_slug,
            change_key=change_key,
            defaults={
                "change_type": change_type,
                "payload": payload or {},
                "source_session": source_session,
            },
        )


def world_change_keys(child) -> set[str]:
    return set(WorldChange.objects.filter(child=child).values_list("change_key", flat=True))
