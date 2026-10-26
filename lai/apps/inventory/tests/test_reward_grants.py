"""Server-authoritative rewards from step adventures (LAI-0604).

Through HTTP with a verified Cognito token, the real Python engine and PostgreSQL. The rule
resolution is the golden-vector port (`apps.inventory.rewards`); these tests pin when rewards
fire, that they fire once, and what clients are told.
"""

import copy
import threading
import uuid

import pytest
from django.db import connection
from django.test import Client

from apps.catalog.importer import import_content
from apps.catalog.tests.helpers import base_collections, write_export
from apps.education.models import SkillProgress
from apps.game_sessions.models import AdventureSession, SessionStatus
from apps.inventory.models import GrantedRule, InventoryItem

pytestmark = [pytest.mark.postgres]


def step(step_id, step_type, presentation, transitions, objectives=()):
    return {
        "id": step_id,
        "type": step_type,
        "objectiveIds": list(objectives),
        "presentation": presentation,
        "transitions": transitions,
        "fallback": {"text": "x"},
    }


def reward_catalog():
    """`bridge`: count (NUMBER_INPUT) -> fix (WORLD_CHANGE `BRIDGE_FIXED`) -> done (COMPLETE).
    `finale`: starts on a COMPLETE step (only finalising ends it). `plain`: one CHOICE, no
    rewards. Rules: the world change gives a shell; finishing `bridge` gives a hammer and a
    second shell, which completes the `shells` set (its cosmetic is a hat); `finale` gives a
    medal; a rule for an adventure nobody plays gives a crown."""
    c = base_collections()
    c["adventures.json"]["learningObjectives"] = [
        {"code": "count-10", "domain": "numeracy", "title": "Counting to ten"}
    ]
    choice = {
        "kind": "choice",
        "prompt": "Pick",
        "correctOptionId": "b",
        "options": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],
    }
    c["adventures.json"]["adventures"] = [
        {
            "slug": "bridge",
            "title": "Bridge",
            "version": 1,
            "locationSlug": "bay",
            "ageBands": ["PATHFINDER"],
            "entryStepId": "count",
            "steps": [
                step(
                    "count",
                    "NUMBER_INPUT",
                    {"kind": "number-input", "prompt": "How many?", "correctValue": 3},
                    [{"when": "always", "nextStepId": "fix"}],
                    ["count-10"],
                ),
                step(
                    "fix",
                    "WORLD_CHANGE",
                    {
                        "kind": "world-change",
                        "text": "Fixed",
                        "payload": {
                            "locationSlug": "bay",
                            "changeType": "REPAIR",
                            "changeKey": "BRIDGE_FIXED",
                        },
                    },
                    [{"when": "always", "nextStepId": "done"}],
                ),
                step("done", "COMPLETE", {"kind": "complete", "text": "Done"}, []),
            ],
        },
        {
            "slug": "finale",
            "title": "Finale",
            "version": 1,
            "locationSlug": "bay",
            "ageBands": ["PATHFINDER"],
            "entryStepId": "end",
            "steps": [step("end", "COMPLETE", {"kind": "complete", "text": "End"}, [])],
        },
        {
            "slug": "plain",
            "title": "Plain",
            "version": 1,
            "locationSlug": "bay",
            "ageBands": ["PATHFINDER"],
            "entryStepId": "pick",
            "steps": [step("pick", "CHOICE", choice, [{"when": "always", "nextStepId": "complete"}])],
        },
    ]
    c["islands.json"]["islands"][0]["pack"]["adventureSlugs"] = ["bridge", "finale", "plain"]
    c["quests.json"]["quests"][0]["stages"][0]["objectives"][0]["adventureSlug"] = "bridge"

    def item(item_id, **extra):
        return {
            "id": item_id,
            "displayName": item_id.title(),
            "description": f"A {item_id}",
            "category": "COLLECTIBLE",
            "rarity": "COMMON",
            **extra,
        }

    c["rewards.json"] = {
        "collectibleSets": [
            {
                "id": "shells",
                "displayName": "Shells",
                "itemIds": ["shell-a", "shell-b"],
                "completionItemId": "hat",
                "completionMessage": "Every shell!",
            }
        ],
        "items": [
            item("shell-a", setId="shells"),
            item("shell-b", setId="shells", hidden=True),
            item("hat", category="COSMETIC"),
            item("hammer", category="KEEPSAKE"),
            item("medal", category="KEEPSAKE"),
            item("crown", category="KEEPSAKE"),
        ],
        "rewardRules": [
            {
                "id": "reward-bridge-fixed",
                "trigger": {"type": "WORLD_CHANGE", "changeKey": "BRIDGE_FIXED"},
                "itemIds": ["shell-a"],
                "message": "You found a shell under the bridge!",
            },
            {
                "id": "reward-bridge-done",
                "trigger": {"type": "ADVENTURE_COMPLETED", "templateSlug": "bridge"},
                "itemIds": ["hammer", "shell-b"],
                "message": "The bridge is repaired!",
            },
            {
                "id": "reward-finale",
                "trigger": {"type": "ADVENTURE_COMPLETED", "templateSlug": "finale"},
                "itemIds": ["medal"],
                "message": "A medal!",
            },
            {
                "id": "reward-elsewhere",
                "trigger": {"type": "ADVENTURE_COMPLETED", "templateSlug": "never-played"},
                "itemIds": ["crown"],
                "message": "A crown",
            },
        ],
    }
    return c


