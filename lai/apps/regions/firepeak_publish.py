"""Publish the seeded Firepeak content for local development (FP-2), like `publish_treasure_rush`.

Development only (DEBUG on and a loopback database). Every row is checked first with the same
rules Django Admin applies (`area_problems`, the model's `full_clean`, and each puzzle's published
content); any problem refuses the whole publish. Catalog content (the Place, Professor Ember, the
quest) is owned by the export and must already be active.
"""

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.catalog import authoring
from apps.core.content_status import ContentStatus

from .firepeak_seed import REGION_ID
from .models import WorldRegion
from .publishing import area_problems
from .treasure_rush_publish import PublishRefused, assert_development_environment


@transaction.atomic
def publish_firepeak() -> list[str]:
    assert_development_environment()
    try:
        region = WorldRegion.objects.select_related("location__world").get(region_id=REGION_ID)
    except WorldRegion.DoesNotExist:
        raise PublishRefused(
            ["no Firepeak region: run load_content and seed_firepeak first"]
        ) from None
    problems = list(area_problems(region))
    puzzles = list(region.puzzles.all())
    if not puzzles:
        problems.append("the region has no puzzles")
    for row in [*region.placements.all(), *puzzles]:
        try:
            row.full_clean()
        except ValidationError as error:
            for field, messages in error.message_dict.items():
                problems.append(f"{row} {field}: {'; '.join(messages)}")
    for puzzle in puzzles:
        problems.extend(
            f"{puzzle}: {p}" for p in authoring.validate(puzzle, authoring.current_body(puzzle))
        )
    if problems:
        raise PublishRefused(problems)
    changed = []
    for row in [region, *puzzles]:
        if row.status != ContentStatus.PUBLISHED:
            row.status = ContentStatus.PUBLISHED
            row.save()
            changed.append(str(row))
    return changed
