import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.progression.models import NpcRelationship, StoryProgress, WorldChange, WorldState
from apps.progression.services import record_world_change

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def test_a_world_change_is_recorded_once_per_child_location_and_key(families):
    first, created = record_world_change(
        families.a1, location_slug="bay", change_type="REPAIR", change_key="bridge-fixed"
    )
    again, created_again = record_world_change(
        families.a1, location_slug="bay", change_type="REPAIR", change_key="bridge-fixed"
    )
    sibling, sibling_created = record_world_change(
        families.a2, location_slug="bay", change_type="REPAIR", change_key="bridge-fixed"
    )
    assert created and not created_again and again == first
    assert sibling_created and sibling != first
    assert WorldChange.objects.for_child(families.a1).count() == 1


def test_a_story_only_place_is_a_valid_world_change_location(families):
    change, _ = record_world_change(
        families.a1, location_slug="ember-mountain", change_type="STORY", change_key="dragon-saved"
    )
    assert change.location_slug == "ember-mountain"


def test_one_world_state_per_child(families):
    WorldState.objects.create(child=families.a1, updated_at=timezone.now())
    with pytest.raises(IntegrityError), transaction.atomic():
        WorldState.objects.create(child=families.a1, updated_at=timezone.now())


def test_story_and_npc_progress_are_unique_per_child(families):
    now = timezone.now()
    StoryProgress.objects.create(
        child=families.a1,
        story_slug="ember",
        current_chapter_id="c1",
        started_at=now,
        last_played_at=now,
    )
    NpcRelationship.objects.create(
        child=families.a1,
        npc_id="pirate-pip",
        relationship_level="FRIEND",
        first_met_at=now,
        last_interacted_at=now,
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        StoryProgress.objects.create(
            child=families.a1,
            story_slug="ember",
            current_chapter_id="c2",
            started_at=now,
            last_played_at=now,
        )
    with pytest.raises(IntegrityError), transaction.atomic():
        NpcRelationship.objects.create(
            child=families.a1,
            npc_id="pirate-pip",
            relationship_level="BEST_FRIEND",
            first_met_at=now,
            last_interacted_at=now,
        )
