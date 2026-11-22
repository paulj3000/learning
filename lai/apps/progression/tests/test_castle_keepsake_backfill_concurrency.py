"""Simultaneous backfills of one finished story grant the key once (real parallel transactions)."""

import pytest
from django.utils import timezone

from apps.catalog.importer import import_content
from apps.game_sessions.tests.test_concurrency import race
from apps.inventory.backfill import backfill_castle_keepsakes
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression import stories
from apps.progression.models import StoryProgress

pytestmark = [pytest.mark.postgres, pytest.mark.django_db(transaction=True)]


def test_concurrent_backfills_grant_the_key_once(families):
    import_content()
    stories.definitions.cache_clear()
    child = families.a1
    at = timezone.now()
    StoryProgress.objects.create(
        child=child,
        story_slug="the-castles-secret-door",
        current_chapter_id="x",
        started_at=at,
        last_played_at=at,
        completed_at=at,
    )
    results = race(lambda: backfill_castle_keepsakes(apply=True), count=3)
    assert all(not isinstance(r, Exception) for r in results), results
    assert sum(r.rules["reward-secret-door-key"].granted for r in results) == 1
    assert InventoryItem.objects.filter(child=child, item__item_id="secret-door-key").count() == 1
    assert (
        GrantedRule.objects.filter(child=child, rule__rule_id="reward-secret-door-key").count() == 1
    )