@pytest.fixture
def catalog(db, tmp_path):
    collections = reward_catalog()
    import_content(write_export(tmp_path / "v1", collections))
    return collections


def start(client, child, adventure="bridge"):
    response = client.post(
        f"/api/v1/children/{child.pk}/adventures/{adventure}/sessions/", {}, content_type="application/json"
    )
    assert response.status_code in (200, 201), response.content
    return response.json()["session"]["id"]


def answer(client, child, session_id, step_id, value, request_id=None):
    return client.post(
        f"/api/v1/children/{child.pk}/sessions/{session_id}/answers/",
        {"stepId": step_id, "answer": value, "requestId": str(request_id or uuid.uuid4())},
        content_type="application/json",
    )


def complete(client, child, session_id, adventure):
    return client.post(
        f"/api/v1/children/{child.pk}/adventures/{adventure}/sessions/{session_id}/complete/",
        {},
        content_type="application/json",
    )


def owned(child):
    return sorted(InventoryItem.objects.filter(child=child).values_list("item__item_id", flat=True))


def item_ids(items):
    return [item["itemId"] for item in items]


@pytest.mark.django_db
class TestGrantsFromGameplay:
    def test_an_ordinary_answer_earns_nothing(self, families, api, catalog):
        client, child = api(families.a), families.a1
        body = answer(client, child, start(client, child), "count", {"kind": "number-input", "value": 3}).json()

        assert body["rewards"] == {"grants": [], "newItems": []}
        assert owned(child) == [] and not GrantedRule.objects.exists()

    def test_the_world_change_step_earns_its_authored_reward(self, families, api, catalog):
        client, child = api(families.a), families.a1
        session_id = start(client, child)
        answer(client, child, session_id, "count", {"kind": "number-input", "value": 3})

        body = answer(client, child, session_id, "fix", {"kind": "world-change"}).json()

        # `fix` leads to the COMPLETE step, so the same answer also finishes the adventure.
        assert body["session"]["status"] == "COMPLETED"
        rules = [grant["ruleId"] for grant in body["rewards"]["grants"]]
        assert rules == ["reward-bridge-fixed", "reward-bridge-done"]
        assert all(grant["newlyGranted"] for grant in body["rewards"]["grants"])
        first = body["rewards"]["grants"][0]
        assert first["source"] == "WORLD_CHANGE"
        assert first["message"] == "You found a shell under the bridge!"
        assert item_ids(first["items"]) == ["shell-a"]
        assert set(first["items"][0]) == {"itemId", "displayName", "description", "category", "assetId"}
        # Both shells complete the set, so its cosmetic rides along in the same answer.
        assert item_ids(body["rewards"]["newItems"]) == ["shell-a", "hammer", "shell-b", "hat"]
        assert owned(child) == ["hammer", "hat", "shell-a", "shell-b"]
        assert "crown" not in owned(child)

    def test_finalising_a_session_earns_its_completion_reward_once(self, families, api, catalog):
        client, child = api(families.a), families.a1
        session_id = start(client, child, "finale")

        first = complete(client, child, session_id, "finale").json()
        again = complete(client, child, session_id, "finale").json()

        assert [g["ruleId"] for g in first["rewards"]["grants"]] == ["reward-finale"]
        assert first["rewards"]["grants"][0]["newlyGranted"] is True
        assert item_ids(first["rewards"]["newItems"]) == ["medal"]
        assert [g["newlyGranted"] for g in again["rewards"]["grants"]] == [False]
        assert again["rewards"]["newItems"] == []
        assert first["rewards"]["grants"][0]["grantId"] == again["rewards"]["grants"][0]["grantId"]
        assert owned(child) == ["medal"] and GrantedRule.objects.count() == 1

    def test_an_adventure_with_no_rule_finishes_with_no_reward(self, families, api, catalog):
        client, child = api(families.a), families.a1
        body = answer(client, child, start(client, child, "plain"), "pick", {"kind": "choice", "optionId": "b"}).json()
        assert body["session"]["status"] == "COMPLETED"
        assert body["rewards"] == {"grants": [], "newItems": []}

    def test_a_second_play_through_earns_nothing_new(self, families, api, catalog):
        client, child = api(families.a), families.a1
        for _ in range(2):
            session_id = start(client, child, "finale")
            body = complete(client, child, session_id, "finale").json()

        assert body["rewards"] == {"grants": [], "newItems": []}  # not this event's reward
        assert AdventureSession.objects.filter(status=SessionStatus.COMPLETED).count() == 2
        assert owned(child) == ["medal"] and GrantedRule.objects.count() == 1

    def test_each_child_earns_their_own(self, families, api, catalog):
        client = api(families.a)
        complete(client, families.a1, start(client, families.a1, "finale"), "finale")
        body = complete(client, families.a2, start(client, families.a2, "finale"), "finale").json()

        assert body["rewards"]["grants"][0]["newlyGranted"] is True
        assert owned(families.a1) == owned(families.a2) == ["medal"]

    def test_a_retired_rule_grants_nothing(self, families, api, catalog, tmp_path):
        newer = copy.deepcopy(catalog)
        newer["rewards.json"]["rewardRules"] = [
            r for r in newer["rewards.json"]["rewardRules"] if r["id"] != "reward-finale"
        ]
        import_content(write_export(tmp_path / "v2", newer))
        client, child = api(families.a), families.a1

        body = complete(client, child, start(client, child, "finale"), "finale").json()

        assert body["rewards"] == {"grants": [], "newItems": []} and owned(child) == []

    def test_mastery_still_moves_alongside_rewards(self, families, api, catalog):
        client, child = api(families.a), families.a1
        session_id = start(client, child)
        answer(client, child, session_id, "count", {"kind": "number-input", "value": 3})
        answer(client, child, session_id, "fix", {"kind": "world-change"})

        assert SkillProgress.objects.get(child=child, learning_objective_code="count-10").exposure_count == 1


