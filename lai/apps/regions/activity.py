"""How many children have reached each of a 3D Area's encounters (TR-15, TR-20), for the admin.

Counts only, on purpose. An administrator deciding whether the key is findable or a chest too
hard needs to know how many children got there, not which children: no child identifier, name
or profile leaves this module (CLAUDE.md sections 2 and 13). A replay activity never records a
world change, so it reports no count.
"""

from dataclasses import dataclass

from django.db.models import Count

from apps.progression.models import WorldChange

from .models import ChestPresentation, WorldRegion


@dataclass(frozen=True)
class EncounterActivity:
    kind: str
    entity_id: str
    label: str
    world_change_key: str
    children: int | None
    """Children who have it, or None for a replay activity (it records nothing)."""


def encounter_activity(region: WorldRegion) -> list[EncounterActivity]:
    """Pickups and chests of `region` in encounter order, each with a child count."""
    location = region.location.slug
    keys = {c.world_change_key for c in region.chests.all()} | {
        p.pickup_change_key for p in region.placements.all() if p.is_pickup
    }
    counts = dict(
        WorldChange.objects.filter(location_slug=location, change_key__in=keys)
        .values_list("change_key")
        .annotate(total=Count("child", distinct=True))
    )
    rows = [
        EncounterActivity(
            "pickup",
            p.entity_id,
            p.label,
            p.pickup_change_key,
            counts.get(p.pickup_change_key, 0),
        )
        for p in region.placements.order_by("entity_id")
        if p.is_pickup
    ]
    for chest in region.chests.order_by("sort_order", "entity_id"):
        replay = chest.presentation == ChestPresentation.REPLAY
        rows.append(
            EncounterActivity(
                chest.get_presentation_display().split(" (")[0].lower(),
                chest.entity_id,
                chest.label,
                chest.world_change_key,
                None if replay else counts.get(chest.world_change_key, 0),
            )
        )
    return rows
