"""Game-only WebView launches (LAI-ANDROID-API-001, ADR-036): tickets, the game session cookie,
its scope, CSRF, replay, concurrency, and logout.

The `treasure` fixture publishes Treasure Cove; its children are Pathfinders.
"""

import json
import logging
import threading
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.db import connection
from django.test import Client
from django.utils import timezone

from apps.core.content_status import ContentStatus
from apps.game_sessions.launch_views import GameLaunchThrottle
from apps.game_sessions.models import (
    ChallengeAttempt,
    GameBrowserSession,
    GameLaunchTicket,
)
from apps.inventory.models import InventoryItem
from apps.regions.models import WorldRegion
from apps.users.models import ChildProfile, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

REGION = "treasure-rush-cove"
COOKIE = "lai_game_session"
REDEEM = "/api/v1/game-launches/redeem/"
REVOKE = "/api/v1/game-launches/revoke/"
RUNTIME = "/api/v1/game-session/"


@pytest.fixture(autouse=True)
def _fresh_throttle():
    cache.clear()
    yield
    cache.clear()


def base(child) -> str:
    return f"/api/v1/children/{child.pk}/"


def post(client, url, body=None, **headers):
    return client.post(url, json.dumps(body or {}), content_type="application/json", **headers)


def code(response) -> str:
    return response.json()["error"]["code"]


def launch(client, child, region=REGION):
    return post(client, f"{base(child)}game-launches/", {"regionId": region})


def redeem(client, ticket):
    return post(client, REDEEM, {"ticket": ticket})


class Runtime:
    """The WebView: only the game cookie, plus the CSRF value it reads from `game-session/`."""

    def __init__(self, cookie_value: str):
        self.client = Client(raise_request_exception=False)
        self.client.cookies[COOKIE] = cookie_value
        self.csrf = None

    def get(self, url):
        return self.client.get(url)

    def post(self, url, body=None, *, csrf=True, **headers):
        if csrf:
            if self.csrf is None:
                self.csrf = self.client.get(RUNTIME).json()["csrfToken"]
            headers["HTTP_X_LAI_GAME_CSRF"] = self.csrf
        return post(self.client, url, body, **headers)


@pytest.fixture
def parent_a(treasure, api):
    return api(treasure.families.a)


def open_runtime(client, child, region=REGION) -> Runtime:
    ticket = launch(client, child, region).json()["ticket"]
    response = redeem(client, ticket)
    assert response.status_code == 201, response.json()
    return Runtime(response.cookies[COOKIE].value)


# --- launch ------------------------------------------------------------------------------------


def test_a_parent_launches_their_own_child(treasure, parent_a):
    child = treasure.families.a1
    response = launch(parent_a, child)
    assert response.status_code == 201
    body = response.json()
    assert set(body) == {"ticket", "expiresAt", "childId", "regionId", "redeemUrl", "gameUrl"}
    assert body["childId"] == str(child.pk) and body["regionId"] == REGION
    assert body["redeemUrl"] == REDEEM and body["gameUrl"] == "/game/"
    assert response["Cache-Control"] == "no-store"
    row = GameLaunchTicket.objects.get()
    assert row.parent_id == treasure.families.a.pk and row.child_id == child.pk
    assert body["ticket"] not in row.ticket_hash and len(row.ticket_hash) == 64
    assert (row.expires_at - row.created_at) == timedelta(seconds=60)


def test_launch_is_child_scoped(treasure, api, parent_a):
    families = treasure.families
    foreign = launch(parent_a, families.b1)
    assert foreign.status_code == 404 and code(foreign) == "not_found"
    assert launch(api(), families.a1).status_code == 401
    assert launch(api("sub-never-onboarded"), families.a1).status_code == 403
    assert GameLaunchTicket.objects.count() == 0


@pytest.mark.parametrize("region", ["no-such-region", "Bad Slug"])
def test_launch_rejects_unknown_regions(treasure, parent_a, region):
    response = launch(parent_a, treasure.families.a1, region)
    assert response.status_code in (400, 404)
    assert GameLaunchTicket.objects.count() == 0


