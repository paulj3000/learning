"""World-change security audit (WS-E): the child write surface, forgery, replay and concurrency.

`CHILD_WRITE_ROUTES` is the audited list of every child-scoped write route (see the endpoint
table in `docs/security/WORLD_CHANGE_INTEGRITY.md`). A new route fails the drift test until it
is audited and added, so no write can slip in unreviewed.
"""

import uuid

import pytest
from django.urls import get_resolver
from django.utils import timezone

from apps.inventory.backfill import backfill_castle_keepsakes
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression import stories
from apps.progression.models import StoryProgress, WorldChange

from .shared import imported_content  # noqa: F401
from .test_protected_world_changes import PAGE_ADVENTURE, PAGE_KEY, PASSAGE, play, post

DOOR_KEY = "THE_CASTLES_SECRET_DOOR_COMPLETE"
DOOR_STORY = "the-castles-secret-door"

CHILD_WRITE_ROUTES = {
    "DELETE /",
    "DELETE /ai/history/",
    "DELETE /npc-memory/",
    "DELETE /photo/",
    "DELETE /quests/",
    "DELETE /rewards/",
    "DELETE /story-artifacts/<uuid:artifact_id>/",
    "DELETE /world-state/",
    "PATCH /",
    "PATCH /audio/settings/",
    "PATCH /world-state/",
    "POST /adventures/<slug:adventure_slug>/session/",
    "POST /ai/companion-turns/",
    "POST /ai/tutor-turns/",
    "POST /attempts/<uuid:attempt_id>/answer/",
    "POST /audio/speech/",
    "POST /castle/director/",
    "POST /castle/rooms/",
    "POST /content/adventures/<slug:slug>/start/",
    "POST /coop-sessions/",
    "POST /coop-sessions/<uuid:coop_id>/complete/",
    "POST /coop-sessions/<uuid:coop_id>/presence/",
    "POST /coop-sessions/<uuid:coop_id>/slots/",
    "POST /discoveries/",
    "POST /game-launches/",
    "POST /npc-memory/<slug:npc_id>/dialogue/",
    "POST /places/<slug:place_slug>/npcs/<slug:npc_id>/interactions/",
    "POST /places/<slug:place_slug>/npcs/<slug:npc_id>/interactions/<uuid:conversation_id>/advance/",
    "POST /places/<slug:place_slug>/npcs/<slug:npc_id>/interactions/<uuid:conversation_id>/choose/",
    "POST /places/<slug:place_slug>/npcs/<slug:npc_id>/interactions/<uuid:conversation_id>/end/",
    "POST /places/<slug:place_slug>/npcs/<slug:npc_id>/interactions/<uuid:conversation_id>/hint/",
    "POST /quests/<slug:quest_id>/accept/",
    "POST /regions/<slug:region_id>/launch-points/<slug:launch_id>/start/",
    "POST /regions/<slug:region_id>/npcs/<slug:npc_id>/interactions/",
    "POST /regions/<slug:region_id>/npcs/<slug:npc_id>/interactions/<uuid:conversation_id>/advance/",
    "POST /regions/<slug:region_id>/npcs/<slug:npc_id>/interactions/<uuid:conversation_id>/choose/",
    "POST /regions/<slug:region_id>/npcs/<slug:npc_id>/interactions/<uuid:conversation_id>/end/",
    "POST /regions/<slug:region_id>/npcs/<slug:npc_id>/interactions/<uuid:conversation_id>/hint/",
    "POST /regions/<slug:region_id>/session/",
    "POST /sessions/<uuid:session_id>/<slug:action>/",
    "POST /sessions/<uuid:session_id>/answers/",
    "POST /sessions/<uuid:session_id>/chests/<slug:entity_id>/challenge/",
    "POST /sessions/<uuid:session_id>/hints/",
    "POST /sessions/<uuid:session_id>/npcs/<slug:entity_id>/talk/",
    "POST /sessions/<uuid:session_id>/pickups/<slug:entity_id>/",
    "POST /sessions/<uuid:session_id>/puzzles/<slug:puzzle_id>/solve/",
    "POST /stories/<slug:story_slug>/chapters/<slug:chapter_id>/complete/",
    "POST /stories/<slug:story_slug>/flags/",
    "POST /stories/<slug:story_slug>/reflections/",
    "POST /stories/<slug:story_slug>/start/",
    "POST /story-artifacts/",
    "POST /story-artifacts/written/",
    "POST /world-changes/",
    "PUT /companion/",
    "PUT /photo/",
    "PUT /quests/<slug:quest_slug>/",
}


def _write_routes() -> set[str]:
    def walk(patterns, prefix=""):
        for p in patterns:
            if hasattr(p, "url_patterns"):
                yield from walk(p.url_patterns, prefix + str(p.pattern))
            else:
                yield prefix + str(p.pattern), p

    found = set()
    for route, pattern in walk(get_resolver().url_patterns):
        if "children/<uuid:child_id>" not in route:
            continue
        view = getattr(pattern.callback, "cls", None)
        for method in ("post", "put", "patch", "delete"):
            if view is not None and hasattr(view, method):
                found.add(
                    f"{method.upper()} " + route.replace("api/v1/children/<uuid:child_id>", "")
                )
    return found


