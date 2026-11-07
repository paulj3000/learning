"""Server-owned NPC narration context (LAI-0709): published, child-scoped, pinned, eligible."""

import json

import pytest
from django.utils import timezone

from apps.ai.services import npc as npc_context
from apps.ai.services.context import ContextNotFound, load_npc_narration
from apps.catalog.models import NpcDefinition
from apps.progression.models import NpcRelationship

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

PIP = {
    "intent": "NARRATE",
    "contextSource": "DJANGO_CATALOG",
    "npcId": "pirate-pip",
    "nodeId": "pip-bridge-thanks",
}


@pytest.fixture
def real_catalog(db):
    from apps.catalog.importer import import_content

    import_content()


def post(api, parent, child, body):
    return api(parent).post(
        f"/api/v1/children/{child.pk}/ai/companion-turns/",
        json.dumps(body),
        content_type="application/json",
    )


def trusted(fake):
    text = fake.requests[0].content[0].text
    return json.loads(text.split("\n", 1)[1].split("\n\nReply")[0]), text


def relationship(child, npc_id="pirate-pip", level="FRIEND", flags=None):
    now = timezone.now()
    return NpcRelationship.objects.create(
        child=child,
        npc_id=npc_id,
        relationship_level=level,
        memory_flags=flags,
        first_met_at=now,
        last_interacted_at=now,
    )


def every_narrated_node():
    """Every (npc, node) pair the exported catalog authored for narration."""
    export = json.loads(
        (__import__("pathlib").Path(__file__).parents[4] / "content/exported/npcs.json").read_text()
    )
    return [
        (npc["id"], node["id"])
        for npc in export["npcs"]
        for node in npc["dialogue"]
        if isinstance(node.get("narration"), dict)
    ]


def test_the_prompt_carries_the_npcs_identity_and_place_from_the_catalog(
    families, api, fake_model, real_catalog
):
    fake = fake_model()
    assert post(api, families.a, families.a1, PIP).json()["source"] == "AI"
    context, _ = trusted(fake)
    assert context["characterName"] == "Pirate Pip"
    assert "foreman" in context["characterRole"]
    assert context["placeTitle"] == "Pirate Builder Bay"
    assert context["islandTitle"]


def test_a_published_3d_area_is_named_and_an_unpublished_one_is_not(
    families, api, fake_model, real_catalog
):
    from apps.catalog.models import Location
    from apps.core.content_status import ContentStatus
    from apps.regions.models import WorldRegion

    area = WorldRegion.objects.create(
        region_id="bay-area",
        title="Bay Docks",
        location=Location.objects.get(slug="pirate-builder-bay"),
        status=ContentStatus.DRAFT,
    )
    fake = fake_model()
    post(api, families.a, families.a1, PIP)
    assert "areaTitle" not in trusted(fake)[0]
    area.status = ContentStatus.PUBLISHED
    area.save()
    fake2 = fake_model()
    post(api, families.a, families.a1, PIP)
    assert trusted(fake2)[0]["areaTitle"] == "Bay Docks"


def test_relationship_and_active_quest_are_this_childs_only(
    families, api, fake_model, real_catalog
):
    relationship(families.a2, level="TRUSTED_FRIEND")
    relationship(families.b1, level="FRIEND")
    relationship(families.a1, level="ACQUAINTANCE")
    fake = fake_model()
    post(api, families.a, families.a1, PIP)
    context, text = trusted(fake)
    assert context["relationshipLevel"] == "ACQUAINTANCE" and context["hasMetBefore"] is True
    assert "TRUSTED_FRIEND" not in text and "FRIEND" not in text.replace("ACQUAINTANCE", "")
    for other in (families.a2, families.b1):
        assert other.nickname not in text and str(other.pk) not in text


def test_a_child_who_never_met_the_npc_reads_as_a_stranger(families, api, fake_model, real_catalog):
    fake = fake_model()
    post(api, families.a, families.a1, PIP)
    context, _ = trusted(fake)
    assert (context["relationshipLevel"], context["hasMetBefore"]) == ("STRANGER", False)


def test_eligibility_is_not_enforced_by_default(families, api, fake_model, real_catalog):
    fake_model()
    assert post(api, families.a, families.a1, PIP).status_code == 200


def test_enforced_eligibility_follows_the_childs_own_memory_flags(
    families, api, fake_model, real_catalog, settings
):
    settings.LAI_AI_NPC_ENFORCE_ELIGIBILITY = True
    fake = fake_model()
    assert post(api, families.a, families.a1, PIP).status_code == 404
    relationship(families.a1, flags={"bridgeQuestCompleted": True})
    assert post(api, families.a, families.a1, PIP).status_code == 200
    # A sibling's flag unlocks nothing for another child.
    assert post(api, families.a, families.a2, PIP).status_code == 404
    assert len(fake.requests) == 1