def test_launch_rejects_unpublished_regions_and_ineligible_age_bands(treasure, parent_a):
    child = treasure.families.a1
    WorldRegion.objects.filter(region_id=REGION).update(status=ContentStatus.DRAFT)
    assert launch(parent_a, child).status_code == 404
    WorldRegion.objects.filter(region_id=REGION).update(status=ContentStatus.PUBLISHED)
    world = treasure.region.location.world
    world.supported_age_bands = ["EXPLORER"]
    world.save()
    assert launch(parent_a, child).status_code == 404
    assert GameLaunchTicket.objects.count() == 0


def test_an_inactive_child_cannot_be_launched(treasure, parent_a):
    child = treasure.families.a1
    ChildProfile.objects.filter(pk=child.pk).update(active=False)
    response = launch(parent_a, child)
    assert response.status_code == 409 and code(response) == "child_inactive"


def test_the_launch_body_is_closed(treasure, parent_a):
    families = treasure.families
    url = f"{base(families.a1)}game-launches/"
    spoof = post(parent_a, url, {"regionId": REGION, "childId": str(families.b1.pk)})
    assert spoof.status_code == 400
    assert post(parent_a, url, {}).status_code == 400
    assert GameLaunchTicket.objects.count() == 0


def test_launches_are_rate_limited(treasure, parent_a, monkeypatch):
    monkeypatch.setattr(GameLaunchThrottle, "THROTTLE_RATES", {"game_launch": "2/min"})
    child = treasure.families.a1
    assert launch(parent_a, child).status_code == 201
    assert launch(parent_a, child).status_code == 201
    limited = launch(parent_a, child)
    assert limited.status_code == 429 and code(limited) == "throttled"
    assert "Retry-After" in limited


# --- redemption ----------------------------------------------------------------------------------


def test_redemption_sets_a_scoped_httponly_strict_cookie(treasure, parent_a):
    child = treasure.families.a1
    ticket = launch(parent_a, child).json()["ticket"]
    response = redeem(parent_a, ticket)
    assert response.status_code == 201
    body = response.json()
    assert body["childId"] == str(child.pk) and body["regionId"] == REGION
    cookie = response.cookies[COOKIE]
    assert cookie["httponly"] and cookie["secure"]
    assert cookie["samesite"] == "Strict" and cookie["path"] == "/api/v1/"
    assert cookie["max-age"] == 3600 and not cookie["domain"]
    assert cookie.value not in response.content.decode() and ticket not in response.content.decode()
    session = GameBrowserSession.objects.get()
    assert session.token_hash != cookie.value and session.child_id == child.pk


def test_a_ticket_is_single_use(treasure, parent_a):
    ticket = launch(parent_a, treasure.families.a1).json()["ticket"]
    assert redeem(parent_a, ticket).status_code == 201
    replay = redeem(parent_a, ticket)
    assert replay.status_code == 409 and code(replay) == "launch_ticket_invalid"
    assert COOKIE not in replay.cookies
    assert GameBrowserSession.objects.count() == 1


def test_an_expired_ticket_is_rejected(treasure, parent_a):
    ticket = launch(parent_a, treasure.families.a1).json()["ticket"]
    GameLaunchTicket.objects.update(
        created_at=timezone.now() - timedelta(minutes=5),
        expires_at=timezone.now() - timedelta(seconds=1),
    )
    assert code(redeem(parent_a, ticket)) == "launch_ticket_invalid"
    assert GameBrowserSession.objects.count() == 0


def test_another_parent_cannot_redeem_a_ticket_and_does_not_burn_it(treasure, api, parent_a):
    ticket = launch(parent_a, treasure.families.a1).json()["ticket"]
    stolen = redeem(api(treasure.families.b), ticket)
    assert stolen.status_code == 409 and code(stolen) == "launch_ticket_invalid"
    assert redeem(parent_a, ticket).status_code == 201


