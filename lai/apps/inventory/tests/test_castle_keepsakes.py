"""Storykeeper Castle keepsakes (SC-R07-01), against the real imported content.

Six Trophy Room artifacts are ordinary `ItemDefinition`s granted by `RewardRule`s (ADR-033: no
second achievement model). The three new ones are paid by server-graded paths only:

- `painted-words-brush` when the Painted Words adventure completes (`ADVENTURE_COMPLETED`);
- `three-clues-lens` when Django's adventure runner records `SECRET_DOOR_CLUES_COLLECTED`;
- `secret-door-key` when Django completes the Secret Door story (`THE_CASTLES_SECRET_DOOR_COMPLETE`).

The two `WORLD_CHANGE` rules name protected Great Storybook page keys, and a grant needs the key
at its own place, so a client POST or a misplaced copy pays nothing.
"""

import uuid

import pytest
from django.core.management import call_command

from apps.catalog.importer import import_content
from apps.catalog.models import Adventure, CollectibleSet, ItemDefinition, RewardRule
from apps.game_sessions import services as sessions
from apps.game_sessions.models import AdventureSession
from apps.inventory.models import GrantedRule, InventoryItem
from apps.inventory.services import grant_world_change_rewards, owned_item_ids
from apps.progression import protected_changes as protected
from apps.progression import stories
from apps.progression.models import WorldChange
from apps.progression.services import record_world_change

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

CASTLE = "storykeeper-castle"
PASSAGE = "castle-secret-passage"
KEEPSAKES = [
    "storykeepers-quill",
    "blank-page-storybook",
    "great-storybook-seal",
    "painted-words-brush",
    "three-clues-lens",
    "secret-door-key",
]
NEW_RULES = {
    "reward-painted-words-brush": (
        {"type": "ADVENTURE_COMPLETED", "templateSlug": "the-painted-words"},
        ["painted-words-brush"],
    ),
    "reward-three-clues-lens": (
        {"type": "WORLD_CHANGE", "changeKey": "SECRET_DOOR_CLUES_COLLECTED"},
        ["three-clues-lens"],
    ),
    "reward-secret-door-key": (
        {"type": "WORLD_CHANGE", "changeKey": "THE_CASTLES_SECRET_DOOR_COMPLETE"},
        ["secret-door-key"],
    ),
}


@pytest.fixture
def content(families):
    import_content()
    stories.definitions.cache_clear()
    return families


def band(child, value):
    child.age_band = value
    child.save()
    return child


def owns(child, item_id) -> int:
    return InventoryItem.objects.for_child(child).filter(item__item_id=item_id).count()


def play_world_change_step(child, slug, key):
    """Answer the step that records `key`, through the graded answers route the child uses."""
    adventure = Adventure.objects.get(slug=slug)
    session, _ = sessions.start_or_resume_session(child, adventure)
    step = next(p.step_id for p in protected.lookup(key).producers if p.slug == slug)
    AdventureSession.objects.filter(pk=session.pk).update(current_step_id=step)
    return sessions.submit_answer(
        child,
        session.pk,
        step_id=step,
        answer={"kind": "world-change"},
        request_id=uuid.uuid4(),
    )


# --- the content --------------------------------------------------------------------------------


def test_the_six_keepsakes_and_three_new_rules_are_imported(content):
    keepsakes = CollectibleSet.objects.get(set_id="castle-keepsakes")
    assert keepsakes.completion_item is None
    assert sorted(keepsakes.items.values_list("item_id", flat=True)) == sorted(KEEPSAKES)
    for item_id in ("painted-words-brush", "three-clues-lens", "secret-door-key"):
        assert ItemDefinition.objects.get(item_id=item_id).category == "KEEPSAKE"
    for rule_id, (trigger, items) in NEW_RULES.items():
        rule = RewardRule.objects.get(rule_id=rule_id)
        assert rule.trigger == trigger
        assert list(rule.items.values_list("item_id", flat=True)) == items


def test_every_world_change_keepsake_rule_names_a_protected_key_with_a_server_producer(content):
    for rule_id, (trigger, _) in NEW_RULES.items():
        if trigger["type"] != "WORLD_CHANGE":
            continue
        entry = protected.lookup(trigger["changeKey"])
        assert entry is not None, rule_id
        assert entry.location_slug == PASSAGE
        assert entry.producers, rule_id


def test_importing_twice_changes_nothing_and_a_forced_reimport_keeps_a_childs_grants(content):
    child = band(content.a1, "EXPLORER")
    grant_world_change_rewards(
        child, location_slug=PASSAGE, change_key="SECRET_DOOR_CLUES_COLLECTED"
    )
    counts = (ItemDefinition.objects.count(), RewardRule.objects.count())
    assert import_content().status == "unchanged"
    import_content(force=True)
    assert (ItemDefinition.objects.count(), RewardRule.objects.count()) == counts
    assert owns(child, "three-clues-lens") == 1
    assert GrantedRule.objects.for_child(child).count() == 1


def test_no_migration_is_needed(content):
    call_command("makemigrations", "--check", "--dry-run", verbosity=0)


