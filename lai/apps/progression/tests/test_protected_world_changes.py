"""Protected world-change keys: the generic POST cannot forge progress (storybook integrity B).

A page of the Great Storybook, a quest objective and a discovery requirement match on a change
key, so a key that proves progress is accepted from the client only when a finished producer the
child owns backs it. Real content export, two families.
"""

import uuid

import pytest
from django.utils import timezone

from apps.catalog.models import Adventure
from apps.game_sessions import services as sessions
from apps.game_sessions.models import AdventureSession, Correctness
from apps.progression import protected_changes as protected
from apps.progression.client_changes import (
    ProtectedKey,
    SessionNotFound,
    StepNotReached,
    record_client_world_change,
)
from apps.progression.models import StoryProgress, WorldChange
from apps.progression.services import record_world_change, world_change_keys
from apps.regions import great_storybook

from .shared import imported_content  # noqa: F401

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

CASTLE = "storykeeper-castle"
PASSAGE = "castle-secret-passage"


@pytest.fixture
def content(imported_content, families):  # noqa: F811
    return families


def url(child) -> str:
    return f"/api/v1/children/{child.pk}/world-changes/"


def post(client, child, key, *, location=CASTLE, kind="CREATE", source=None):
    body = {"locationSlug": location, "changeType": kind, "changeKey": key}
    if source is not None:
        body["sourceSessionId"] = str(source)
    return client.post(url(child), body, "application/json")


def producer_step(slug, key):
    entry = protected.lookup(key)
    return next(p.step_id for p in entry.producers if p.slug == slug)


def play(child, slug, key, *, finish=True, reach=True):
    """A session of `slug` as the runner leaves it: the producing step answered, then completed."""
    session, _ = sessions.start_or_resume_session(child, Adventure.objects.get(slug=slug))
    if reach:
        step = producer_step(slug, key)
        AdventureSession.objects.filter(pk=session.pk).update(current_step_id=step)
        sessions.record_step_attempt(
            child,
            session.pk,
            step_id=step,
            correctness=Correctness.NOT_APPLICABLE,
            next_step_id="complete",
            action_type="ADVANCE",
        )
    if finish:
        sessions.complete_session(child, session.pk)
    return session


def rows(child, key):
    return WorldChange.objects.filter(child=child, change_key=key)


PAGE_KEY = "STUDIO_PAGE_MENDED"
PAGE_ADVENTURE = "the-painted-words"


# --- forged writes ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("key", "location"),
    [
        ("FIRST_STORY_TOLD", CASTLE),
        ("STUDIO_PAGE_MENDED", CASTLE),
        ("SECRET_DOOR_CLUES_COLLECTED", PASSAGE),
        ("CASTLE_SECRET_DOOR_OPENED", PASSAGE),
        ("THE_CASTLES_SECRET_DOOR_COMPLETE", PASSAGE),
        ("GREAT_STORYBOOK_RESTORED", CASTLE),
        ("GREAT_STORYBOOK_RESTORED_V2", CASTLE),
        ("castle-room:illustration-studio", CASTLE),
        ("CASTLE_READING_NOOK_FOUND", CASTLE),
    ],
)
def test_a_forged_protected_key_is_refused_with_no_source(families, api, key, location):
    content = families
    response = post(api(content.a), content.a1, key, location=location)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "protected_change_key"
    assert not WorldChange.objects.exists()


@pytest.mark.parametrize("label", ["quest:restore-the-great-storybook-pathfinders", "story:x"])
def test_a_provenance_label_does_not_unlock_a_protected_key(families, api, label):
    content = families
    response = post(api(content.a), content.a1, PAGE_KEY, source=label)
    assert response.status_code == 400
    assert not WorldChange.objects.exists()


def test_a_forged_page_never_restores_the_page_or_a_quest_objective(families, api):
    content = families
    post(api(content.a), content.a1, "FIRST_STORY_TOLD")
    post(api(content.a), content.a1, PAGE_KEY)
    book = great_storybook.progress(content.a1)
    assert book["restoredRequired"] == 0 and not book["complete"]
    assert "FIRST_STORY_TOLD" not in world_change_keys(content.a1)


def test_a_protected_key_at_another_location_is_refused(content, api):
    session = play(content.a1, PAGE_ADVENTURE, PAGE_KEY)
    response = post(api(content.a), content.a1, PAGE_KEY, location="elsewhere", source=session.pk)
    assert response.status_code == 400
    assert not WorldChange.objects.exists()