def test_unknown_and_malformed_tickets_get_the_same_answer(treasure, parent_a):
    unknown = redeem(parent_a, "x" * 43)
    assert unknown.status_code == 409 and code(unknown) == "launch_ticket_invalid"
    assert redeem(parent_a, "short").status_code == 400
    assert post(parent_a, REDEEM, {"ticket": "x" * 43, "childId": "y"}).status_code == 400


def test_redemption_needs_the_bearer_token(treasure, api, parent_a):
    ticket = launch(parent_a, treasure.families.a1).json()["ticket"]
    assert redeem(api(), ticket).status_code == 401
    runtime = open_runtime(parent_a, treasure.families.a2)
    assert runtime.post(REDEEM, {"ticket": ticket}).status_code == 401
    assert redeem(parent_a, ticket).status_code == 201  # still unused


def test_redemption_rechecks_the_child_and_region(treasure, parent_a):
    child = treasure.families.a1
    ticket = launch(parent_a, child).json()["ticket"]
    ChildProfile.objects.filter(pk=child.pk).update(active=False)
    assert code(redeem(parent_a, ticket)) == "launch_ticket_invalid"
    ChildProfile.objects.filter(pk=child.pk).update(active=True)
    assert code(redeem(parent_a, ticket)) == "launch_ticket_invalid"  # burned by the failure
    ticket = launch(parent_a, child).json()["ticket"]
    WorldRegion.objects.filter(region_id=REGION).update(status=ContentStatus.RETIRED)
    assert code(redeem(parent_a, ticket)) == "launch_ticket_invalid"
    assert GameBrowserSession.objects.count() == 0


def test_a_new_redemption_revokes_the_parents_previous_game_session(treasure, parent_a):
    first = open_runtime(parent_a, treasure.families.a1)
    assert first.get(RUNTIME).status_code == 200
    second = open_runtime(parent_a, treasure.families.a2)
    assert first.get(RUNTIME).status_code == 401
    assert second.get(RUNTIME).json()["childId"] == str(treasure.families.a2.pk)


@pytest.mark.django_db(transaction=True)
def test_concurrent_redemptions_of_one_ticket_create_one_session(treasure, token_for):
    families = treasure.families
    client = Client(raise_request_exception=False)
    client.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token_for(families.a.cognito_sub)}"
    ticket = launch(client, families.a1).json()["ticket"]
    barrier = threading.Barrier(6)
    statuses: list[int] = []

    def work():
        local = Client(raise_request_exception=False)
        local.defaults["HTTP_AUTHORIZATION"] = client.defaults["HTTP_AUTHORIZATION"]
        try:
            barrier.wait()
            statuses.append(redeem(local, ticket).status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=work) for _ in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert sorted(statuses) == [201, 409, 409, 409, 409, 409]
    assert GameBrowserSession.objects.count() == 1


# --- the runtime's grant -------------------------------------------------------------------------


def test_the_runtime_context_is_minimal(treasure, parent_a):
    child = treasure.families.a1
    runtime = open_runtime(parent_a, child)
    response = runtime.get(RUNTIME)
    assert response.status_code == 200 and response["Cache-Control"] == "no-store"
    body = response.json()
    assert body["childId"] == str(child.pk) and body["regionId"] == REGION
    assert body["ageBand"] == "PATHFINDER" and body["sessionMinutes"] == 10
    text = response.content.decode()
    assert "Zinnia" not in text and treasure.families.a.cognito_sub not in text
    assert str(treasure.families.a.pk) not in text


