"""The Treasure Rush play API (TR-5), end to end through HTTP with locally signed tokens."""

import json
import uuid

import pytest

from apps.catalog.models import Quest as QuestDefinition
from apps.core.content_status import ContentStatus
from apps.education.models import ChallengeSpec, SkillEvidence
from apps.game_sessions.models import AdventureSession, ChallengeAttempt, SessionStatus
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import WorldChange
from apps.quests.models import QuestProgress
from apps.regions.models import WorldRegion

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

REGION = "treasure-rush-cove"
CHEST = "cove-chest"
QUEST = "treasure-rush-cove"


def base(child) -> str:
    return f"/api/v1/children/{child.pk}/"


def post(client, url, body=None):
    return client.post(url, json.dumps(body or {}), content_type="application/json")


def keys_in(value) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {k for v in value.values() for k in keys_in(v)}
    if isinstance(value, list):
        return {k for v in value for k in keys_in(v)}
    return set()


@pytest.fixture
def a(treasure, api):
    """Parent A's client and their first child."""
    return api(treasure.families.a), treasure.families.a1


def start(client, child):
    return post(client, f"{base(child)}regions/{REGION}/session/")


def challenge(client, child):
    session_id = start(client, child).json()["sessionId"]
    response = post(client, f"{base(child)}sessions/{session_id}/chests/{CHEST}/challenge/")
    assert response.status_code in (200, 201), response.json()
    return response.json()


def answer(client, child, attempt_id, body):
    return post(client, f"{base(child)}attempts/{attempt_id}/answer/", body)


def stored(attempt_id) -> ChallengeAttempt:
    return ChallengeAttempt.objects.get(pk=attempt_id)


def wrong_choice(issued) -> int:
    right = stored(issued["attemptId"]).answer
    return next(c for c in issued["challenge"]["choices"] if c != right)


def counts(child) -> dict:
    return {
        "world_changes": WorldChange.objects.filter(child=child).count(),
        "items": InventoryItem.objects.filter(child=child).count(),
        "grants": GrantedRule.objects.filter(child=child).count(),
        "evidence": SkillEvidence.objects.filter(child=child).count(),
    }


# --- Authentication and isolation -------------------------------------------------------------


def every_route(child, session_id=None, attempt_id=None):
    session_id = session_id or uuid.uuid4()
    attempt_id = attempt_id or uuid.uuid4()
    root = base(child)
    return [
        ("get", f"{root}regions/{REGION}/"),
        ("post", f"{root}regions/{REGION}/session/"),
        ("get", f"{root}sessions/{session_id}/"),
        ("post", f"{root}sessions/{session_id}/pause/"),
        ("post", f"{root}sessions/{session_id}/chests/{CHEST}/challenge/"),
        ("post", f"{root}attempts/{attempt_id}/answer/"),
        ("post", f"{root}quests/{QUEST}/accept/"),
        ("get", f"{root}progress/"),
    ]


def call(client, method, url):
    if method == "get":
        return client.get(url)
    return post(client, url, {"answer": 1} if url.endswith("answer/") else None)


def test_every_route_requires_authentication(treasure, api):
    anonymous = api()
    for method, url in every_route(treasure.families.a1):
        response = call(anonymous, method, url)
        assert response.status_code == 401, url
        assert response.json()["error"]["code"] == "not_authenticated"


def test_another_familys_child_is_not_found_on_every_route(treasure, api):
    intruder = api(treasure.families.b)
    for method, url in every_route(treasure.families.a1):
        response = call(intruder, method, url)
        assert response.status_code == 404, url
        assert response.json()["error"]["code"] == "not_found"
    assert not AdventureSession.objects.exists()
    assert not QuestProgress.objects.exists()


def test_a_childs_records_cannot_be_reached_through_another_child(a, treasure):
    client, child = a
    issued = challenge(client, child)
    sibling = treasure.families.a2  # same parent, different child
    session_id = issued["sessionId"]
    for method, url in every_route(sibling, session_id, issued["attemptId"])[2:6]:
        response = call(client, method, url)
        assert response.status_code == 404, url
        assert str(child.pk) not in response.content.decode()
    assert stored(issued["attemptId"]).status == "ISSUED"


# --- Bootstrap -------------------------------------------------------------------------------