@pytest.mark.django_db
class TestOnce:
    def test_a_replayed_answer_reports_what_it_granted_without_granting_again(
        self, families, api, catalog
    ):
        client, child = api(families.a), families.a1
        session_id = start(client, child)
        answer(client, child, session_id, "count", {"kind": "number-input", "value": 3})
        request_id = uuid.uuid4()

        first = answer(client, child, session_id, "fix", {"kind": "world-change"}, request_id).json()
        again = answer(client, child, session_id, "fix", {"kind": "world-change"}, request_id).json()

        assert again["replayed"] is True
        assert [g["ruleId"] for g in again["rewards"]["grants"]] == [
            g["ruleId"] for g in first["rewards"]["grants"]
        ]
        assert not any(g["newlyGranted"] for g in again["rewards"]["grants"])
        assert again["rewards"]["newItems"] == []
        assert GrantedRule.objects.count() == 2 and len(owned(child)) == 4

    def test_a_failed_grant_rolls_the_whole_answer_back(self, families, api, catalog, monkeypatch):
        from apps.inventory import services as inventory

        def boom(*args, **kwargs):
            raise RuntimeError("database went away")

        client, child = api(families.a), families.a1
        session_id = start(client, child)
        answer(client, child, session_id, "count", {"kind": "number-input", "value": 3})
        monkeypatch.setattr(inventory, "grant_reward_rule", boom)

        response = answer(client, child, session_id, "fix", {"kind": "world-change"})

        assert response.status_code == 500
        session = AdventureSession.objects.get(pk=session_id)
        assert (session.current_step_id, session.status) == ("fix", SessionStatus.ACTIVE)
        assert owned(child) == [] and not GrantedRule.objects.exists()

    def test_a_failed_completion_grant_leaves_the_session_open(
        self, families, api, catalog, monkeypatch
    ):
        from apps.inventory import services as inventory

        monkeypatch.setattr(inventory, "grant_reward_rule", lambda *a, **k: (_ for _ in ()).throw(RuntimeError()))
        client, child = api(families.a), families.a1
        session_id = start(client, child, "finale")

        assert complete(client, child, session_id, "finale").status_code == 500
        assert AdventureSession.objects.get(pk=session_id).status == SessionStatus.ACTIVE


