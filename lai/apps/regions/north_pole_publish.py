"""Publish the seeded North Pole content for local development, like `publish_firepeak`.

Development only (DEBUG on and a loopback database). Every row is checked first with the rules
Django Admin applies (`area_problems`, each row's `full_clean`, each puzzle's published content,
each chest's challenge specs); any problem refuses the whole publish, so nothing is
half-published. Catalog content (the Realm, the Place, the NPCs, the quests) is owned by the
export and must already be active.
"""

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.catalog import authoring
from apps.core.content_status import ContentStatus

from .models import WorldRegion
from .north_pole_seed import REGION_ID
from .publishing import area_problems
from .treasure_rush_publish import PublishRefused, assert_development_environment


def _clean(row, problems: list[str]) -> None:
    try:
        row.full_clean()
    except ValidationError as error:
        for field, messages in error.message_dict.items():
            problems.append(f"{row} {field}: {'; '.join(messages)}")


def north_pole_problems(region: WorldRegion) -> tuple[list[str], list, list]:
    """Everything that would block a publish, plus the puzzles and specs a publish changes."""
    problems = list(area_problems(region))
    puzzles = list(region.puzzles.all())
    chests = list(region.chests.all())
    if not puzzles:
        problems.append("the region has no puzzles")
    if not any(chest.presentation == "CHEST" for chest in chests):
        problems.append("the region has no math chest, so it would never be listed as playable")
    specs = {}
    for chest in chests:
        for field in chest.BAND_FIELDS.values():
            spec = getattr(chest, field)
            if spec is not None:
                specs[spec.pk] = spec
    for row in [*region.placements.all(), *puzzles, *chests, *specs.values()]:
        _clean(row, problems)
    for puzzle in puzzles:
        problems.extend(
            f"{puzzle}: {p}" for p in authoring.validate(puzzle, authoring.current_body(puzzle))
        )
    return problems, puzzles, list(specs.values())


@transaction.atomic
def publish_north_pole() -> list[str]:
    assert_development_environment()
    try:
        region = WorldRegion.objects.select_related("location__world").get(region_id=REGION_ID)
    except WorldRegion.DoesNotExist:
        raise PublishRefused(
            ["no North Pole region: run load_content and seed_north_pole first"]
        ) from None
    problems, puzzles, specs = north_pole_problems(region)
    if problems:
        raise PublishRefused(problems)
    changed = []
    for row in [region, *puzzles, *specs]:
        if row.status != ContentStatus.PUBLISHED:
            row.status = ContentStatus.PUBLISHED
            row.save()
            changed.append(str(row))
    return changed
