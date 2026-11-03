"""Existing castle adventures and the Great Storybook (SC-R04-04), on the server.

The book derives from records the authored adventures write. These tests prove the join against
the exported content catalog, and that a child with history from before the quests existed
reaches the same book without replaying anything and without a second record or reward.
"""

import json
from datetime import timedelta
from pathlib import Path

import pytest
from django.utils import timezone

from apps.progression.models import WorldChange
from apps.quests.models import QuestProgress, QuestStatus
from apps.regions import great_storybook

from .test_great_storybook import (
    EXPLORERS,
    PATHFINDERS,
    SPROUTS,
    band,
    meet_quill,
    refresh,
    restored,
    seals,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

ADVENTURES = json.loads(
    (Path(__file__).resolve().parents[4] / "content/exported/adventures.json").read_text()
)["adventures"]

#: The documented mapping: page id -> (adventure slug, world-change step id), for each producer.
PRODUCERS = {
    "page-first-story": [
        ("the-storykeepers-tale", "story-written"),
        ("quills-picture-story", "picture-story-made"),
    ],
    "page-three-clues": [("secret-door-chapter-1-three-clues", "clues-collected")],
    "page-pattern-lock": [("secret-door-chapter-2-pattern-lock", "door-opened")],
}


def old(child, key, location="storykeeper-castle", days=90):
    """A record from before the quests existed: written then, with its own timestamp."""
    when = timezone.now() - timedelta(days=days)
    return WorldChange.objects.create(
        child=child,
        location_slug=location,
        change_type="CREATE",
        change_key=key,
        created_at=when,
    )


def test_every_adventure_page_is_written_by_a_real_exported_step_for_its_bands():
    by_slug = {a["slug"]: a for a in ADVENTURES}
    for page in great_storybook.PAGES:
        if page["id"] not in PRODUCERS:
            continue
        for slug, step_id in PRODUCERS[page["id"]]:
            adventure = by_slug[slug]
            step = next(s for s in adventure["steps"] if s["id"] == step_id)
            payload = step["presentation"]["payload"]
            assert step["type"] == "WORLD_CHANGE"
            assert payload["changeKey"] == page["source"]["changeKey"]
            assert payload["locationSlug"] == page["source"]["locationSlug"]
            assert set(adventure["ageBands"]) & set(page["bands"])
    for band_name in ("SPROUT", "PATHFINDER", "EXPLORER"):
        for page in great_storybook.pages_for_band(band_name):
            if page["source"]["kind"] == "WORLD_CHANGE" and page["id"] in PRODUCERS:
                assert any(band_name in by_slug[s]["ageBands"] for s, _ in PRODUCERS[page["id"]]), (
                    band_name,
                    page["id"],
                )


def test_the_final_page_is_written_by_the_secret_door_story_completion():
    stories = json.loads(
        (Path(__file__).resolve().parents[4] / "content/exported/stories.json").read_text()
    )
    items = stories.get("stories", stories)
    story = next(s for s in items if s["slug"] == "the-castles-secret-door")
    page = next(p for p in great_storybook.PAGES if p["id"] == "page-what-was-waiting")
    assert story["completionWorldChange"]["changeKey"] == page["source"]["changeKey"]
    assert story["completionWorldChange"]["locationSlug"] == page["source"]["locationSlug"]


def test_a_child_who_finished_the_tale_long_ago_completes_the_quest_without_replay(treasure):
    child = band(treasure.families.a1, "PATHFINDER")
    record = old(child, "FIRST_STORY_TOLD")
    meet_quill(child)
    update, rewards = refresh(child, PATHFINDERS)
    assert update.progress.status == QuestStatus.COMPLETED
    assert restored(child) == 1 and seals(child) == 1 and len(rewards) == 1
    # The original record is untouched: same row, same timestamp, never rewritten.
    same = WorldChange.objects.get(pk=record.pk)
    assert same.created_at == record.created_at
    assert WorldChange.objects.for_child(child).filter(change_key="FIRST_STORY_TOLD").count() == 1


def test_repeated_reconciliation_changes_nothing_and_grants_nothing(treasure):
    child = band(treasure.families.a1, "SPROUT")
    old(child, "FIRST_STORY_TOLD")
    meet_quill(child)
    refresh(child, SPROUTS)
    before = (restored(child), seals(child), WorldChange.objects.for_child(child).count())
    for _ in range(3):
        update, rewards = refresh(child, SPROUTS)
        assert not update.result.changed and not rewards
    assert (restored(child), seals(child), WorldChange.objects.for_child(child).count()) == before
    assert QuestProgress.objects.for_child(child).count() == 1


def test_partial_history_restores_only_what_it_proves(treasure):
    child = band(treasure.families.a1, "EXPLORER")
    old(child, "SECRET_DOOR_CLUES_COLLECTED", "castle-secret-passage")
    meet_quill(child)
    update, rewards = refresh(child, EXPLORERS)
    assert update.progress.status == QuestStatus.ACTIVE and not rewards
    assert "storybook-page-three-clues" in update.progress.completed_objective_ids
    assert "storybook-page-pattern-lock" not in update.progress.completed_objective_ids
    assert restored(child) == 0


def test_obsolete_and_unrelated_records_are_ignored_safely(treasure):
    child = band(treasure.families.a1, "PATHFINDER")
    old(child, "SOME_RETIRED_KEY_V0")
    old(child, "REPAIR_BRIDGE", "pirate-builder-bay")
    meet_quill(child)
    update, rewards = refresh(child, PATHFINDERS)
    assert update.progress.status == QuestStatus.ACTIVE and not rewards
    assert great_storybook.progress(child)["complete"] is False


def test_history_reaches_the_same_book_whether_read_before_or_after_the_quest(treasure):
    child = band(treasure.families.a1, "PATHFINDER")
    old(child, "FIRST_STORY_TOLD")
    before = great_storybook.progress(child)
    meet_quill(child)
    refresh(child, PATHFINDERS)
    after = great_storybook.progress(child)
    assert before["pages"] == after["pages"] and before["complete"] and after["complete"]


def test_one_childs_history_never_completes_a_siblings_book(treasure):
    a, b = treasure.families.a1, treasure.families.a2
    band(a, "PATHFINDER")
    band(b, "PATHFINDER")
    old(a, "FIRST_STORY_TOLD")
    meet_quill(b)
    update, rewards = refresh(b, PATHFINDERS)
    assert update.progress.status == QuestStatus.ACTIVE and not rewards
    assert restored(b) == 0 and seals(b) == 0