def test_an_unknown_session_is_not_found_and_writes_nothing(content, api):
    response = post(api(content.a), content.a1, PAGE_KEY, source=uuid.uuid4())
    assert response.status_code == 404
    assert not WorldChange.objects.exists()


def test_another_childs_or_familys_session_is_not_found(content, api):
    client = api(content.a)
    sibling = play(content.a2, PAGE_ADVENTURE, PAGE_KEY)
    foreign = play(content.b1, PAGE_ADVENTURE, PAGE_KEY)
    for session in (sibling, foreign):
        response = post(client, content.a1, PAGE_KEY, source=session.pk)
        assert response.status_code == 404
    assert not WorldChange.objects.exists()
    # Another family's child is not found at all.
    assert post(client, content.b1, PAGE_KEY, source=foreign.pk).status_code == 404
    assert not WorldChange.objects.exists()


def test_a_completed_session_of_the_wrong_template_is_refused(content, api):
    session = play(content.a1, "quills-picture-story", "FIRST_STORY_TOLD")
    response = post(api(content.a), content.a1, PAGE_KEY, source=session.pk)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "wrong_producer"
    assert not WorldChange.objects.exists()


def test_an_incomplete_session_is_refused(content, api):
    session = play(content.a1, PAGE_ADVENTURE, PAGE_KEY, finish=False)
    response = post(api(content.a), content.a1, PAGE_KEY, source=session.pk)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "session_not_completed"
    assert not WorldChange.objects.exists()


def test_a_completed_session_that_never_reached_the_producing_step_is_refused(content, api):
    session = play(content.a1, PAGE_ADVENTURE, PAGE_KEY, reach=False)
    response = post(api(content.a), content.a1, PAGE_KEY, source=session.pk)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "step_not_reached"
    assert not WorldChange.objects.exists()


def test_a_region_session_cannot_back_an_adventure_key(content, api):
    from apps.catalog.models import ContentRelease

    now = timezone.now()
    session = AdventureSession.objects.create(
        child=content.a1,
        kind="REGION",
        region_id="some-region",
        content_release=ContentRelease.objects.first(),
        status="ACTIVE",
        started_at=now,
        last_activity_at=now,
    )
    assert post(api(content.a), content.a1, PAGE_KEY, source=session.pk).status_code == 404
    assert not WorldChange.objects.filter(child=content.a1, change_key=PAGE_KEY).exists()


# --- legitimate writes ------------------------------------------------------------------------


def test_a_real_completed_play_records_the_page_once_then_is_idempotent(content, api):
    client = api(content.a)
    session = play(content.a1, PAGE_ADVENTURE, PAGE_KEY)
    first = post(client, content.a1, PAGE_KEY, source=session.pk, kind="WHATEVER")
    assert first.status_code == 201
    assert first.json()["changeType"] == "REPAIR"  # the registered type, not the client's
    assert first.json()["sourceSessionId"] == str(session.pk)
    again = post(client, content.a1, PAGE_KEY, source=session.pk)
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"]
    assert rows(content.a1, PAGE_KEY).count() == 1
    assert great_storybook.progress(content.a1)["restoredRequired"] == 1


def test_either_registered_producer_of_a_page_is_accepted(content, api):
    session = play(content.a1, "the-painted-words-again", PAGE_KEY)
    assert post(api(content.a), content.a1, PAGE_KEY, source=session.pk).status_code == 201


def test_a_completed_story_backs_its_completion_key(content, api):
    client = api(content.a)
    key = "THE_CASTLES_SECRET_DOOR_COMPLETE"
    now = timezone.now()
    progress = StoryProgress.objects.create(
        child=content.a1,
        story_slug="the-castles-secret-door",
        current_chapter_id="x",
        started_at=now,
        last_played_at=now,
        completed_at=now,
    )
    response = post(client, content.a1, key, location=PASSAGE, source=progress.pk)
    assert response.status_code == 201
    assert response.json()["sourceSessionId"] == f"story:{progress.pk}"
    unfinished = StoryProgress.objects.create(
        child=content.a2,
        story_slug="the-castles-secret-door",
        current_chapter_id="x",
        started_at=now,
        last_played_at=now,
    )
    assert post(client, content.a2, key, location=PASSAGE, source=unfinished.pk).status_code == 400
    wrong = StoryProgress.objects.create(
        child=content.a2,
        story_slug="dragon-of-ember-mountain",
        current_chapter_id="x",
        started_at=now,
        last_played_at=now,
        completed_at=now,
    )
    assert post(client, content.a2, key, location=PASSAGE, source=wrong.pk).status_code == 400
    assert post(client, content.a1, key, location=PASSAGE, source=wrong.pk).status_code == 404


