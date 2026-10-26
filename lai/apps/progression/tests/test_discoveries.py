"""Server-side discoveries (LAI-0605).

Through HTTP with a verified Cognito token and PostgreSQL. The rules are the golden-vector port
(`tests/golden/test_discovery_python.py`); these tests pin what the server records and gives,
once, and who can see it.
"""

import copy

import pytest
from django.test import Client

from apps.catalog.importer import DEFAULT_EXPORT_DIR, import_content
from apps.catalog.models import DiscoveryDefinition
from apps.catalog.tests.helpers import base_collections, write_export
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import WorldChange, WorldState
from apps.quests.models import QuestProgress, QuestStatus

pytestmark = [pytest.mark.postgres]


def discovery(discovery_id, requirements, **extra):
    return {
        "id": discovery_id,
        "kind": "HIDDEN_OBJECT",
        "locationSlug": "bay",
        "title": discovery_id.title(),
        "revealMessage": f"You found the {discovery_id}.",
        "lockedMessage": f"The {discovery_id} is out of reach.",
        "requirements": requirements,
        **extra,
    }


def discovery_catalog():
    c = base_collections()
    c["discoveries.json"] = {
        "checkpoints": [],
        "discoveries": [
            discovery(
                "pool",
                [{"type": "ALWAYS"}],
                startsQuestId="secrets",
                worldChange={"locationSlug": "bay", "changeType": "REVEAL", "changeKey": "POOL_FOUND"},
            ),
            discovery(
                "cave",
                [
                    {"type": "DISCOVERY_PRESENT", "discoveryId": "pool"},
                    {"type": "ITEM_OWNED", "itemId": "shell"},
                ],
            ),
        ],
    }
    c["quests.json"]["quests"] = [
        {
            "id": "secrets",
            "title": "Secrets",
            "summary": "Find the secrets",
            "giverNpcId": None,
            "ageBands": ["PATHFINDER"],
            "prerequisites": [],
            "entryStageId": "find",
            "stages": [
                {
                    "id": "find",
                    "title": "Find them",
                    "objectives": [
                        {"id": "pool", "label": "Pool", "kind": "DISCOVER", "discoveryKey": "pool"},
                        {"id": "cave", "label": "Cave", "kind": "DISCOVER", "discoveryKey": "cave"},
                    ],
                }
            ],
            "completion": {"journalNote": "Found them all"},
        }
    ]
    c["rewards.json"] = {
        "collectibleSets": [],
        "items": [
            {"id": "shell", "displayName": "Shell", "description": "A shell", "category": "COLLECTIBLE", "rarity": "COMMON"},
            {"id": "crystal", "displayName": "Crystal", "description": "A crystal", "category": "COLLECTIBLE", "rarity": "RARE"},
        ],
        "rewardRules": [
            {
                "id": "reward-pool",
                "trigger": {"type": "DISCOVERY", "discoveryKey": "pool"},
                "itemIds": ["shell"],
                "message": "A shell in the pool!",
            },
            {
                "id": "reward-cave",
                "trigger": {"type": "DISCOVERY", "discoveryKey": "cave"},
                "itemIds": ["crystal"],
                "message": "A crystal!",
            },
        ],
    }
    return c


@pytest.fixture
def catalog(db, tmp_path):
    collections = discovery_catalog()
    import_content(write_export(tmp_path / "v1", collections))
    return collections


def find(client, child, discovery_id):
    return client.post(
        f"/api/v1/children/{child.pk}/discoveries/{discovery_id}/", {}, content_type="application/json"
    )


def found(child):
    state = WorldState.objects.filter(child=child).first()
    return list(state.discovered_objects) if state else []