def test_the_runtime_plays_its_region_through_the_existing_play_api(treasure, parent_a):
    child = treasure.families.a1
    runtime = open_runtime(parent_a, child)
    assert runtime.get(f"{base(child)}regions/{REGION}/").status_code == 200
    started = runtime.post(f"{base(child)}regions/{REGION}/session/")
    assert started.status_code == 201
    session_id = started.json()["sessionId"]
    issued = runtime.post(f"{base(child)}sessions/{session_id}/chests/cove-chest/challenge/")
    assert issued.status_code == 201
    attempt = ChallengeAttempt.objects.get(pk=issued.json()["attemptId"])
    url = f"{base(child)}attempts/{attempt.pk}/answer/"
    answered = runtime.post(url, {"answer": attempt.answer})
    assert answered.status_code == 200 and answered.json()["chestOpened"] is True
    assert runtime.post(f"{base(child)}sessions/{session_id}/pause/").json()["status"] == "PAUSED"
    assert runtime.post(f"{base(child)}sessions/{session_id}/resume/").status_code == 200
    accepted = runtime.post(f"{base(child)}quests/{treasure.quest.slug}/accept/")
    assert accepted.status_code in (200, 201)
    assert runtime.get(f"{base(child)}assets/?ids=treasure-chest").status_code == 200


def test_the_runtime_cannot_grant_itself_rewards(treasure, parent_a):
    child = treasure.families.a1
    runtime = open_runtime(parent_a, child)
    session_id = runtime.post(f"{base(child)}regions/{REGION}/session/").json()["sessionId"]
    issued = runtime.post(f"{base(child)}sessions/{session_id}/chests/cove-chest/challenge/")
    attempt_id = issued.json()["attemptId"]
    forged = runtime.post(
        f"{base(child)}attempts/{attempt_id}/answer/",
        {"answer": 0, "correct": True, "reward": "golden-doubloon"},
    )
    assert forged.status_code == 400
    assert InventoryItem.objects.filter(child=child).count() == 0


def test_writes_need_the_csrf_header_and_an_approved_origin(treasure, parent_a, settings):
    child = treasure.families.a1
    runtime = open_runtime(parent_a, child)
    url = f"{base(child)}regions/{REGION}/session/"
    missing = runtime.post(url, csrf=False)
    assert missing.status_code == 403 and code(missing) == "game_csrf_failed"
    wrong = runtime.post(url, csrf=False, HTTP_X_LAI_GAME_CSRF="0" * 64)
    assert code(wrong) == "game_csrf_failed"
    evil = runtime.post(url, HTTP_ORIGIN="https://evil.example")
    assert evil.status_code == 403 and code(evil) == "game_csrf_failed"
    same = runtime.post(url, HTTP_ORIGIN="http://testserver")
    assert same.status_code == 201
    settings.LAI_GAME_ALLOWED_ORIGINS = ["https://app.example"]
    assert runtime.post(url, HTTP_ORIGIN="https://app.example").status_code == 200


def test_the_runtime_cannot_reach_another_child(treasure, parent_a):
    families = treasure.families
    runtime = open_runtime(parent_a, families.a1)
    for other in (families.a2, families.b1):
        assert runtime.get(f"{base(other)}regions/{REGION}/").status_code == 404
        assert runtime.post(f"{base(other)}regions/{REGION}/session/").status_code == 404
        assert runtime.get(f"{base(other)}assets/?ids=treasure-chest").status_code == 404


def test_the_runtime_cannot_reach_another_region(treasure, parent_a, api):
    child = treasure.families.a1
    WorldRegion.objects.create(
        region_id="second-cove",
        location=treasure.region.location,
        title="Second Cove",
        status=ContentStatus.PUBLISHED,
    )
    runtime = open_runtime(parent_a, child)
    assert runtime.get(f"{base(child)}regions/second-cove/").status_code == 404
    other_session = post(parent_a, f"{base(child)}regions/second-cove/session/")
    assert other_session.status_code == 201  # the parent's bearer token can
    session_id = other_session.json()["sessionId"]
    assert runtime.get(f"{base(child)}sessions/{session_id}/").status_code == 404
    assert runtime.post(f"{base(child)}sessions/{session_id}/pause/").status_code == 404