def test_conditions_that_cannot_be_judged_are_not_met():
    state = npc_context.ChildNpcState("FRIEND", {}, frozenset(), frozenset(), True)
    assert not npc_context.condition_met({"type": "TIME_OF_DAY", "timeOfDay": "MORNING"}, state)
    assert not npc_context.condition_met({"type": "SOMETHING_NEW"}, state)
    assert not npc_context.condition_met("ALWAYS", state)
    assert npc_context.condition_met({"type": "ALWAYS"}, state)
    assert npc_context.condition_met(
        {"type": "RELATIONSHIP_AT_LEAST", "level": "ACQUAINTANCE"}, state
    )
    assert not npc_context.condition_met({"type": "RELATIONSHIP_AT_LEAST", "level": "BOGUS"}, state)
    assert npc_context.node_is_eligible({"id": "x"}, state)
    assert not npc_context.node_is_eligible({"id": "x", "conditions": "ALWAYS"}, state)


def test_an_unset_memory_flag_reads_as_false():
    state = npc_context.ChildNpcState("STRANGER", {}, frozenset(), frozenset(), False)
    unset_false = {"type": "MEMORY_FLAG", "flag": "f", "equals": False}
    assert npc_context.condition_met(unset_false, state)
    assert not npc_context.condition_met({**unset_false, "equals": True}, state)


@pytest.mark.parametrize(("npc_id", "node_id"), every_narrated_node())
def test_every_authored_narration_node_is_server_owned(
    families, api, fake_model, real_catalog, npc_id, node_id
):
    """Pip, Quill (Storykeeper Castle), Bolt, Ember, the Harbor Master and Professor Ticktock."""
    fake = fake_model()
    body = {**PIP, "npcId": npc_id, "nodeId": node_id, "stepSummary": "client text"}
    response = post(api, families.a, families.a1, body)
    assert response.status_code == 200
    part = fake.requests[0].content
    assert len(part) == 2 and not any(p.untrusted for p in part)  # nothing from the browser
    assert part[1].guarded and "client text" not in part[1].text
    assert "client text" not in part[0].text
    context, _ = trusted(fake)
    assert context["adventureTemplateId"] == f"npc:{npc_id}"
    assert context["characterName"] == NpcDefinition.objects.get(npc_id=npc_id).display_name


def test_a_retired_npc_and_a_retired_place_are_not_named(families, real_catalog):
    from apps.catalog.models import Location

    Location.objects.filter(slug="pirate-builder-bay").update(active=False)
    narration = load_npc_narration("pirate-pip", "pip-bridge-thanks", child=families.a1)
    assert "placeTitle" not in narration.extra
    NpcDefinition.objects.filter(npc_id="pirate-pip").update(active=False)
    with pytest.raises(ContextNotFound):
        load_npc_narration("pirate-pip", "pip-bridge-thanks", child=families.a1)


def test_narration_without_a_child_has_no_child_specific_context(families, real_catalog):
    narration = load_npc_narration("pirate-pip", "pip-bridge-thanks")
    assert "relationshipLevel" not in narration.extra and "questTitle" not in narration.extra


def test_a_session_turn_after_the_adventure_was_republished_is_not_found(
    families, api, fake_model, ai_catalog, start_session
):
    from apps.catalog.models import Adventure

    session = start_session(families.a1)
    body = {
        "intent": "HINT",
        "contextSource": "DJANGO_SESSION",
        "sessionId": str(session.pk),
        "stepId": "count",
    }
    fake = fake_model()
    assert post(api, families.a, families.a1, body).status_code == 200
    Adventure.objects.filter(slug="ai-bridge").update(version=2)
    assert post(api, families.a, families.a1, body).status_code == 404
    assert len(fake.requests) == 1  # the pinned-out turn never reached the model


def test_story_scene_context_stays_untrusted_until_a_django_story_catalog_exists(
    families, api, fake_model
):
    """Storykeeper Castle story scenes still run CLIENT_AUTHORED (blocked on LAI-0309 stories)."""
    fake = fake_model()
    body = {
        "intent": "NARRATE",
        "templateId": "story:great-storybook",
        "stepSummary": "a quiet scene",
        "authoredBaseText": "The keeper smiled.",
    }
    assert post(api, families.a, families.a1, body).status_code == 200
    assert fake.requests[0].content[1].untrusted