def test_an_ordinary_key_still_takes_a_label_or_the_childs_own_session(content, api):
    client = api(content.a)
    body = {"locationSlug": "lantern-tide-pools", "changeType": "UNLOCK", "changeKey": "PLANK"}
    assert client.post(url(content.a1), body, "application/json").status_code == 201
    labelled = {**body, "changeKey": "PLANK2", "sourceSessionId": "exploration-x"}
    assert client.post(url(content.a1), labelled, "application/json").status_code == 400
    sessioned = {**body, "changeKey": "PLANK3", "sourceSessionId": str(uuid.uuid4())}
    assert client.post(url(content.a1), sessioned, "application/json").status_code == 404


# --- legacy rows and location matching --------------------------------------------------------


def test_a_legacy_row_with_an_empty_source_still_restores_its_page(content):
    record_world_change(
        content.a1, location_slug=CASTLE, change_type="CREATE", change_key="FIRST_STORY_TOLD"
    )
    assert great_storybook.progress(content.a1)["restoredRequired"] == 1
    legacy = WorldChange.objects.get()
    assert legacy.source_session_id == ""


def test_a_legacy_row_with_a_blank_location_still_restores_its_page(content):
    WorldChange.objects.create(
        child=content.a1,
        location_slug="",
        change_type="CREATE",
        change_key="FIRST_STORY_TOLD",
        created_at=timezone.now(),
    )
    assert great_storybook.progress(content.a1)["restoredRequired"] == 1
    assert "FIRST_STORY_TOLD" in world_change_keys(content.a1)


def test_the_same_key_at_another_location_does_not_restore_the_page(content):
    record_world_change(
        content.a1, location_slug="elsewhere", change_type="CREATE", change_key="FIRST_STORY_TOLD"
    )
    assert great_storybook.progress(content.a1)["restoredRequired"] == 0
    assert "FIRST_STORY_TOLD" not in world_change_keys(content.a1)
    record_world_change(
        content.a1, location_slug=CASTLE, change_type="CREATE", change_key="FIRST_STORY_TOLD"
    )
    assert great_storybook.progress(content.a1)["restoredRequired"] == 1


def test_a_misplaced_protected_row_does_not_satisfy_a_quest_objective(content):
    from apps.catalog.models import Quest
    from apps.quests import services

    record_world_change(
        content.a1, location_slug="elsewhere", change_type="CREATE", change_key="FIRST_STORY_TOLD"
    )
    ctx = services.build_context(content.a1)
    assert "FIRST_STORY_TOLD" not in ctx.world_change_keys
    assert Quest.objects.filter(slug="restore-the-great-storybook-pathfinders").exists()


def test_unprotected_keys_are_unaffected_by_location_matching(content):
    record_world_change(
        content.a1, location_slug="anywhere", change_type="X", change_key="BRIDGE_REPAIRED"
    )
    assert "BRIDGE_REPAIRED" in world_change_keys(content.a1)


# --- service level ----------------------------------------------------------------------------


def test_the_service_raises_typed_errors(content):
    with pytest.raises(ProtectedKey):
        record_client_world_change(
            content.a1, location_slug=CASTLE, change_type="CREATE", change_key=PAGE_KEY
        )
    with pytest.raises(SessionNotFound):
        record_client_world_change(
            content.a1,
            location_slug=CASTLE,
            change_type="REPAIR",
            change_key=PAGE_KEY,
            session_id=uuid.uuid4(),
        )
    session = play(content.a1, PAGE_ADVENTURE, PAGE_KEY, reach=False)
    with pytest.raises(StepNotReached):
        record_client_world_change(
            content.a1,
            location_slug=CASTLE,
            change_type="REPAIR",
            change_key=PAGE_KEY,
            session_id=session.pk,
        )


def test_a_replay_through_the_service_creates_nothing_twice(content):
    child = content.a1
    session = play(child, PAGE_ADVENTURE, PAGE_KEY)
    args = {
        "location_slug": CASTLE,
        "change_type": "REPAIR",
        "change_key": PAGE_KEY,
        "session_id": session.pk,
    }
    assert record_client_world_change(child, **args).created
    assert not record_client_world_change(child, **args).created
    assert rows(child, PAGE_KEY).count() == 1
