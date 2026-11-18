"""The castle keepsake backfill (SC-R07-01 residual): evidence, safety and the command."""

import io

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.catalog.models import Adventure
from apps.game_sessions import services as sessions
from apps.game_sessions.models import AdventureSession, Correctness
from apps.inventory.backfill import backfill_castle_keepsakes
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression import protected_changes as protected
from apps.progression.models import StoryProgress, WorldChange
from apps.progression.services import record_world_change
from apps.progression.tests.shared import imported_content  # noqa: F401

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

PASSAGE = "castle-secret-passage"
DOOR_KEY = "THE_CASTLES_SECRET_DOOR_COMPLETE"
DOOR_STORY = "the-castles-secret-door"
CLUES_KEY = "SECRET_DOOR_CLUES_COLLECTED"
CLUES_ADVENTURE = "secret-door-chapter-1-three-clues"
KEY_RULE = "reward-secret-door-key"


@pytest.fixture
def content(imported_content, families):  # noqa: F811
    return families


def owns(child, item_id) -> int:
    return InventoryItem.objects.filter(child=child, item__item_id=item_id).count()


def finish_story(child, *, slug=DOOR_STORY, done=True):
    at = timezone.now()
    return StoryProgress.objects.create(
        child=child,
        story_slug=slug,
        current_chapter_id="x",
        started_at=at,
        last_played_at=at,
        completed_at=at if done else None,
    )


def finish_adventure(child, slug, *, reach_step=None, finish=True):
    session, _ = sessions.start_or_resume_session(child, Adventure.objects.get(slug=slug))
    if reach_step:
        AdventureSession.objects.filter(pk=session.pk).update(current_step_id=reach_step)
        sessions.record_step_attempt(
            child,
            session.pk,
            step_id=reach_step,
            correctness=Correctness.NOT_APPLICABLE,
            next_step_id="complete",
            action_type="ADVANCE",
        )
    if finish:
        sessions.complete_session(child, session.pk)
    return session


def clues_step():
    return next(p.step_id for p in protected.lookup(CLUES_KEY).producers if p.slug == CLUES_ADVENTURE)


def drop_grants():
    """Simulate a child who finished before the rules existed."""
    GrantedRule.objects.all().delete()
    InventoryItem.objects.all().delete()


# --- evidence -----------------------------------------------------------------------------------


def test_a_completed_story_earns_the_key_and_only_for_that_child(content):
    finish_story(content.a1)
    report = backfill_castle_keepsakes(apply=True)
    assert report.rules[KEY_RULE].granted == 1
    assert owns(content.a1, "secret-door-key") == 1
    for other in (content.a2, content.b1, content.b2):
        assert owns(other, "secret-door-key") == 0
    grant = GrantedRule.objects.get(child=content.a1, rule__rule_id=KEY_RULE)
    assert grant.source_session is None


def test_an_unfinished_or_wrong_story_earns_nothing(content):
    finish_story(content.a1, done=False)
    finish_story(content.a2, slug="dragon-of-ember-mountain")
    report = backfill_castle_keepsakes(apply=True)
    assert report.rules[KEY_RULE].eligible == 0
    assert not InventoryItem.objects.exists()


@pytest.mark.parametrize("location", [PASSAGE, "storykeeper-castle", "", "pirate-builder-bay"])
def test_a_world_change_row_alone_never_qualifies(content, location):
    # Forged at a wrong place, a legacy blank location, or even the right place: not evidence.
    record_world_change(
        content.a1, location_slug=location, change_type="CREATE", change_key=DOOR_KEY
    )
    report = backfill_castle_keepsakes(apply=True)
    assert report.rules[KEY_RULE].eligible == 0
    assert not InventoryItem.objects.exists()


