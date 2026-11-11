"""Foundation tests: models, conditions, publishing, rollback, retirement (LAI-NPC-002/006/034)."""

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.catalog.importer import ContentImportError, _refuse_django_owned_npcs
from apps.npcs import conditions, published
from apps.npcs.behaviors import parameter_problems
from apps.npcs.models import ImmutableRelease, NpcRelease, NpcReleaseAsset
from apps.npcs.publishing import PublishError, publish, retire, rollback
from apps.npcs.vocabulary import CharacterStatus, ReleaseStatus

from .helpers import (
    make_behavior,
    make_character,
    make_dialogue,
    make_place,
    make_placement,
    make_staff,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def staff():
    return make_staff()


# --- registry and placement ----------------------------------------------------------------------


def test_character_slug_is_the_canonical_npc_id():
    character = make_character("pirate-test")
    assert character.slug == "pirate-test" == character.definition.npc_id


def test_character_rejects_unknown_age_band_and_personality_keys():
    character = make_character("checker", with_variant=False)
    character.age_bands = ["TEEN"]
    character.personality = {"mood": "x"}
    with pytest.raises(ValidationError) as error:
        character.full_clean()
    assert set(error.value.message_dict) >= {"age_bands", "personality"}


def test_placement_hierarchy_must_be_consistent():
    character = make_character()
    world, place = make_place()
    other_world, _ = make_place("other-island", "other-place")
    placement = make_placement(character)
    placement.world = other_world
    with pytest.raises(ValidationError) as error:
        placement.full_clean()
    assert "location" in error.value.message_dict


def test_placement_variant_must_belong_to_the_character():
    first, second = make_character("first"), make_character("second")
    placement = make_placement(first)
    placement.variant = second.variants.get()
    with pytest.raises(ValidationError) as error:
        placement.full_clean()
    assert "variant" in error.value.message_dict


def test_only_one_default_variant_per_character():
    character = make_character()
    from .helpers import make_variant

    with pytest.raises(IntegrityError), transaction.atomic():
        make_variant(character, "second", is_default=True)


# --- conditions ----------------------------------------------------------------------------------


def test_condition_problems_name_the_fault():
    assert conditions.problems([{"type": "NOPE"}])
    assert conditions.problems([{"type": "AGE_BAND", "in": ["TEEN"]}])
    assert conditions.problems([{"type": "WORLD_CHANGE", "key": "K", "extra": 1}])
    assert conditions.problems("not a list")
    assert not conditions.problems([{"type": "QUEST_STATUS", "quest": "q", "status": "ACTIVE"}])


def test_conditions_evaluate_against_progress_and_fail_closed():
    ctx = conditions.ConditionContext(
        age_band="SPROUT",
        world_changes=frozenset({("bay", "BRIDGE_FIXED")}),
        quest_statuses={"repair": "COMPLETED"},
        prior_visits=2,
        local_flags={"heard": True},
        relationship_level="FRIEND",
    )
    assert conditions.holds([], ctx)
    assert conditions.holds([{"type": "AGE_BAND", "in": ["SPROUT"]}], ctx)
    assert conditions.holds([{"type": "WORLD_CHANGE", "key": "BRIDGE_FIXED", "place": "bay"}], ctx)
    assert not conditions.holds(
        [{"type": "WORLD_CHANGE", "key": "BRIDGE_FIXED", "present": False}], ctx
    )
    assert conditions.holds(
        [{"type": "QUEST_STATUS", "quest": "repair", "status": "COMPLETED"}], ctx
    )
    assert conditions.holds(
        [{"type": "QUEST_STATUS", "quest": "other", "status": "NOT_STARTED"}], ctx
    )
    assert conditions.holds([{"type": "RETURN_VISIT"}], ctx)
    assert not conditions.holds([{"type": "FIRST_VISIT"}], ctx)
    assert conditions.holds([{"type": "LOCAL_FLAG", "flag": "heard"}], ctx)
    assert conditions.holds([{"type": "RELATIONSHIP_AT_LEAST", "level": "ACQUAINTANCE"}], ctx)
    assert not conditions.holds([{"type": "RELATIONSHIP_AT_LEAST", "level": "TRUSTED_FRIEND"}], ctx)
    assert not conditions.holds([{"type": "MYSTERY"}], ctx)  # malformed never holds


def test_behavior_parameters_are_checked_per_type():
    assert not parameter_problems("stationary", {"facePlayer": True})
    assert parameter_problems("patrol", {"speed": 1})  # needs waypoints
    assert parameter_problems("patrol", {"speed": 1, "waypoints": [{"x": 0, "z": 0}]})  # needs 2
    assert parameter_problems("wander", {"radius": 99, "speed": 1})
    assert parameter_problems("reactive", {"reactions": {"answer.correct": "moonwalk"}})
    assert not parameter_problems("follow", {"stopDistance": 2, "speed": 2})


# --- publishing ----------------------------------------------------------------------------------


def _ready_world():
    character = make_character("pip-test")
    make_dialogue(character)
    make_placement(character, behavior=make_behavior())
    return character


def test_publish_snapshots_ready_content_and_records_assets(staff):
    _ready_world()
    make_character("draft-only", status=CharacterStatus.DRAFT)
    release = publish(staff, notes="first")
    assert release.number == 1 and release.status == ReleaseStatus.ACTIVE
    snap = release.snapshot
    assert set(snap["characters"]) == {"pip-test"}  # the draft is not published
    pip = snap["characters"]["pip-test"]
    assert pip["defaultVariant"] == "classic"
    assert pip["variants"][0]["model"] == {"assetId": "pip-test-model", "version": None}
    assert pip["dialogues"][0]["startNode"] == "greet"
    assert snap["placements"][0]["behavior"] == "idle-here"
    assert snap["behaviors"]["idle-here"]["parameters"]["boundsRadius"] == 15.0
    assert NpcReleaseAsset.objects.filter(
        release=release, asset__asset_id="pip-test-model"
    ).exists()
    assert release.content_hash == NpcRelease.hash_snapshot(snap)


def test_drafts_are_not_served_until_published(staff):
    character = _ready_world()
    release = publish(staff)
    character.definition.display_name = "Renamed In Draft"
    character.definition.save()
    assert published.current().character("pip-test")["displayName"] != "Renamed In Draft"
    assert published.current().number == release.number


def test_invalid_content_refuses_publish_and_writes_nothing(staff):
    character = make_character("broken", with_variant=False)
    make_placement(character)
    with pytest.raises(PublishError) as error:
        publish(staff)
    assert error.value.code == "invalid"
    assert any("no model variant" in p for p in error.value.problems)
    assert not NpcRelease.objects.exists()


def test_publishing_unchanged_content_is_refused(staff):
    _ready_world()
    publish(staff)
    with pytest.raises(PublishError) as error:
        publish(staff)
    assert error.value.code == "unchanged"


def test_rollback_reactivates_an_earlier_release(staff):
    character = _ready_world()
    first = publish(staff)
    character.definition.display_name = "Pip Two"
    character.definition.save()
    second = publish(staff)
    assert published.current().number == second.number
    rollback(first, staff)
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.status == ReleaseStatus.ACTIVE and second.status == ReleaseStatus.SUPERSEDED
    assert published.current().character("pip-test")["displayName"] != "Pip Two"


def test_retired_release_cannot_come_back_and_retiring_active_serves_nothing(staff):
    _ready_world()
    release = publish(staff)
    retire(release, staff)
    with pytest.raises(published.NoActiveRelease):
        published.current()
    with pytest.raises(PublishError) as error:
        rollback(release, staff)
    assert error.value.code == "retired"


def test_release_rows_are_immutable(staff):
    _ready_world()
    release = publish(staff)
    release.snapshot = {"tampered": True}
    with pytest.raises(ImmutableRelease):
        release.save()
    with pytest.raises(ImmutableRelease):
        NpcRelease.objects.get(pk=release.pk).delete()


def test_only_one_release_can_be_active(staff):
    _ready_world()
    release = publish(staff)
    duplicate = NpcRelease(
        number=99,
        status=ReleaseStatus.ACTIVE,
        schema_version=1,
        snapshot={},
        content_hash="x",
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        duplicate.save()
    assert release.status == ReleaseStatus.ACTIVE


def test_client_view_never_includes_persona_or_dialogue_trees():
    character = {"npcId": "x", "persona": {"personalityPrompt": "secret"}, "dialogues": [{}]}
    view = published.client_character(character)
    assert "persona" not in view and "dialogues" not in view


# --- canonical identity (ADR-033, ADR-054) -------------------------------------------------------


def test_import_refuses_an_export_npc_that_django_owns():
    make_character("staff-made")

    class Plan:
        npcs = [{"key": "staff-made"}]

    with pytest.raises(ContentImportError) as error:
        _refuse_django_owned_npcs(Plan())
    assert "Django-authored" in error.value.problems[0]
