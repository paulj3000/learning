"""Publish the seeded Heart of Firepeak content for local development, like `publish_firepeak`.

Development only (DEBUG on and a loopback database). Every row is checked first with the same
rules Django Admin applies (`area_problems`, the model's `full_clean`, each puzzle's published
content) plus the layout rules (`layout_problems`, every puzzle entity placed). Any problem
refuses the whole publish. Catalogue content (the Place, the five NPCs, the quest, items and
reward rules) is owned by the export and must already be active.
"""

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.catalog import authoring
from apps.core.content_status import ContentStatus

from .firepeak_heart_seed import REGION_ID
from .models import WorldRegion
from .platforming import layout_problems
from .publishing import area_problems
from .treasure_rush_publish import PublishRefused, assert_development_environment


@transaction.atomic
def publish_firepeak_heart() -> list[str]:
    assert_development_environment()
    try:
        region = WorldRegion.objects.select_related("location__world").get(region_id=REGION_ID)
    except WorldRegion.DoesNotExist:
        raise PublishRefused(
            ["no Heart of Firepeak region: run load_content and seed_firepeak_heart first"]
        ) from None
    problems = list(area_problems(region))
    scene = region.scene if isinstance(region.scene, dict) else {}
    problems += layout_problems(scene.get("platforming"), bounds=scene.get("bounds"))
    puzzles = list(region.puzzles.all())
    if not puzzles:
        problems.append("the region has no puzzles")
    placed = set(region.placements.values_list("entity_id", flat=True))
    for puzzle in puzzles:
        for entity_id in puzzle.entity_ids:
            if entity_id not in placed:
                problems.append(f"{puzzle}: no placement for entity {entity_id}")
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