def test_a_story_label_source_pointing_at_another_childs_story_does_not_qualify(content):
    other = finish_story(content.b1)
    record_world_change(
        content.a1,
        location_slug=PASSAGE,
        change_type="CREATE",
        change_key=DOOR_KEY,
        source_session_id=f"story:{other.pk}",
    )
    backfill_castle_keepsakes(apply=True)
    assert owns(content.a1, "secret-door-key") == 0
    assert owns(content.b1, "secret-door-key") == 1


def test_the_lens_needs_a_completed_session_that_reached_the_step(content):
    finish_adventure(content.a1, CLUES_ADVENTURE, reach_step=clues_step())
    finish_adventure(content.a2, CLUES_ADVENTURE)  # completed, step never reached
    finish_adventure(content.b1, CLUES_ADVENTURE, reach_step=clues_step(), finish=False)
    drop_grants()
    report = backfill_castle_keepsakes(apply=True)
    assert report.rules["reward-three-clues-lens"].granted == 1
    assert owns(content.a1, "three-clues-lens") == 1
    assert owns(content.a2, "three-clues-lens") == 0
    assert owns(content.b1, "three-clues-lens") == 0
    assert GrantedRule.objects.get(rule__rule_id="reward-three-clues-lens").source_session_id


def test_the_brush_needs_the_painted_words_completed(content):
    finish_adventure(content.a1, "the-painted-words")
    finish_adventure(content.a2, "the-painted-words", finish=False)
    drop_grants()
    backfill_castle_keepsakes(apply=True)
    assert owns(content.a1, "painted-words-brush") == 1
    assert owns(content.a2, "painted-words-brush") == 0


# --- safety -------------------------------------------------------------------------------------


def test_dry_run_writes_nothing_and_counts(content):
    finish_story(content.a1)
    report = backfill_castle_keepsakes()
    assert report.apply is False
    assert report.rules[KEY_RULE].eligible == 1 and report.rules[KEY_RULE].granted == 0
    assert not InventoryItem.objects.exists() and not GrantedRule.objects.exists()


def test_rerun_is_idempotent_and_skips_children_who_already_have_the_item(content):
    finish_story(content.a1)
    finish_story(content.a2)
    # a2 already owns the key through another path (no GrantedRule for this rule).
    from apps.catalog.models import ItemDefinition

    InventoryItem.objects.create(
        child=content.a2, item=ItemDefinition.objects.get(item_id="secret-door-key")
    )
    first = backfill_castle_keepsakes(apply=True)
    second = backfill_castle_keepsakes(apply=True)
    assert (first.rules[KEY_RULE].granted, first.rules[KEY_RULE].already_had) == (1, 1)
    assert second.rules[KEY_RULE].granted == 0
    assert owns(content.a1, "secret-door-key") == 1 and owns(content.a2, "secret-door-key") == 1
    assert GrantedRule.objects.filter(rule__rule_id=KEY_RULE).count() == 1


def test_it_never_deletes_or_edits_existing_records(content):
    story = finish_story(content.a1)
    record_world_change(content.a1, location_slug=PASSAGE, change_type="CREATE", change_key=DOOR_KEY)
    before = list(WorldChange.objects.values_list("pk", "change_key", "location_slug"))
    backfill_castle_keepsakes(apply=True)
    assert list(WorldChange.objects.values_list("pk", "change_key", "location_slug")) == before
    story.refresh_from_db()
    assert story.completed_at is not None


def test_the_command_defaults_to_a_dry_run_and_prints_counts_only(content):
    finish_story(content.a1)
    out = io.StringIO()
    call_command("backfill_castle_keepsakes", stdout=out)
    text = out.getvalue()
    assert text.startswith("DRY RUN") and "eligible 1, granted 0" in text
    assert not InventoryItem.objects.exists()
    out = io.StringIO()
    call_command("backfill_castle_keepsakes", "--apply", stdout=out)
    assert out.getvalue().startswith("APPLY") and "granted 1" in out.getvalue()
    assert owns(content.a1, "secret-door-key") == 1
    for child in (content.a1, content.a2):
        assert str(child.pk) not in out.getvalue() and child.nickname not in out.getvalue()
