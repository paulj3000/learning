"""LAI-0503: published content reads. No answers, no drafts, band-filtered, revision ids, scoped."""

import copy
import json

import pytest

from apps.adventures.public import public_presentation, public_step
from apps.catalog import authoring
from apps.catalog.importer import import_content
from apps.catalog.models import Adventure, AdventureStep, ItemDefinition, Quest
from apps.catalog.tests.helpers import publish_edit, staff_user, write_export
from apps.catalog.tests.test_authoring import collections_with_npc
from apps.catalog.tests.test_story_catalog import story_record

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def collections():
    data = collections_with_npc()
    data["stories.json"] = {"stories": [story_record(supportedAgeBands=["PATHFINDER"])]}
    data["islands.json"]["islands"][0]["supportedAgeBands"] = ["SPROUT", "PATHFINDER", "EXPLORER"]
    return data


@pytest.fixture
def content(tmp_path):
    import_content(write_export(tmp_path / "v1", collections()))


@pytest.fixture
def a(content, families, api):
    return api(families.a), families.a1  # Pathfinder


def base(child) -> str:
    return f"/api/v1/children/{child.pk}/content/"


# --- the pure redaction -------------------------------------------------------------------------


class TestAnswersNeverLeave:
    def test_number_choice_and_short_response_lose_their_answers(self):
        assert "correctValue" not in public_presentation(
            {"kind": "number-input", "prompt": "?", "correctValue": 3}, "s"
        )
        assert "correctOptionId" not in public_presentation(
            {"kind": "choice", "prompt": "?", "options": [], "correctOptionId": "a"}, "s"
        )
        shown = public_presentation(
            {"kind": "short-response", "prompt": "?", "options": [], "acceptedOptionIds": ["a"]},
            "s",
        )
        assert "acceptedOptionIds" not in shown

    def test_ordering_never_serves_the_correct_order(self):
        items = [{"id": f"i{n}", "label": f"Item {n}"} for n in range(6)]
        presentation = {
            "kind": "ordering",
            "prompt": "Order",
            "items": items,
            "correctOrder": [i["id"] for i in items],
        }
        for seed in ("a", "b", "c", "d", "e", "f"):
            shown = public_presentation(presentation, seed)
            assert "correctOrder" not in shown
            assert [i["id"] for i in shown["items"]] != presentation["correctOrder"]
            assert sorted(i["id"] for i in shown["items"]) == sorted(presentation["correctOrder"])
        assert public_presentation(presentation, "a") == public_presentation(presentation, "a")

    def test_matching_separates_the_sides_without_the_pairing(self):
        presentation = {
            "kind": "matching",
            "prompt": "Match",
            "pairs": [{"leftId": "L1", "rightId": "R1"}, {"leftId": "L2", "rightId": "R2"}],
        }
        shown = public_presentation(presentation, "s")
        assert "pairs" not in shown
        assert [x["id"] for x in shown["left"]] == ["L1", "L2"]
        assert sorted(x["id"] for x in shown["right"]) == ["R1", "R2"]

    def test_a_step_serves_no_hints_no_transitions_no_fallback(self):
        step = {
            "id": "s1",
            "type": "CHOICE",
            "objectiveIds": ["o"],
            "presentation": {
                "kind": "choice",
                "prompt": "?",
                "options": [],
                "correctOptionId": "a",
            },
            "hintPolicy": {"ladder": ["The answer is a."]},
            "transitions": [{"when": "correct", "nextStepId": "win"}],
            "fallback": {"text": "x"},
        }
        shown = public_step(step)
        assert set(shown) == {"id", "type", "objectiveIds", "presentation", "hasHints"}
        assert shown["hasHints"] is True
        assert "answer" not in json.dumps(shown).lower().replace("answers", "")


# --- the routes ---------------------------------------------------------------------------------