@pytest.mark.parametrize(
    "route",
    [
        "/api/v1/me/",
        "/api/v1/children/",
        "{child}",
        "{child}home/",
        "{child}regions/",
        "{child}progress/",
        "{child}inventory/",
        "{child}regions/treasure-rush-cove/adventures/",
    ],
)
def test_the_cookie_does_not_authenticate_native_routes(treasure, parent_a, route):
    child = treasure.families.a1
    runtime = open_runtime(parent_a, child)
    url = route.format(child=base(child))
    assert runtime.get(url).status_code == 401


def test_the_cookie_cannot_launch_revoke_or_manage_children(treasure, parent_a):
    child = treasure.families.a1
    runtime = open_runtime(parent_a, child)
    assert runtime.post(f"{base(child)}game-launches/", {"regionId": REGION}).status_code == 401
    assert runtime.post(REVOKE).status_code == 401
    assert runtime.post("/api/v1/children/", {"nickname": "X"}).status_code == 401
    assert runtime.client.patch(base(child), "{}", "application/json").status_code == 401


def test_a_bearer_token_does_not_open_the_runtime_routes(treasure, parent_a):
    assert parent_a.get(RUNTIME).status_code == 401
    assert post(parent_a, f"{RUNTIME}end/").status_code == 401


# --- ending a game session -----------------------------------------------------------------------


def test_the_runtime_ends_its_own_session(treasure, parent_a):
    child = treasure.families.a1
    runtime = open_runtime(parent_a, child)
    value = runtime.client.cookies[COOKIE].value
    assert runtime.post(f"{RUNTIME}end/", csrf=False).status_code == 403
    ended = runtime.post(f"{RUNTIME}end/")
    assert ended.status_code == 200 and ended.json() == {"ended": True}
    assert ended.cookies[COOKIE].value == "" and ended.cookies[COOKIE]["max-age"] == 0
    assert Runtime(value).get(RUNTIME).status_code == 401  # the old value is dead server-side
    assert GameBrowserSession.objects.get().revoked_at is not None


def test_native_revoke_ends_every_game_session_and_voids_tickets(treasure, parent_a, api):
    families = treasure.families
    runtime = open_runtime(parent_a, families.a1)
    pending = launch(parent_a, families.a2).json()["ticket"]
    other_family = open_runtime(api(families.b), families.b1)
    response = post(parent_a, REVOKE)
    assert response.status_code == 200 and response.json() == {"revokedSessions": 1}
    assert runtime.get(RUNTIME).status_code == 401
    assert code(redeem(parent_a, pending)) == "launch_ticket_invalid"
    assert other_family.get(RUNTIME).status_code == 200


def test_expiry_and_deactivation_end_the_game_session(treasure, parent_a):
    families = treasure.families
    runtime = open_runtime(parent_a, families.a1)
    ChildProfile.objects.filter(pk=families.a1.pk).update(active=False)
    assert runtime.get(RUNTIME).status_code == 401
    ChildProfile.objects.filter(pk=families.a1.pk).update(active=True)
    assert runtime.get(RUNTIME).status_code == 200
    ParentAccount.objects.filter(pk=families.a.pk).update(is_active=False)
    assert runtime.get(RUNTIME).status_code == 401
    ParentAccount.objects.filter(pk=families.a.pk).update(is_active=True)
    GameBrowserSession.objects.update(
        created_at=timezone.now() - timedelta(hours=2),
        expires_at=timezone.now() - timedelta(seconds=1),
    )
    assert runtime.get(RUNTIME).status_code == 401


def test_logs_never_carry_tickets_or_cookie_values(treasure, parent_a, caplog):
    child = treasure.families.a1
    with caplog.at_level(logging.DEBUG):
        ticket = launch(parent_a, child).json()["ticket"]
        response = redeem(parent_a, ticket)
        redeem(parent_a, ticket)
        value = response.cookies[COOKIE].value
        Runtime(value).post(f"{base(child)}regions/{REGION}/session/", csrf=False)
        Runtime("not-a-real-cookie-value").get(RUNTIME)
    text = " ".join(r.getMessage() for r in caplog.records)
    assert ticket not in text and value not in text and "Zinnia" not in text
    assert "game_session_invalid" in text and "game_csrf_failed" in text
