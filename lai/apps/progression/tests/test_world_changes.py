"""World changes (TR-4): once per child, location, and key; append-only; child-scoped."""

import pytest
from django.db import IntegrityError, transaction

from apps.core.models import CrossChildReference
from apps.game_sessions.play import start_or_resume_region_session
from apps.progression.models import AppendOnly, WorldChange
from apps.progression.services import record_world_change, world_change_keys

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

CHANGE = {"location_slug": "pirate-builder-bay", "change_type": "UNLOCK", "change_key": "OPENED"}


def test_a_change_is_recorded_once(families):
    first, created = record_world_change(families.a1, **CHANGE, payload={"n": 1})
    again, created_again = record_world_change(families.a1, **CHANGE, payload={"n": 2})
    assert created and not created_again and first.pk == again.pk
    again.refresh_from_db()
    assert again.payload == {"n": 1}
    assert WorldChange.objects.filter(child=families.a1).count() == 1


def test_the_same_key_in_another_location_is_another_change(families):
    record_world_change(families.a1, **CHANGE)
    _, created = record_world_change(families.a1, **{**CHANGE, "location_slug": "elsewhere"})
    assert created


def test_children_have_their_own_changes(families):
    record_world_change(families.a1, **CHANGE)
    _, created = record_world_change(families.b1, **CHANGE)
    assert created
    assert world_change_keys(families.a2) == set()


def test_the_database_refuses_a_duplicate(families):
    record_world_change(families.a1, **CHANGE)
    with pytest.raises(IntegrityError), transaction.atomic():
        WorldChange.objects.create(child=families.a1, **CHANGE)


def test_changes_are_never_edited(families):
    change, _ = record_world_change(families.a1, **CHANGE)
    change.change_key = "SOMETHING_ELSE"
    with pytest.raises(AppendOnly):
        change.save()


def test_a_change_cannot_cite_another_childs_session(treasure):
    other_session, _ = start_or_resume_region_session(treasure.families.b1, treasure.region)
    with pytest.raises(CrossChildReference):
        record_world_change(treasure.families.a1, **CHANGE, source_session=other_session)
    assert not WorldChange.objects.exists()