@pytest.mark.django_db(transaction=True)
def test_concurrent_completions_grant_once(families, api, catalog, token_for):
    session_id = start(api(families.a), families.a1, "finale")
    token = token_for(families.a.cognito_sub)
    barrier = threading.Barrier(3)
    bodies = []

    def run():
        client = Client()
        client.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        try:
            barrier.wait()
            response = complete(client, families.a1, session_id, "finale")
            bodies.append((response.status_code, response.json()))
        finally:
            connection.close()

    threads = [threading.Thread(target=run) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert [status for status, _ in bodies] == [200, 200, 200]
    newly = [g for _, body in bodies for g in body["rewards"]["grants"] if g["newlyGranted"]]
    assert len(newly) == 1
    assert GrantedRule.objects.count() == 1 and owned(families.a1) == ["medal"]


@pytest.mark.django_db
class TestReads:
    def test_inventory_and_reward_history_show_what_was_earned(self, families, api, catalog):
        client, child = api(families.a), families.a1
        complete(client, child, start(client, child, "finale"), "finale")

        inventory = client.get(f"/api/v1/children/{child.pk}/inventory/").json()
        history = client.get(f"/api/v1/children/{child.pk}/rewards/").json()

        assert item_ids(entry["item"] for entry in inventory["items"]) == ["medal"]
        [grant] = history["rewards"]
        assert (grant["ruleId"], grant["source"], grant["message"]) == (
            "reward-finale",
            "ADVENTURE_COMPLETED",
            "A medal!",
        )
        assert "newlyGranted" not in grant and grant["sourceSessionId"]
        detail = client.get(f"/api/v1/children/{child.pk}/rewards/{grant['grantId']}/")
        assert detail.json() == grant

    def test_another_family_and_a_sibling_see_nothing(self, families, api, catalog):
        client, child = api(families.a), families.a1
        complete(client, child, start(client, child, "finale"), "finale")
        grant_id = GrantedRule.objects.get().pk

        other = api(families.b)
        assert other.get(f"/api/v1/children/{child.pk}/inventory/").status_code == 404
        assert other.get(f"/api/v1/children/{child.pk}/rewards/").status_code == 404
        assert other.get(f"/api/v1/children/{families.b1.pk}/rewards/{grant_id}/").status_code == 404
        assert client.get(f"/api/v1/children/{families.a2.pk}/rewards/{grant_id}/").status_code == 404
        assert client.get(f"/api/v1/children/{families.a2.pk}/rewards/").json() == {"rewards": []}
        assert Client().get(f"/api/v1/children/{child.pk}/rewards/").status_code == 401

    @pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
    def test_rewards_and_inventory_cannot_be_written(self, families, api, catalog, method):
        client, child = api(families.a), families.a1
        forged = {"itemId": "crown", "ruleId": "reward-elsewhere", "quantity": 99}
        for url in (
            f"/api/v1/children/{child.pk}/inventory/",
            f"/api/v1/children/{child.pk}/rewards/",
        ):
            response = getattr(client, method)(url, forged, content_type="application/json")
            assert response.status_code == 405
        assert owned(child) == [] and not GrantedRule.objects.exists()

    def test_a_forged_reward_field_on_an_answer_is_refused(self, families, api, catalog):
        client, child = api(families.a), families.a1
        session_id = start(client, child)
        response = client.post(
            f"/api/v1/children/{child.pk}/sessions/{session_id}/answers/",
            {
                "stepId": "count",
                "answer": {"kind": "number-input", "value": 3},
                "requestId": str(uuid.uuid4()),
                "rewards": [{"itemId": "crown"}],
                "itemIds": ["crown"],
            },
            content_type="application/json",
        )
        assert response.status_code == 200  # extra fields carry no meaning to the server
        assert "crown" not in owned(child) and not GrantedRule.objects.exists()