def test_the_bootstrap_describes_the_published_region_for_this_child(a):
    client, child = a
    body = client.get(f"{base(child)}regions/{REGION}/").json()
    assert body["region"]["regionId"] == REGION
    assert body["region"]["locationSlug"] == "pirate-builder-bay"
    assert body["spawn"]["checkpointId"] == "cove-landing"
    assert [n["npcId"] for n in body["npcs"]] == ["pirate-pip"]
    [chest] = body["chests"]
    assert chest["entityId"] == CHEST and chest["assetId"] == "treasure-chest"
    assert chest["isOpen"] is False and chest["challengeAvailable"] is True
    assert chest["placeholder"] == {"width": 1.2, "height": 0.9, "depth": 0.8}
    [quest] = body["quests"]
    assert (quest["questId"], quest["status"]) == (QUEST, "AVAILABLE")
    assert body["session"] is None and body["worldChanges"] == []


def test_the_bootstrap_has_no_answers_urls_or_admin_fields(a):
    client, child = a
    text = client.get(f"{base(child)}regions/{REGION}/").content.decode()
    for forbidden in ('"answer"', "http", ".glb", ".gltf", "world_change_key", "seed"):
        assert forbidden not in text


@pytest.mark.parametrize("status", [ContentStatus.DRAFT, ContentStatus.RETIRED])
def test_an_unpublished_region_is_not_found(a, status):
    client, child = a
    WorldRegion.objects.filter(region_id=REGION).update(status=status)
    assert client.get(f"{base(child)}regions/{REGION}/").status_code == 404
    assert start(client, child).status_code == 404


def test_draft_challenges_and_quests_are_not_offered(a):
    client, child = a
    ChallengeSpec.objects.filter(slug="treasure-cove-pathfinder").update(status=ContentStatus.DRAFT)
    QuestDefinition.objects.filter(slug=QUEST).update(active=False)
    body = client.get(f"{base(child)}regions/{REGION}/").json()
    assert body["chests"][0]["challengeAvailable"] is False
    assert body["quests"] == []


# --- Sessions --------------------------------------------------------------------------------


def test_starting_twice_resumes_one_session(a):
    client, child = a
    first = start(client, child)
    again = start(client, child)
    assert (first.status_code, again.status_code) == (201, 200)
    assert first.json()["sessionId"] == again.json()["sessionId"]
    assert first.json()["status"] == "ACTIVE" and first.json()["kind"] == "REGION"


def test_starting_a_session_does_not_accept_a_quest(a):
    client, child = a
    start(client, child)
    assert not QuestProgress.objects.filter(child=child).exists()


def test_the_session_lifecycle(a):
    client, child = a
    session_id = start(client, child).json()["sessionId"]
    url = f"{base(child)}sessions/{session_id}/"
    assert post(client, f"{url}pause/").json()["status"] == "PAUSED"
    assert post(client, f"{url}pause/").json()["status"] == "PAUSED"  # a retry is a no-op
    assert post(client, f"{url}resume/").json()["status"] == "ACTIVE"
    done = post(client, f"{url}complete/").json()
    assert done["status"] == "COMPLETED" and done["completedAt"]
    refused = post(client, f"{url}resume/")
    assert refused.status_code == 409
    assert refused.json()["error"]["code"] == "invalid_transition"
    assert post(client, f"{url}abandon/").status_code == 409
    assert client.get(url).json()["status"] == "COMPLETED"


def test_an_unknown_action_is_refused(a):
    client, child = a
    session_id = start(client, child).json()["sessionId"]
    response = post(client, f"{base(child)}sessions/{session_id}/explode/")
    assert response.status_code == 409
    assert AdventureSession.objects.get(pk=session_id).status == SessionStatus.ACTIVE


def test_lifecycle_requests_take_no_body(a):
    client, child = a
    session_id = start(client, child).json()["sessionId"]
    response = post(client, f"{base(child)}sessions/{session_id}/complete/", {"status": "ACTIVE"})
    assert response.status_code == 400
    assert AdventureSession.objects.get(pk=session_id).status == SessionStatus.ACTIVE


# --- Quests ----------------------------------------------------------------------------------


def test_accepting_pips_quest(a):
    client, child = a
    first = post(client, f"{base(child)}quests/{QUEST}/accept/")
    again = post(client, f"{base(child)}quests/{QUEST}/accept/")
    assert (first.status_code, again.status_code) == (201, 200)
    assert first.json()["status"] == "ACTIVE"
    assert first.json()["currentStageId"] == "open-the-chest"
    body = client.get(f"{base(child)}regions/{REGION}/").json()
    assert body["quests"][0]["status"] == "ACTIVE"