# --- the grant helper ---------------------------------------------------------------------------


def test_a_protected_key_at_its_own_place_pays_its_rule_once(content):
    child = content.a1
    first = grant_world_change_rewards(
        child, location_slug=PASSAGE, change_key="SECRET_DOOR_CLUES_COLLECTED"
    )
    again = grant_world_change_rewards(
        child, location_slug=PASSAGE, change_key="SECRET_DOOR_CLUES_COLLECTED"
    )
    assert [(rule.rule_id, grant.granted) for rule, grant in first] == [
        ("reward-three-clues-lens", True)
    ]
    assert [grant.granted for _, grant in again] == [False]
    assert owns(child, "three-clues-lens") == 1
    assert owned_item_ids(content.a2) == set()  # a sibling gets nothing


def test_a_protected_key_at_another_place_pays_nothing(content):
    child = content.a1
    assert (
        grant_world_change_rewards(
            child, location_slug=CASTLE, change_key="SECRET_DOOR_CLUES_COLLECTED"
        )
        == ()
    )
    assert (
        grant_world_change_rewards(
            child, location_slug="", change_key="THE_CASTLES_SECRET_DOOR_COMPLETE"
        )
        == ()
    )
    assert not InventoryItem.objects.exists()


def test_an_unprotected_key_pays_nothing_here(content):
    # `reward-bridge-world-change` stays as it was: the island runtime posts BRIDGE_REPAIRED.
    assert not protected.is_protected("BRIDGE_REPAIRED")
    assert (
        grant_world_change_rewards(
            content.a1, location_slug="pirate-builder-bay", change_key="BRIDGE_REPAIRED"
        )
        == ()
    )
    assert not InventoryItem.objects.exists()


def test_the_generic_world_change_post_pays_no_keepsake(content, api):
    child = content.a1
    response = api(content.a).post(
        f"/api/v1/children/{child.pk}/world-changes/",
        {
            "locationSlug": PASSAGE,
            "changeType": "CREATE",
            "changeKey": "SECRET_DOOR_CLUES_COLLECTED",
        },
        "application/json",
    )
    assert response.status_code == 400
    assert not InventoryItem.objects.exists()


def test_a_recorded_world_change_alone_grants_nothing(content):
    # Recording is not paying: only the adventure and story paths call the grant.
    record_world_change(
        content.a1,
        location_slug=PASSAGE,
        change_type="CREATE",
        change_key="SECRET_DOOR_CLUES_COLLECTED",
    )
    assert not InventoryItem.objects.exists()


# --- the server paths that pay ------------------------------------------------------------------


def test_the_clues_step_records_the_change_and_grants_the_lens_once(content):
    child = band(content.a1, "EXPLORER")
    outcome = play_world_change_step(
        child, "secret-door-chapter-1-three-clues", "SECRET_DOOR_CLUES_COLLECTED"
    )
    assert outcome.world_change_keys == ("SECRET_DOOR_CLUES_COLLECTED",)
    assert WorldChange.objects.filter(child=child, change_key="SECRET_DOOR_CLUES_COLLECTED").count()
    assert owns(child, "three-clues-lens") == 1
    if outcome.completion is not None:
        # Finished in the same request: the lens's message is told with the adventure's own.
        assert "reward-three-clues-lens" in [rule.rule_id for rule, _ in outcome.completion.rewards]
    # A second session through the same step grants nothing again.
    play_world_change_step(
        child, "secret-door-chapter-1-three-clues", "SECRET_DOOR_CLUES_COLLECTED"
    )
    assert owns(child, "three-clues-lens") == 1
    assert (
        GrantedRule.objects.for_child(child).filter(rule__rule_id="reward-three-clues-lens").count()
        == 1
    )


def test_finishing_the_painted_words_grants_the_brush(content):
    child = content.a1  # a Pathfinder
    outcome = play_world_change_step(child, "the-painted-words", "STUDIO_PAGE_MENDED")
    assert outcome.completion is not None
    granted = {rule.rule_id: grant for rule, grant in outcome.completion.rewards}
    assert granted["reward-painted-words-brush"].new_item_ids == ("painted-words-brush",)
    assert owns(child, "painted-words-brush") == 1


def test_completing_the_secret_door_story_grants_the_key_once(content):
    child = band(content.a1, "EXPLORER")
    slug = "the-castles-secret-door"
    stories.start_story(child, slug)
    for chapter, adventure in (
        ("three-clues", "secret-door-chapter-1-three-clues"),
        ("the-pattern-lock", "secret-door-chapter-2-pattern-lock"),
    ):
        session, _ = sessions.start_or_resume_session(child, Adventure.objects.get(slug=adventure))
        sessions.complete_session(child, session.pk)
        stories.complete_chapter(child, slug, chapter)
    progress = stories.complete_chapter(child, slug, "what-was-waiting")
    assert progress.completed_at is not None
    assert owns(child, "secret-door-key") == 1
    # A replayed final chapter changes nothing and grants nothing again.
    stories.complete_chapter(child, slug, "what-was-waiting")
    assert owns(child, "secret-door-key") == 1
    assert owned_item_ids(content.a2) == set()
