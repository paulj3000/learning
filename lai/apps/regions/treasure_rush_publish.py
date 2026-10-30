"""Publish the starter Treasure Rush content for local development (TR-9 preparation).

`seed_treasure_rush` creates everything as DRAFT, and until TR-3's admin exists there is no
other way to publish it. This does that, for a developer's own machine only:

- **Development only.** Refused unless `DEBUG` is on *and* the database is on loopback, so it
  cannot run against a deployed environment even with the wrong settings module.
- **No bypass.** Every row it publishes is checked with the model's own `full_clean()` first (the
  same validation an admin save runs: TR-1 parameters, chest age bands, asset ids, quest stages),
  and the region must be playable (a default spawn, at least one chest, a published location).
  Any problem refuses the whole publish; nothing is half-published.
- **Only the seed's rows.** The seeded region and its chests' challenge specs, the only
  Treasure Rush rows with a publication status (POST-MERGE-03). The location, its world, and the
  offered quests are catalog content owned by the export: they must already be `active`, and an
  inactive one blocks this instead of being switched on.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction

from apps.core.content_status import ContentStatus

from .models import WorldRegion
from .treasure_rush_seed import REGION_ID


class PublishRefused(Exception):
    """Not a development environment, or the content is not valid or not playable."""

    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


def assert_development_environment() -> None:
    database_host = settings.DATABASES["default"].get("HOST", "")
    problems = []
    if not settings.DEBUG:
        problems.append("DEBUG is off: this command is for local development only")
    if database_host not in settings.LOOPBACK_HOSTS:
        problems.append(
            "the database is not on this machine: this command is for local development only"
        )
    if problems:
        raise PublishRefused(problems)


def _check(row, label: str, problems: list[str]) -> None:
    try:
        row.full_clean()
    except ValidationError as error:
        for field, messages in error.message_dict.items():
            problems.append(f"{label} {field}: {'; '.join(messages)}")


@transaction.atomic
def publish_treasure_rush() -> list[str]:
    """Validate and publish the seeded Treasure Rush content. Returns what changed."""
    assert_development_environment()
    try:
        region = WorldRegion.objects.select_related("location__world").get(region_id=REGION_ID)
    except WorldRegion.DoesNotExist:
        raise PublishRefused(
            ["no Treasure Rush region: run load_content and seed_treasure_rush first"]
        ) from None

    problems: list[str] = []
    if not region.location.active:
        problems.append(f"location {region.location.slug} is inactive")
    if not region.location.world.active:
        problems.append(f"world {region.location.world.slug} is inactive")
    if not region.spawn_points.filter(is_default=True).exists():
        problems.append("the region has no default spawn point")
    chests = list(region.chests.all())
    if not chests:
        problems.append("the region has no treasure chest")

    _check(region, f"region {region.region_id}", problems)
    for spawn in region.spawn_points.all():
        _check(spawn, f"spawn {spawn.checkpoint_id}", problems)
    for placement in region.placements.all():
        _check(placement, f"placement {placement.entity_id}", problems)
    specs = {}
    for chest in chests:
        _check(chest, f"chest {chest.entity_id}", problems)
        for field in chest.BAND_FIELDS.values():
            spec = getattr(chest, field)
            if spec is not None:
                specs[spec.pk] = spec
    for spec in specs.values():
        _check(spec, f"challenge {spec.slug}", problems)
    quests = list(region.offered_quests.all())
    for quest in quests:
        if not quest.active:
            problems.append(f"quest {quest.slug} is inactive")

    if problems:
        raise PublishRefused(problems)

    changed = []
    for row, label in [
        (region, f"region {region.region_id}"),
        *[(spec, f"challenge {spec.slug}") for spec in specs.values()],
    ]:
        if row.status != ContentStatus.PUBLISHED:
            row.status = ContentStatus.PUBLISHED
            row.save()
            changed.append(label)
    return changed
