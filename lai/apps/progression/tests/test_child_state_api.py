"""World changes, world state, story progress and NPC relationships outside region play (AMP-03).

The real content export (stories, NPCs, adventures) and the two synthetic families. Every route
is child-scoped: another family's child is a 404 and nothing is written for it.
"""

import pytest

from apps.catalog.importer import import_content
from apps.catalog.models import Adventure
from apps.education.models import SkillEvidence, SkillProgress
from apps.game_sessions import services as sessions
from apps.progression import stories
from apps.progression.models import NpcRelationship, StoryProgress, WorldChange, WorldState

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

STORY = "dragon-of-ember-mountain"  # Pathfinder only; chapter 1 embeds one adventure


@pytest.fixture
def content(families):
    import_content()
    stories.definitions.cache_clear()
    return families


def url(child, rest: str) -> str:
    return f"/api/v1/children/{child.pk}/{rest}"


def post(client, path, body=None):
    return client.post(path, body or {}, "application/json")


def complete_adventure(child, slug):
    session, _ = sessions.start_or_resume_session(child, Adventure.objects.get(slug=slug))
    sessions.complete_session(child, session.pk)


# --- world changes ----------------------------------------------------------------------------


def change(key="TIDE_GATE_OPEN", **extra):
    return {"locationSlug": "lantern-tide-pools", "changeType": "UNLOCK", "changeKey": key, **extra}


def test_a_world_change_is_recorded_once(families, api):
    client = api(families.a)
    first = post(client, url(families.a1, "world-changes/"), change(sourceSessionId="quest:x"))
    assert first.status_code == 201
    again = post(client, url(families.a1, "world-changes/"), change())
    assert again.status_code == 200
    assert again.json()["id"] == first.json()["id"]
    listed = client.get(url(families.a1, "world-changes/")).json()["worldChanges"]
    assert [c["changeKey"] for c in listed] == ["TIDE_GATE_OPEN"]
    assert listed[0]["sourceSessionId"] == "quest:x"
    assert client.get(url(families.a2, "world-changes/")).json() == {"worldChanges": []}


@pytest.mark.parametrize(
    "body",
    [
        change(changeType="unlock"),
        change(key="has spaces"),
        change(sourceSessionId="anything goes"),
        {**change(), "payload": {"x": 1}},
        {"changeKey": "X"},
    ],
)
def test_malformed_world_changes_are_refused(families, api, body):
    response = post(api(families.a), url(families.a1, "world-changes/"), body)
    assert response.status_code == 400
    assert not WorldChange.objects.exists()


def test_a_world_change_cannot_name_another_familys_session(content, api):
    session, _ = sessions.start_or_resume_session(
        content.b1, Adventure.objects.get(slug="the-dark-lighthouse-counting")
    )
    response = post(
        api(content.a), url(content.a1, "world-changes/"), change(sourceSessionId=str(session.pk))
    )
    assert response.status_code == 404
    assert not WorldChange.objects.exists()


def test_another_familys_child_world_changes_are_not_found(families, api):
    client = api(families.a)
    assert post(client, url(families.b1, "world-changes/"), change()).status_code == 404
    assert client.get(url(families.b1, "world-changes/")).status_code == 404
    assert not WorldChange.objects.exists()


# --- world state ------------------------------------------------------------------------------


def test_world_state_records_characters_met_and_the_checkpoint(content, api):
    client = api(content.a)
    path = url(content.a1, "world-state/")
    assert client.get(path).json() == {
        "discoveredIds": [],
        "metCharacterIds": [],
        "lastCheckpointId": None,
    }
    client.patch(path, {"metCharacterId": "pirate-pip"}, "application/json")
    client.patch(path, {"metCharacterId": "pirate-pip"}, "application/json")
    body = client.patch(
        path, {"lastCheckpointId": "welcome-harbor:dock"}, "application/json"
    ).json()
    assert body["metCharacterIds"] == ["pirate-pip"]
    assert body["lastCheckpointId"] == "welcome-harbor:dock"
    unknown = client.patch(path, {"metCharacterId": "nobody-at-all"}, "application/json")
    assert unknown.status_code == 400
    refused = client.patch(path, {"discoveredIds": ["x"]}, "application/json")
    assert refused.status_code == 400
    assert client.delete(path).status_code == 204
    assert not WorldState.objects.filter(child=content.a1).exists()


def test_another_familys_world_state_is_not_found(content, api):
    client = api(content.a)
    path = url(content.b1, "world-state/")
    assert (
        client.patch(path, {"metCharacterId": "pirate-pip"}, "application/json").status_code == 404
    )
    assert client.delete(path).status_code == 404
    assert not WorldState.objects.exists()


# --- stories ----------------------------------------------------------------------------------


def test_a_story_starts_once_at_its_entry_chapter(content, api):
    client = api(content.a)
    first = post(client, url(content.a1, f"stories/{STORY}/start/"))
    assert first.status_code == 201
    assert first.json()["currentChapterId"] == "broken-path"
    assert post(client, url(content.a1, f"stories/{STORY}/start/")).status_code == 200
    listed = client.get(url(content.a1, "stories/")).json()["stories"]
    assert [s["storyId"] for s in listed] == [STORY]


def test_a_story_for_another_age_band_does_not_start(content, api):
    response = post(api(content.a), url(content.a1, "stories/the-castles-secret-door/start/"))
    assert response.status_code == 409
    assert not StoryProgress.objects.exists()