def test_a_draft_quest_cannot_be_accepted_and_looks_unknown(a):
    client, child = a
    QuestDefinition.objects.filter(slug=QUEST).update(active=False)
    assert post(client, f"{base(child)}quests/{QUEST}/accept/").status_code == 404
    assert post(client, f"{base(child)}quests/no-such-quest/accept/").status_code == 404


def test_an_ineligible_quest_is_refused(a):
    client, child = a
    QuestDefinition.objects.filter(slug=QUEST).update(age_bands=["SPROUT"])
    response = post(client, f"{base(child)}quests/{QUEST}/accept/")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "quest_unavailable"


# --- Challenges and answers ------------------------------------------------------------------


def test_a_challenge_never_includes_its_answer(a):
    client, child = a
    issued = challenge(client, child)
    assert "answer" not in keys_in(issued)
    assert set(issued["challenge"]) == {
        "skillId",
        "operation",
        "operands",
        "responseMode",
        "choices",
    }
    assert issued["challenge"]["operation"] == "ADD" and len(issued["challenge"]["choices"]) == 4
    assert issued["attemptNumber"] == 1 and issued["targetEntityId"] == CHEST


def test_asking_again_returns_the_same_challenge(a):
    client, child = a
    first = challenge(client, child)
    url = f"{base(child)}sessions/{first['sessionId']}/chests/{CHEST}/challenge/"
    again = post(client, url)
    assert again.status_code == 200 and again.json() == first


def test_an_unknown_chest_is_not_found(a):
    client, child = a
    session_id = start(client, child).json()["sessionId"]
    response = post(client, f"{base(child)}sessions/{session_id}/chests/no-chest/challenge/")
    assert response.status_code == 404


def test_a_wrong_answer(a):
    client, child = a
    issued = challenge(client, child)
    response = answer(client, child, issued["attemptId"], {"answer": wrong_choice(issued)})
    body = response.json()
    assert response.status_code == 200
    assert body["correct"] is False and body["feedback"] == "TRY_AGAIN" and body["canRetry"]
    assert body["chestOpened"] is False and body["newItems"] == []
    assert counts(child) == {"world_changes": 0, "items": 0, "grants": 0, "evidence": 1}
    retry = challenge(client, child)
    assert retry["attemptNumber"] == 2


def test_the_right_answer_opens_the_chest_and_completes_the_accepted_quest(a):
    client, child = a
    post(client, f"{base(child)}quests/{QUEST}/accept/")
    issued = challenge(client, child)
    right = stored(issued["attemptId"]).answer
    response = answer(client, child, issued["attemptId"], {"answer": right, "hintLevel": 1})
    body = response.json()
    assert response.status_code == 200
    assert body["correct"] is True and body["feedback"] == "CORRECT" and body["chestOpened"]
    assert [item["itemId"] for item in body["newItems"]] == ["golden-doubloon"]
    assert body["newItems"][0]["category"] == "KEEPSAKE"
    assert body["rewardMessage"]
    [quest] = body["questUpdates"]
    assert quest["questId"] == QUEST and quest["status"] == "COMPLETED" and quest["justCompleted"]
    region = client.get(f"{base(child)}regions/{REGION}/").json()
    assert region["chests"][0]["isOpen"] is True
    assert region["quests"][0]["status"] == "COMPLETED"
    again = post(client, f"{base(child)}sessions/{issued['sessionId']}/chests/{CHEST}/challenge/")
    assert again.status_code == 409 and again.json()["error"]["code"] == "chest_already_open"


def test_a_replayed_answer_is_refused_and_grants_nothing_again(a):
    client, child = a
    issued = challenge(client, child)
    right = stored(issued["attemptId"]).answer
    answer(client, child, issued["attemptId"], {"answer": right})
    before = counts(child)
    replay = answer(client, child, issued["attemptId"], {"answer": right})
    assert replay.status_code == 409
    assert replay.json()["error"]["code"] == "attempt_already_answered"
    assert counts(child) == before == {"world_changes": 1, "items": 1, "grants": 1, "evidence": 1}


@pytest.mark.parametrize(
    "body",
    [
        {"answer": 3, "correct": True},
        {"answer": 3, "reward": "golden-doubloon"},
        {"answer": 3, "worldChange": "TREASURE_RUSH_COVE_CHEST_OPENED"},
    ],
)
def test_client_supplied_outcomes_are_refused(a, body):
    client, child = a
    issued = challenge(client, child)
    response = answer(client, child, issued["attemptId"], body)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"
    assert stored(issued["attemptId"]).status == "ISSUED"
    assert counts(child)["evidence"] == 0


