"""publish_treasure_rush (TR-9 preparation): local only, validated, all or nothing."""

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.catalog.importer import import_content
from apps.catalog.models import Location, Quest
from apps.core.content_status import ContentStatus
from apps.education.models import ChallengeSpec
from apps.regions.models import SpawnPoint, TreasureChest, WorldRegion
from apps.regions.treasure_rush_publish import PublishRefused, publish_treasure_rush
from apps.regions.treasure_rush_seed import QUEST_ID, REGION_ID, seed_treasure_rush

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def local(settings):
    settings.DEBUG = True  # what `config.settings.local` sets; tests run with DEBUG off
    import_content()
    seed_treasure_rush()


def statuses():
    return (
        WorldRegion.objects.get(region_id=REGION_ID).status,
        sorted(
            set(
                ChallengeSpec.objects.filter(slug__startswith="treasure-cove-").values_list(
                    "status", flat=True
                )
            )
        ),
    )


def test_publishes_the_seeded_region_and_challenges(local):
    assert statuses() == (ContentStatus.DRAFT, [ContentStatus.DRAFT])
    changed = publish_treasure_rush()
    assert len(changed) == 4  # region, three challenge specs; the quest is catalog content
    assert statuses() == (ContentStatus.PUBLISHED, [ContentStatus.PUBLISHED])
    assert publish_treasure_rush() == []  # idempotent


def test_refused_without_debug(local, settings):
    settings.DEBUG = False
    with pytest.raises(PublishRefused, match="local development only"):
        publish_treasure_rush()
    assert statuses()[0] == ContentStatus.DRAFT


def test_refused_for_a_database_off_this_machine(local, settings):
    settings.DATABASES["default"]["HOST"] = "lai-prod.cluster.example.com"
    try:
        with pytest.raises(PublishRefused, match="not on this machine"):
            publish_treasure_rush()
    finally:
        settings.DATABASES["default"]["HOST"] = "127.0.0.1"


def test_refused_before_the_seed(settings):
    settings.DEBUG = True
    with pytest.raises(PublishRefused, match="seed_treasure_rush"):
        publish_treasure_rush()


def test_invalid_content_refuses_everything_and_publishes_nothing(local):
    chest = TreasureChest.objects.get(entity_id="cove-chest")
    # Bypassing admin validation.
    TreasureChest.objects.filter(pk=chest.pk).update(asset_id="no-such-model")
    with pytest.raises(PublishRefused) as refused:
        publish_treasure_rush()
    assert any("asset_id" in problem for problem in refused.value.problems)
    assert statuses() == (ContentStatus.DRAFT, [ContentStatus.DRAFT])


def test_an_unplayable_region_is_refused(local):
    SpawnPoint.objects.filter(region__region_id=REGION_ID).update(is_default=False)
    with pytest.raises(PublishRefused, match="no default spawn"):
        publish_treasure_rush()


def test_an_inactive_location_is_not_switched_on(local):
    Location.objects.filter(slug="pirate-builder-bay").update(active=False)
    with pytest.raises(PublishRefused, match="pirate-builder-bay is inactive"):
        publish_treasure_rush()
    assert not Location.objects.get(slug="pirate-builder-bay").active
    assert statuses()[0] == ContentStatus.DRAFT


def test_an_inactive_offered_quest_is_not_switched_on(local):
    Quest.objects.filter(slug=QUEST_ID).update(active=False)
    with pytest.raises(PublishRefused, match=f"quest {QUEST_ID} is inactive"):
        publish_treasure_rush()
    assert not Quest.objects.get(slug=QUEST_ID).active


def test_the_command_reports_and_fails_cleanly(local, settings, capsys):
    call_command("publish_treasure_rush")
    assert "published region treasure-rush-cove" in capsys.readouterr().out
    settings.DEBUG = False
    with pytest.raises(CommandError):
        call_command("publish_treasure_rush")