def test_a_chapter_finishes_only_after_its_adventure_and_only_once(content, api):
    client = api(content.a)
    post(client, url(content.a1, f"stories/{STORY}/start/"))
    path = url(content.a1, f"stories/{STORY}/chapters/broken-path/complete/")
    blocked = post(client, path)
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "chapter_not_finished"

    complete_adventure(content.a1, "dragon-chapter-1-broken-path")
    done = post(client, path).json()
    assert done["currentChapterId"] == "whispering-forest"
    assert done["completedChapterIds"] == ["broken-path"]
    assert post(client, path).json() == done  # a replay changes nothing
    skipped = post(client, url(content.a1, f"stories/{STORY}/chapters/dragons-cave/complete/"))
    assert skipped.json()["error"]["code"] == "chapter_not_current"


def test_finishing_the_last_chapter_completes_the_story_and_its_world_change(content, api):
    client = api(content.a)
    post(client, url(content.a1, f"stories/{STORY}/start/"))
    story = stories.definition(STORY)
    for chapter in story["chapters"]:
        for scene in chapter["scenes"]:
            if scene["kind"] == "ADVENTURE":
                complete_adventure(content.a1, scene["templateSlug"])
        body = post(client, url(content.a1, f"stories/{STORY}/chapters/{chapter['id']}/complete/"))
        assert body.status_code == 200, chapter["id"]
    assert body.json()["completedAt"] is not None
    expected = story["completionWorldChange"]
    recorded = WorldChange.objects.get(child=content.a1, change_key=expected["changeKey"])
    assert recorded.source_session_id.startswith("story:")


def test_flags_take_only_authored_choices(content, api):
    client = api(content.a)
    post(client, url(content.a1, f"stories/{STORY}/start/"))
    path = url(content.a1, f"stories/{STORY}/flags/")
    ok = post(client, path, {"flagKey": "trackDirection", "flagValue": "cave"})
    assert ok.json()["storyFlags"] == {"trackDirection": "cave"}
    assert post(client, path, {"flagKey": "trackDirection", "flagValue": "x"}).status_code == 400
    assert post(client, path, {"flagKey": "free", "flagValue": "text"}).status_code == 400


def test_reflection_evidence_counts_once(content, api):
    client = api(content.a)
    post(client, url(content.a1, f"stories/{STORY}/start/"))
    path = url(content.a1, f"stories/{STORY}/reflections/")
    assert post(client, path, {"sceneId": "dragon-empathy"}).json() == {"recorded": 1}
    assert post(client, path, {"sceneId": "dragon-empathy"}).json() == {"recorded": 0}
    assert SkillEvidence.objects.filter(child=content.a1, evidence_type="REFLECTION").count() == 1
    assert (
        SkillProgress.objects.get(
            child=content.a1, learning_objective_code="empathy"
        ).exposure_count
        == 1
    )
    assert post(client, path, {"sceneId": "chatty-arrives"}).status_code == 400


def test_another_familys_story_is_not_found_and_unwritten(content, api):
    client = api(content.a)
    assert post(client, url(content.b1, f"stories/{STORY}/start/")).status_code == 404
    assert client.get(url(content.b1, "stories/")).status_code == 404
    assert not StoryProgress.objects.exists()


# --- NPCs -------------------------------------------------------------------------------------


def talk(client, child, node, npc="pirate-pip"):
    return post(client, url(child, f"npcs/{npc}/dialogue/"), {"nodeId": node})


def test_dialogue_awards_points_once_and_sets_authored_flags(content, api):
    client = api(content.a)
    first = talk(client, content.a1, "pip-greeting").json()
    assert first["npc"]["relationshipPoints"] == 1
    assert first["npc"]["memoryFlags"] == {"metPip": True}
    assert first["npc"]["relationshipLevel"] == "STRANGER"
    again = talk(client, content.a1, "pip-greeting").json()
    assert again["npc"]["relationshipPoints"] == 1
    story = talk(client, content.a1, "pip-bridge-story").json()
    assert story["npc"]["relationshipPoints"] == 2
    assert story["levelIncreased"] is True
    assert story["npc"]["relationshipLevel"] == "ACQUAINTANCE"
    listed = client.get(url(content.a1, "npcs/")).json()["npcs"]
    assert [n["npcId"] for n in listed] == ["pirate-pip"]
    assert listed[0]["seenNodeIds"] == ["pip-greeting", "pip-bridge-story"]


def test_unknown_npcs_and_nodes_are_refused(content, api):
    client = api(content.a)
    assert talk(client, content.a1, "pip-greeting", npc="nobody").status_code == 404
    assert talk(client, content.a1, "not-a-node").status_code == 400
    refused = post(
        client,
        url(content.a1, "npcs/pirate-pip/dialogue/"),
        {"nodeId": "pip-greeting", "points": 50},
    )
    assert refused.status_code == 400
    assert not NpcRelationship.objects.exists()


def test_npc_memory_is_cleared_by_the_parent_only_for_their_child(content, api):
    talk(api(content.a), content.a1, "pip-greeting")
    talk(api(content.b), content.b1, "pip-greeting")
    assert api(content.a).delete(url(content.b1, "npcs/")).status_code == 404
    assert api(content.a).delete(url(content.a1, "npcs/")).status_code == 204
    assert not NpcRelationship.objects.filter(child=content.a1).exists()
    assert NpcRelationship.objects.filter(child=content.b1).exists()