@pytest.mark.parametrize("raw", ["3", 3.5, True, None, [3]])
def test_answers_that_are_not_integers_are_refused(a, raw):
    client, child = a
    issued = challenge(client, child)
    response = answer(client, child, issued["attemptId"], {"answer": raw})
    assert response.status_code == 400
    assert stored(issued["attemptId"]).status == "ISSUED"


def test_a_choice_that_was_not_offered_is_refused(a):
    client, child = a
    issued = challenge(client, child)
    response = answer(client, child, issued["attemptId"], {"answer": 99})
    assert response.status_code == 400
    assert response.json()["error"]["details"]["answer"][0]["code"] == "invalid_answer"
    assert stored(issued["attemptId"]).status == "ISSUED"


def test_another_familys_parent_cannot_answer_for_my_child(a, treasure, api):
    client, child = a
    issued = challenge(client, child)
    intruder = api(treasure.families.b)
    right = stored(issued["attemptId"]).answer
    for target in (child, treasure.families.b1):
        response = answer(intruder, target, issued["attemptId"], {"answer": right})
        assert response.status_code == 404
    assert counts(child)["world_changes"] == 0
    assert counts(treasure.families.b1)["world_changes"] == 0


def test_a_challenge_issued_before_retirement_can_still_be_answered(a):
    client, child = a
    issued = challenge(client, child)
    WorldRegion.objects.filter(region_id=REGION).update(status=ContentStatus.RETIRED)
    ChallengeSpec.objects.filter(slug="treasure-cove-pathfinder").update(
        status=ContentStatus.RETIRED
    )
    right = stored(issued["attemptId"]).answer
    response = answer(client, child, issued["attemptId"], {"answer": right})
    assert response.status_code == 200 and response.json()["chestOpened"]
    # ...but nothing new starts in retired content.
    assert start(client, child).status_code == 404
    resume = post(client, f"{base(child)}sessions/{issued['sessionId']}/pause/")
    assert resume.status_code == 200
    refused = post(client, f"{base(child)}sessions/{issued['sessionId']}/resume/")
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "content_unavailable"


def test_answering_in_a_closed_session_is_refused(a):
    client, child = a
    issued = challenge(client, child)
    post(client, f"{base(child)}sessions/{issued['sessionId']}/abandon/")
    right = stored(issued["attemptId"]).answer
    response = answer(client, child, issued["attemptId"], {"answer": right})
    assert response.status_code == 409 and response.json()["error"]["code"] == "session_not_open"


# --- Progress --------------------------------------------------------------------------------


def test_progress_reports_this_childs_state_only(a, treasure):
    client, child = a
    post(client, f"{base(child)}quests/{QUEST}/accept/")
    issued = challenge(client, child)
    answer(client, child, issued["attemptId"], {"answer": wrong_choice(issued)})
    retry = challenge(client, child)
    answer(client, child, retry["attemptId"], {"answer": stored(retry["attemptId"]).answer})

    body = client.get(f"{base(child)}progress/").json()
    assert len(body["sessions"]) == 1 and body["sessions"][0]["status"] == "ACTIVE"
    assert body["openedChests"] == [{"regionId": REGION, "entityId": CHEST}]
    assert [c["changeKey"] for c in body["worldChanges"]] == ["TREASURE_RUSH_COVE_CHEST_OPENED"]
    assert [entry["item"]["itemId"] for entry in body["inventory"]] == ["golden-doubloon"]
    assert [(q["questId"], q["status"]) for q in body["quests"]] == [(QUEST, "COMPLETED")]
    assert body["practice"] == [
        {"objectiveCode": "addition-within-ten", "attempts": 2, "correct": 1}
    ]
    assert "answer" not in keys_in(body)

    sibling = client.get(f"{base(treasure.families.a2)}progress/").json()
    assert sibling == {
        "sessions": [],
        "worldChanges": [],
        "openedChests": [],
        "inventory": [],
        "quests": [],
        "practice": [],
        "mastery": [],  # LAI-0603, additive
        "discoveredIds": [],  # LAI-0605, additive
    }


def test_the_right_answer_as_a_string_is_still_refused(a):
    client, child = a
    issued = challenge(client, child)
    right = stored(issued["attemptId"]).answer
    response = answer(client, child, issued["attemptId"], {"answer": str(right)})
    assert response.status_code == 400
    assert counts(child)["world_changes"] == 0
