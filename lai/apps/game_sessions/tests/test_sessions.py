"""Region play sessions (TR-4): ownership, start-or-resume, lifecycle constraints."""

import pytest
from django.db import IntegrityError, transaction

from apps.core.catalog import ContentStatus
from apps.game_sessions.models import AdventureSession, SessionKind, SessionStatus
from apps.game_sessions.services import (
    ContentUnavailable,
    end_session,
    start_or_resume_region_session,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def test_starting_twice_resumes_the_same_session(treasure):
    child = treasure.families.a1
    first, created = start_or_resume_region_session(child, treasure.region)
    again, created_again = start_or_resume_region_session(child, treasure.region)
    assert created and not created_again
    assert first.pk == again.pk
    assert first.location_slug == "pirate-builder-bay"
    assert first.kind == SessionKind.REGION and first.region_id == treasure.region.region_id


def test_a_paused_session_is_resumed(treasure):
    session, _ = start_or_resume_region_session(treasure.families.a1, treasure.region)
    AdventureSession.objects.filter(pk=session.pk).update(status=SessionStatus.PAUSED)
    resumed, created = start_or_resume_region_session(treasure.families.a1, treasure.region)
    assert not created and resumed.pk == session.pk and resumed.status == SessionStatus.ACTIVE


def test_each_child_gets_their_own_session(treasure):
    a1, _ = start_or_resume_region_session(treasure.families.a1, treasure.region)
    a2, _ = start_or_resume_region_session(treasure.families.a2, treasure.region)
    b1, _ = start_or_resume_region_session(treasure.families.b1, treasure.region)
    assert len({a1.pk, a2.pk, b1.pk}) == 3
    assert {a1.child_id, a2.child_id, b1.child_id} == {
        treasure.families.a1.pk,
        treasure.families.a2.pk,
        treasure.families.b1.pk,
    }


def test_after_a_session_ends_a_new_one_starts(treasure):
    first, _ = start_or_resume_region_session(treasure.families.a1, treasure.region)
    end_session(first)
    first.refresh_from_db()
    assert first.status == SessionStatus.COMPLETED and first.completed_at is not None
    second, created = start_or_resume_region_session(treasure.families.a1, treasure.region)
    assert created and second.pk != first.pk


def test_ending_an_ended_session_changes_nothing(treasure):
    session, _ = start_or_resume_region_session(treasure.families.a1, treasure.region)
    end_session(session, SessionStatus.ABANDONED)
    end_session(session)
    session.refresh_from_db()
    assert session.status == SessionStatus.ABANDONED and session.completed_at is None


@pytest.mark.parametrize("what", ["region", "location"])
def test_unpublished_content_cannot_be_played(treasure, what):
    target = treasure.region if what == "region" else treasure.region.location
    target.status = ContentStatus.RETIRED
    target.save()
    with pytest.raises(ContentUnavailable):
        start_or_resume_region_session(treasure.families.a1, treasure.region)


def test_an_inactive_child_cannot_play(treasure):
    child = treasure.families.a1
    child.active = False
    child.save()
    with pytest.raises(ContentUnavailable):
        start_or_resume_region_session(child, treasure.region)


def test_the_database_allows_one_open_session_per_target(treasure):
    child = treasure.families.a1
    start_or_resume_region_session(child, treasure.region)
    with pytest.raises(IntegrityError), transaction.atomic():
        AdventureSession.objects.create(
            child=child,
            kind=SessionKind.REGION,
            region_id=treasure.region.region_id,
            location_slug="pirate-builder-bay",
            status=SessionStatus.PAUSED,
        )


@pytest.mark.parametrize(
    "fields",
    [
        {"kind": SessionKind.REGION, "region_id": "", "template_slug": ""},
        {"kind": SessionKind.REGION, "region_id": "x", "template_slug": "y"},
        {"kind": SessionKind.ADVENTURE, "template_slug": "y", "template_version": None},
        {"kind": SessionKind.REGION, "region_id": "x", "status": SessionStatus.COMPLETED},
        {"kind": SessionKind.REGION, "region_id": "x", "status": "WON"},
    ],
)
def test_the_database_refuses_inconsistent_sessions(treasure, fields):
    with pytest.raises(IntegrityError), transaction.atomic():
        AdventureSession.objects.create(
            child=treasure.families.a1, location_slug="pirate-builder-bay", **fields
        )