def test_the_adventure_read_carries_steps_without_answers_and_revision_ids(a):
    client, child = a
    listing = client.get(f"{base(child)}adventures/").json()["adventures"]
    assert [x["slug"] for x in listing] == ["fix-bridge"]  # the other adventure is Sprouts only

    detail = client.get(f"{base(child)}adventures/fix-bridge/").json()
    assert detail["entryStepId"] == "count" and [s["id"] for s in detail["steps"]] == [
        "count",
        "done",
    ]
    raw = json.dumps(detail)
    assert "correctValue" not in raw and "transitions" not in raw and "fallback" not in raw

    adventure = Adventure.objects.get(slug="fix-bridge")
    assert detail["revision"] == {
        "id": str(adventure.published_revision_id),
        "number": adventure.published_revision.number,
    }
    step = AdventureStep.objects.get(adventure=adventure, step_id="count")
    assert detail["steps"][0]["revision"]["id"] == str(step.published_revision_id)


def test_content_for_another_age_band_looks_absent(a):
    client, child = a
    assert client.get(f"{base(child)}adventures/tale/").status_code == 404  # Sprouts only
    assert client.get(f"{base(child)}adventures/no-such/").status_code == 404


def test_a_draft_or_submitted_version_is_never_visible(a):
    client, child = a
    adventure = Adventure.objects.get(slug="fix-bridge")
    staff = staff_user()
    body = copy.deepcopy(authoring.current_body(adventure))
    body["title"] = "Secret Draft Title"
    draft = authoring.create_draft(adventure, body, user=staff)
    assert (
        "Secret Draft Title"
        not in client.get(f"{base(child)}adventures/fix-bridge/").content.decode()
    )
    authoring.submit(draft, user=staff)
    assert "Secret Draft Title" not in client.get(f"{base(child)}adventures/").content.decode()

    authoring.publish(draft, user=staff)
    page = client.get(f"{base(child)}adventures/fix-bridge/").json()
    assert page["title"] == "Secret Draft Title" and page["revision"]["number"] == 2


def test_a_row_without_a_published_version_is_absent(a):
    client, child = a
    Adventure.objects.filter(slug="fix-bridge").update(published_revision=None)
    assert client.get(f"{base(child)}adventures/").json() == {"adventures": []}
    assert client.get(f"{base(child)}adventures/fix-bridge/").status_code == 404


def test_inactive_content_is_hidden(a):
    client, child = a
    Adventure.objects.filter(slug="fix-bridge").update(active=False)
    assert client.get(f"{base(child)}adventures/fix-bridge/").status_code == 404
    Quest.objects.filter(slug="repair").update(active=False)
    assert client.get(f"{base(child)}quests/").json() == {"quests": []}


def test_quests_stories_npcs_and_objectives_are_served_with_revisions(a):
    client, child = a
    quest = client.get(f"{base(child)}quests/repair/").json()
    assert quest["entryStageId"] == "s1" and quest["adventureSlugs"] == ["fix-bridge"]
    assert quest["revision"]["number"] == 1

    story = client.get(f"{base(child)}stories/bridge-tale/").json()
    assert story["entryChapterId"] == "start" and story["adventureSlugs"] == ["fix-bridge"]
    assert story["chapters"][0]["scenes"][1] == {
        "id": "fix",
        "kind": "ADVENTURE",
        "templateSlug": "fix-bridge",
    }
    assert "completionWorldChange" not in json.dumps(story)
    assert [s["slug"] for s in client.get(f"{base(child)}stories/").json()["stories"]] == [
        "bridge-tale"
    ]

    npc = client.get(f"{base(child)}npcs/pip/").json()
    assert npc["id"] == "pip" and npc["dialogue"] == [] and npc["revision"]["id"]
    assert [n["id"] for n in client.get(f"{base(child)}npcs/").json()["npcs"]] == ["pip"]
    assert client.get(f"{base(child)}learning-objectives/").json() == {"learningObjectives": []}


