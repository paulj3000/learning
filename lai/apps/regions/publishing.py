"""Validation before a 3D Area or an Adventure launch point is published (ADR-041).

Shared by the Django Admin actions (`regions/admin.py`) and the local `publish_treasure_rush`
command, so both refuse the same things. Every check reports a problem in words staff can act
on; nothing is published while any problem remains.
"""

from django.core.exceptions import ValidationError

from .models import AdventureLaunchPoint, WorldRegion


def _check(row, label: str, problems: list[str]) -> None:
    try:
        row.full_clean()
    except ValidationError as error:
        for field, messages in error.message_dict.items():
            problems.append(f"{label} {field}: {'; '.join(messages)}")


def area_problems(region: WorldRegion) -> list[str]:
    """Why this 3D Area cannot be published yet (empty when it can)."""
    problems: list[str] = []
    place = region.location
    if not place.active:
        problems.append(f"Place {place.slug} is inactive")
    if not place.world.active:
        problems.append(f"Island {place.world.slug} is inactive")
    if not region.spawn_points.filter(is_default=True).exists():
        problems.append("the 3D Area has no default spawn point")
    _check(region, f"3D Area {region.region_id}", problems)
    for spawn in region.spawn_points.all():
        _check(spawn, f"spawn {spawn.checkpoint_id}", problems)
    for placement in region.placements.all():
        _check(placement, f"placement {placement.entity_id}", problems)
    for chest in region.chests.all():
        _check(chest, f"chest {chest.entity_id}", problems)
    for quest in region.offered_quests.all():
        if not quest.active:
            problems.append(f"quest {quest.slug} is inactive")
    return problems


def launch_point_problems(point: AdventureLaunchPoint) -> list[str]:
    """Why this launch point cannot be published yet (empty when it can)."""
    problems: list[str] = []
    _check(point, f"launch point {point.launch_id}", problems)
    adventure = point.adventure
    if not adventure.active:
        problems.append(f"adventure {adventure.slug} is inactive")
    if adventure.location_id is not None and not adventure.location.active:
        problems.append(f"Place {adventure.location.slug} is inactive")
    return problems