@pytest.mark.django_db
class TestFinding:
    def test_finding_a_secret_applies_everything_it_owes(self, families, api, catalog):
        client, child = api(families.a), families.a1

        body = find(client, child, "pool").json()

        assert (body["status"], body["message"]) == ("FOUND_NOW", "You found the pool.")
        assert found(child) == ["pool"]
        change = WorldChange.objects.get(child=child, change_key="POOL_FOUND")
        assert change.source_session_id == "discovery:pool"
        assert body["worldChangeKey"] == "POOL_FOUND"
        assert [g["ruleId"] for g in body["rewards"]["grants"]] == ["reward-pool"]
        assert body["startedQuestId"] == "secrets"
        [update] = body["questUpdates"]
        assert update["newlyCompletedObjectiveIds"] == ["pool"]
        assert QuestProgress.objects.get(child=child).status == QuestStatus.ACTIVE

    def test_a_second_visit_reads_the_same_and_changes_nothing(self, families, api, catalog):
        client, child = api(families.a), families.a1
        find(client, child, "pool")

        body = find(client, child, "pool").json()

        assert (body["status"], body["message"]) == ("ALREADY_FOUND", "You found the pool.")
        assert body["rewards"] == {"grants": [], "newItems": []} and body["startedQuestId"] is None
        assert found(child) == ["pool"]
        assert GrantedRule.objects.filter(child=child).count() == 1

    def test_a_locked_secret_writes_and_grants_nothing(self, families, api, catalog):
        client, child = api(families.a), families.a1

        body = find(client, child, "cave").json()

        assert (body["status"], body["message"]) == ("LOCKED", "The cave is out of reach.")
        assert found(child) == [] and not GrantedRule.objects.exists()

    def test_requirements_are_checked_against_server_records(self, families, api, catalog):
        client, child = api(families.a), families.a1
        find(client, child, "pool")  # finds the pool and earns the shell

        body = find(client, child, "cave").json()

        assert body["status"] == "FOUND_NOW"
        assert found(child) == ["pool", "cave"]
        [update] = body["questUpdates"]
        assert (update["status"], update["justCompleted"]) == ("COMPLETED", True)
        assert sorted(InventoryItem.objects.filter(child=child).values_list("item__item_id", flat=True)) == [
            "crystal",
            "shell",
        ]

    def test_an_unknown_inactive_or_retired_discovery_is_not_found(
        self, families, api, catalog, tmp_path
    ):
        client, child = api(families.a), families.a1
        assert find(client, child, "nowhere").status_code == 404
        DiscoveryDefinition.objects.filter(discovery_id="cave").update(active=False)
        assert find(client, child, "cave").status_code == 404

        newer = copy.deepcopy(catalog)
        newer["discoveries.json"]["discoveries"] = newer["discoveries.json"]["discoveries"][1:]
        import_content(write_export(tmp_path / "v2", newer))
        assert find(client, child, "pool").status_code == 404
        assert found(child) == []

    def test_a_body_is_refused(self, families, api, catalog):
        client, child = api(families.a), families.a1
        response = client.post(
            f"/api/v1/children/{child.pk}/discoveries/cave/",
            {"status": "FOUND_NOW", "discoveredIds": ["cave"]},
            content_type="application/json",
        )
        assert response.status_code == 400 and found(child) == []

    def test_a_failed_reward_rolls_the_find_back(self, families, api, catalog, monkeypatch):
        from apps.progression import discoveries

        def boom(*args, **kwargs):
            raise RuntimeError("database went away")

        monkeypatch.setattr(discoveries.inventory, "grant_for_trigger", boom)
        client, child = api(families.a), families.a1

        assert find(client, child, "pool").status_code == 500
        assert found(child) == [] and not WorldChange.objects.exists()
        assert not QuestProgress.objects.exists()


@pytest.mark.django_db
class TestReads:
    def test_lists_only_found_secrets_and_progress_carries_them(self, families, api, catalog):
        client, child = api(families.a), families.a1
        assert client.get(f"/api/v1/children/{child.pk}/discoveries/").json() == {"discoveries": []}
        find(client, child, "pool")

        body = client.get(f"/api/v1/children/{child.pk}/discoveries/").json()
        progress = client.get(f"/api/v1/children/{child.pk}/progress/").json()

        assert body == {
            "discoveries": [
                {"discoveryId": "pool", "title": "Pool", "kind": "HIDDEN_OBJECT", "locationSlug": "bay"}
            ]
        }
        assert progress["discoveredIds"] == ["pool"]
        assert "POOL_FOUND" in [c["changeKey"] for c in progress["worldChanges"]]

    def test_another_family_cannot_read_or_find(self, families, api, catalog):
        find(api(families.a), families.a1, "pool")
        other = api(families.b)
        assert other.get(f"/api/v1/children/{families.a1.pk}/discoveries/").status_code == 404
        assert find(other, families.a1, "cave").status_code == 404
        assert Client().post(f"/api/v1/children/{families.a1.pk}/discoveries/pool/").status_code == 401
        assert found(families.a2) == []


@pytest.mark.django_db
def test_the_real_export_imports_every_authored_discovery(families, api):
    import_content(DEFAULT_EXPORT_DIR)
    assert DiscoveryDefinition.objects.count() == 6
    pool = DiscoveryDefinition.objects.get(discovery_id="harbor-tide-pool")
    assert (pool.location_slug, pool.starts_quest_slug) == ("welcome-harbor", "the-quiet-places")