def test_the_npc_read_serves_only_the_childs_band(content, families, api):
    from apps.catalog.models import NpcDefinition

    pip = NpcDefinition.objects.get(npc_id="pip")
    body = copy.deepcopy(authoring.current_body(pip))
    body["dialogue"] = [
        {
            "id": "small",
            "text": "Hi little one",
            "choices": [],
            "conditions": [],
            "ageBands": ["SPROUT"],
        },
        {
            "id": "big",
            "text": "Hello reader",
            "choices": [],
            "conditions": [],
            "ageBands": ["PATHFINDER", "EXPLORER"],
        },
        {"id": "all", "text": "Ahoy", "choices": [], "conditions": []},
    ]
    publish_edit(pip, body)
    client, child = api(families.a), families.a1
    nodes = client.get(f"{base(child)}npcs/pip/").json()["dialogue"]
    assert [n["nodeId"] for n in nodes] == ["big", "all"]


def test_items_and_reward_rules_hide_hidden_items(a):
    from apps.catalog.models import ContentRelease, RewardRule

    release = ContentRelease.objects.get()
    rev_source = {
        "id": "x",
        "displayName": "X",
        "description": "d",
        "category": "COLLECTIBLE",
        "rarity": "COMMON",
    }
    shown = ItemDefinition.objects.create(
        item_id="shell",
        display_name="Shell",
        description="A shell",
        category="COLLECTIBLE",
        rarity="COMMON",
        hidden=False,
        source={**rev_source, "id": "shell"},
        last_seen_release=release,
    )
    secret = ItemDefinition.objects.create(
        item_id="secret",
        display_name="Secret",
        description="Shh",
        category="KEEPSAKE",
        rarity="RARE",
        hidden=True,
        source={**rev_source, "id": "secret"},
        last_seen_release=release,
    )
    for item in (shown, secret):
        authoring.record_published(item, item.source, origin="SEED")
    rule_shown = RewardRule.objects.create(
        rule_id="r1",
        message="Nice",
        trigger={"type": "QUEST_COMPLETED"},
        source={"id": "r1", "trigger": {"type": "QUEST_COMPLETED"}},
        last_seen_release=release,
    )
    rule_secret = RewardRule.objects.create(
        rule_id="r2",
        message="Surprise",
        trigger={"type": "QUEST_COMPLETED"},
        source={"id": "r2", "trigger": {"type": "QUEST_COMPLETED"}},
        last_seen_release=release,
    )
    rule_shown.items.set([shown])
    rule_secret.items.set([secret])
    for rule in (rule_shown, rule_secret):
        authoring.record_published(rule, rule.source, origin="SEED")

    client, child = a
    assert [i["id"] for i in client.get(f"{base(child)}items/").json()["items"]] == ["shell"]
    rules = client.get(f"{base(child)}reward-rules/").json()["rewardRules"]
    assert [r["id"] for r in rules] == ["r1"] and rules[0]["triggerType"] == "QUEST_COMPLETED"


class TestAuthorization:
    URLS = (
        "adventures/",
        "adventures/fix-bridge/",
        "quests/",
        "quests/repair/",
        "items/",
        "reward-rules/",
        "learning-objectives/",
        "stories/",
        "stories/bridge-tale/",
        "npcs/",
        "npcs/pip/",
    )

    def test_a_stranger_gets_nothing_and_cannot_tell_a_real_child_from_a_fake_one(
        self, content, families, api
    ):
        stranger = api(families.b)
        for url in self.URLS:
            assert stranger.get(base(families.a1) + url).status_code == 404, url

    def test_no_token_is_unauthorized(self, content, families, api):
        anonymous = api()
        for url in self.URLS:
            assert anonymous.get(base(families.a1) + url).status_code in (401, 403), url

    def test_every_route_is_read_only(self, a):
        client, child = a
        for url in self.URLS:
            for method in (client.post, client.put, client.patch, client.delete):
                assert method(base(child) + url).status_code in (404, 405), url