def test_every_child_write_route_has_been_audited():
    assert _write_routes() == CHILD_WRITE_ROUTES


@pytest.fixture
def content(imported_content, families):  # noqa: F811
    return families


def finished_story(child, *, slug=DOOR_STORY, done=True):
    at = timezone.now()
    return StoryProgress.objects.create(
        child=child,
        story_slug=slug,
        current_chapter_id="x",
        started_at=at,
        last_played_at=at,
        completed_at=at if done else None,
    )


def test_no_generic_route_writes_a_protected_key_without_proof(content, api):
    client = api(content.a)
    for key, location in (
        (DOOR_KEY, PASSAGE),
        (PAGE_KEY, "storykeeper-castle"),
        ("GREAT_STORYBOOK_RESTORED", "storykeeper-castle"),
        ("castle-room:the-secret-chamber", "storykeeper-castle"),
    ):
        assert post(client, content.a1, key, location=location).status_code == 400, key
    assert not WorldChange.objects.exists()


def test_a_forged_story_key_with_an_adventure_session_is_the_wrong_producer(content, api):
    session = play(content.a1, PAGE_ADVENTURE, PAGE_KEY)
    response = post(api(content.a), content.a1, DOOR_KEY, location=PASSAGE, source=session.pk)
    assert response.status_code == 404  # an adventure session id is not a story progress id
    assert not WorldChange.objects.filter(child=content.a1, change_key=DOOR_KEY).exists()


def test_another_familys_child_is_not_found_exactly_like_an_unknown_one(content, api):
    progress = finished_story(content.b1)
    other = api(content.a)
    real = post(other, content.b1, DOOR_KEY, location=PASSAGE, source=progress.pk)
    unknown = other.post(
        f"/api/v1/children/{uuid.uuid4()}/world-changes/",
        {"locationSlug": PASSAGE, "changeType": "CREATE", "changeKey": DOOR_KEY},
        "application/json",
    )
    assert real.status_code == unknown.status_code == 404
    def shape(response):
        body = response.json()
        body.pop("request_id", None)
        return body

    assert shape(real) == shape(unknown)
    chapter = other.post(
        f"/api/v1/children/{content.b1.pk}/stories/{DOOR_STORY}/chapters/what-was-waiting/complete/",
        {},
        "application/json",
    )
    assert chapter.status_code == 404
    assert not WorldChange.objects.exists()


def test_replaying_a_story_session_writes_one_row_and_one_key(content, api):
    child = content.a1
    progress = finished_story(child)
    client = api(content.a)
    first = post(client, child, DOOR_KEY, location=PASSAGE, source=progress.pk)
    again = post(client, child, DOOR_KEY, location=PASSAGE, source=progress.pk)
    assert (first.status_code, again.status_code) == (201, 200)
    assert WorldChange.objects.filter(child=child, change_key=DOOR_KEY).count() == 1
    # The generic POST never pays; the backfill pays once; a rerun and a replay pay nothing more.
    assert not InventoryItem.objects.exists()
    first_run = backfill_castle_keepsakes(apply=True)
    second_run = backfill_castle_keepsakes(apply=True)
    assert first_run.rules["reward-secret-door-key"].granted == 1
    assert second_run.rules["reward-secret-door-key"].granted == 0
    post(client, child, DOOR_KEY, location=PASSAGE, source=progress.pk)
    assert InventoryItem.objects.filter(item__item_id="secret-door-key").count() == 1
    assert GrantedRule.objects.filter(rule__rule_id="reward-secret-door-key").count() == 1


def test_the_story_path_then_the_backfill_pay_the_key_once(content):
    from apps.catalog.models import Adventure
    from apps.game_sessions import services as sessions

    child = content.a1
    child.age_band = "EXPLORER"
    child.save()
    stories.start_story(child, DOOR_STORY)
    for chapter, adventure in (
        ("three-clues", "secret-door-chapter-1-three-clues"),
        ("the-pattern-lock", "secret-door-chapter-2-pattern-lock"),
    ):
        session, _ = sessions.start_or_resume_session(child, Adventure.objects.get(slug=adventure))
        sessions.complete_session(child, session.pk)
        stories.complete_chapter(child, DOOR_STORY, chapter)
    stories.complete_chapter(child, DOOR_STORY, "what-was-waiting")
    assert InventoryItem.objects.filter(child=child, item__item_id="secret-door-key").count() == 1
    report = backfill_castle_keepsakes(apply=True)
    assert report.rules["reward-secret-door-key"].granted == 0
    assert report.rules["reward-secret-door-key"].already_had >= 1
    assert InventoryItem.objects.filter(item__item_id="secret-door-key").count() == 1
