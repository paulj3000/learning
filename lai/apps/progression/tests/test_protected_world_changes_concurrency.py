"""Two simultaneous client writes of one protected change (real parallel transactions)."""

import pytest

from apps.catalog.importer import import_content
from apps.game_sessions.tests.test_concurrency import race
from apps.progression.client_changes import Recorded, record_client_world_change
from apps.progression.models import WorldChange

from .test_protected_world_changes import PAGE_ADVENTURE, PAGE_KEY, play

pytestmark = [pytest.mark.postgres, pytest.mark.django_db(transaction=True)]


def _args(session):
    return {
        "location_slug": "storykeeper-castle",
        "change_type": "REPAIR",
        "change_key": PAGE_KEY,
        "session_id": session.pk,
    }


def test_simultaneous_posts_record_one_row_and_one_creation(families):
    import_content()
    child = families.a1
    session = play(child, PAGE_ADVENTURE, PAGE_KEY)
    results = race(lambda: record_client_world_change(child, **_args(session)), count=4)
    assert len(results) == 4 and all(isinstance(r, Recorded) for r in results), results
    assert sorted(r.created for r in results) == [False, False, False, True]
    assert WorldChange.objects.filter(child=child, change_key=PAGE_KEY).count() == 1
