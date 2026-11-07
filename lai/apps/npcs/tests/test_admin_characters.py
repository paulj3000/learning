"""LAI-NPC-004 / 005: authoring characters, variants, placements and dialogue in Django Admin."""

import pytest
from django.contrib import admin as django_admin
from django.contrib.auth.models import Group, Permission
from django.core.management import call_command
from django.test import Client

from apps.assets.models import VersionStatus
from apps.assets.tests.helpers import make_definition, make_version
from apps.catalog.models import AssetOrigin, NpcDefinition
from apps.npcs.management.commands.ensure_npc_roles import EDITORS, PUBLISHERS, ROLES
from apps.npcs.models import (
    NpcCharacter,
    NpcConversationState,
    NpcDialogue,
    NpcModelVariant,
    NpcPlacement,
)
from apps.npcs.vocabulary import CharacterStatus

from .helpers import (
    content_release,
    make_asset,
    make_character,
    make_dialogue,
    make_place,
    make_staff,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

CHARACTERS = "/admin/npcs/npccharacter/"
VARIANTS = "/admin/npcs/npcmodelvariant/"
PLACEMENTS = "/admin/npcs/npcplacement/"
DIALOGUES = "/admin/npcs/npcdialogue/"
RELEASES = "/admin/npcs/npcrelease/"


@pytest.fixture(autouse=True)
def roles():
    call_command("ensure_npc_roles", verbosity=0)


def login(username, *groups, superuser=False):
    account = make_staff(username, superuser=superuser)
    account.groups.set(Group.objects.filter(name__in=groups))
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    client.account = account
    return client


@pytest.fixture
def editor():
    return login("npc-editor", EDITORS)


def character_form(**fields):
    data = {
        "definition": "",
        "new_npc_id": "",
        "new_display_name": "",
        "new_home_place": "",
        "role": "GUIDE",
        "status": "DRAFT",
        "dialogue_mode": "AUTHORED",
        "age_bands": "",
        "personality": "{}",
        "voice_profile": "",
        "notes": "",
    }
    data.update(fields)
    return data


# --- roles and access ----------------------------------------------------------------------------


def test_roles_are_exact_and_idempotent():
    group = Group.objects.get(name=EDITORS)
    group.permissions.add(Permission.objects.get(codename="publish_npcrelease"))  # by hand
    call_command("ensure_npc_roles", verbosity=0)
    for name, expected in ROLES.items():
        granted = {
            f"{p.content_type.app_label}.{p.codename}"
            for p in Group.objects.get(name=name).permissions.select_related("content_type")
        }
        assert granted == set(expected)
    assert "npcs.publish_npcrelease" not in ROLES[EDITORS]
    assert "npcs.rollback_npcrelease" not in ROLES[EDITORS]
    assert {"npcs.publish_npcrelease", "npcs.rollback_npcrelease"} <= set(ROLES[PUBLISHERS])
    assert "npcs.delete_npccharacter" not in ROLES[PUBLISHERS]


def test_anonymous_visitors_are_sent_to_the_admin_login():
    for url in (CHARACTERS, VARIANTS, PLACEMENTS, DIALOGUES, RELEASES, f"{RELEASES}validate/"):
        response = Client().get(url)
        assert response.status_code == 302 and "/login/" in response["Location"], url


def test_staff_without_an_npc_role_are_denied():
    client = login("no-role")
    for url in (CHARACTERS, f"{CHARACTERS}add/", VARIANTS, PLACEMENTS, DIALOGUES, RELEASES):
        assert client.get(url).status_code == 403, url
    assert client.get(f"{RELEASES}validate/").status_code == 403


def test_editors_can_author_every_authoring_page(editor):
    character = make_character("pagey")
    make_dialogue(character)
    for url in (CHARACTERS, f"{CHARACTERS}add/", VARIANTS, PLACEMENTS, DIALOGUES, RELEASES):
        assert editor.get(url).status_code == 200, url
    assert editor.get(f"{CHARACTERS}{character.pk}/change/").status_code == 200
    variant = character.variants.get()
    assert editor.get(f"{VARIANTS}{variant.pk}/change/").status_code == 200
    node = NpcDialogue.objects.get().nodes.first()
    assert editor.get(f"/admin/npcs/npcdialoguenode/{node.pk}/change/").status_code == 200


def test_child_conversation_state_is_never_in_the_admin():
    assert NpcConversationState not in django_admin.site._registry


def test_characters_are_searchable_and_filterable(editor):
    make_character("searchable-npc")
    make_character("other-npc", status=CharacterStatus.DRAFT)
    text = editor.get(CHARACTERS, {"q": "searchable"}).content.decode()
    assert "searchable-npc" in text and "other-npc" not in text
    text = editor.get(CHARACTERS, {"status__exact": "DRAFT"}).content.decode()
    assert "other-npc" in text and "searchable-npc" not in text


# --- create NPC ----------------------------------------------------------------------------------


def test_create_a_django_only_npc_in_one_step(editor):
    _world, place = make_place()
    response = editor.post(
        f"{CHARACTERS}add/",
        character_form(
            new_npc_id="harbor-gull", new_display_name="Harbor Gull", new_home_place=place.pk
        ),
    )
    assert response.status_code == 302, response.content.decode()[:2000]
    definition = NpcDefinition.objects.get(npc_id="harbor-gull")
    assert definition.origin == AssetOrigin.DJANGO
    assert definition.home_location == place and definition.home_location_slug == place.slug
    character = NpcCharacter.objects.get(definition=definition)
    assert character.status == CharacterStatus.DRAFT
    assert character.created_by == editor.account and character.updated_by == editor.account


def test_attach_a_profile_to_an_export_npc(editor):
    definition = NpcDefinition.objects.create(
        npc_id="export-pip",
        display_name="Export Pip",
        home_location_slug="test-bay",
        origin=AssetOrigin.EXPORT,
        source={"key": "export-pip"},
        last_seen_release=content_release(),
    )
    response = editor.post(f"{CHARACTERS}add/", character_form(definition=definition.pk))
    assert response.status_code == 302
    character = NpcCharacter.objects.get(definition=definition)
    definition.refresh_from_db()
    assert definition.origin == AssetOrigin.EXPORT  # never claimed
    assert character.role == "GUIDE"


def test_create_npc_form_explains_what_is_wrong(editor):
    _world, place = make_place()
    existing = make_character("taken", with_variant=False)
    free = NpcDefinition.objects.create(
        npc_id="free", display_name="Free", home_location_slug="x", origin=AssetOrigin.DJANGO
    )

    text = editor.post(f"{CHARACTERS}add/", character_form()).content.decode()
    assert "Choose an existing NPC, or give a new NPC id" in text

    text = editor.post(
        f"{CHARACTERS}add/", character_form(definition=free.pk, new_npc_id="also-new")
    ).content.decode()
    assert "not both" in text

    text = editor.post(
        f"{CHARACTERS}add/",
        character_form(new_npc_id=existing.slug, new_display_name="Again", new_home_place=place.pk),
    ).content.decode()
    assert "already exists; choose it under Existing NPC" in text

    text = editor.post(f"{CHARACTERS}add/", character_form(new_npc_id="no-name")).content.decode()
    assert "A new NPC needs a name." in text and "A new NPC needs a home place." in text
    assert not NpcDefinition.objects.filter(npc_id__in=["also-new", "no-name"]).exists()

    # An NPC that already has a profile is not offered again.
    text = editor.get(f"{CHARACTERS}add/").content.decode()
    assert f'value="{free.pk}"' in text
    assert f'value="{existing.definition.pk}"' not in text


def test_status_actions_change_status_and_never_delete(editor):
    character = make_character("statusy", status=CharacterStatus.DRAFT)
    response = editor.post(
        CHARACTERS,
        {"action": "mark_ready", "_selected_action": [character.pk], "index": 0},
        follow=True,
    )
    assert "set to Ready to publish" in response.content.decode()
    character.refresh_from_db()
    assert character.status == CharacterStatus.READY
    assert character.updated_by == editor.account
    assert editor.get(f"{CHARACTERS}{character.pk}/delete/").status_code == 403


def test_status_is_editable_on_the_change_form(editor):
    character = make_character("formy", status=CharacterStatus.DRAFT)
    variant = character.variants.get()
    data = {
        "role": "GUIDE",
        "status": "RETIRED",
        "dialogue_mode": "AUTHORED",
        "age_bands": "",
        "personality": "{}",
        "voice_profile": "",
        "notes": "",
        "variants-TOTAL_FORMS": "1",
        "variants-INITIAL_FORMS": "1",
        "variants-MIN_NUM_FORMS": "0",
        "variants-MAX_NUM_FORMS": "1000",
        **{f"variants-0-{k}": v for k, v in _variant_fields(variant).items()},
        "variants-0-id": variant.pk,
        "variants-0-character": character.pk,
    }
    response = editor.post(f"{CHARACTERS}{character.pk}/change/", data)
    assert response.status_code == 302, response.content.decode()[:3000]
    character.refresh_from_db()
    assert character.status == CharacterStatus.RETIRED


# --- variants (LAI-NPC-004) ----------------------------------------------------------------------


def _variant_fields(variant=None, **overrides):
    data = {
        "variant_key": variant.variant_key if variant else "classic",
        "display_name": "",
        "is_default": "on",
        "sort_order": "0",
        "model_asset": variant.model_asset_id if variant else "",
        "pinned_version": "",
        "portrait_asset": "",
        "scale": "1.0",
        "rotation_offset_y": "0",
        "position_offset_y": "0",
        "animation_map": '{"idle": "Idle"}',
        "availability": "[]",
    }
    data.update(overrides)
    return data


def _variant_post(client, character, **overrides):
    data = {
        "character": character.pk,
        **_variant_fields(**overrides),
        "extras-TOTAL_FORMS": "0",
        "extras-INITIAL_FORMS": "0",
        "extras-MIN_NUM_FORMS": "0",
        "extras-MAX_NUM_FORMS": "1000",
    }
    return client.post(f"{VARIANTS}add/", data)


def test_variant_admin_saves_a_valid_variant_with_audit(editor):
    character = make_character("varied", with_variant=False)
    model = make_asset("varied-model")
    response = _variant_post(
        editor, character, model_asset=model.pk, animation_map='{"idle": "Idle", "talk": "Talk"}'
    )
    assert response.status_code == 302, response.content.decode()[:3000]
    variant = NpcModelVariant.objects.get(character=character)
    assert variant.animation_map == {"idle": "Idle", "talk": "Talk"}
    assert variant.created_by == editor.account


def test_variant_admin_refuses_wrong_kinds_and_unknown_clips(editor):
    character = make_character("wrong", with_variant=False)
    picture = make_asset("just-a-picture", kind="image")
    text = _variant_post(editor, character, model_asset=picture.pk).content.decode()
    assert "just-a-picture is a image asset; choose a character asset" in text

    model = make_asset("wrong-model")
    text = _variant_post(
        editor,
        character,
        model_asset=model.pk,
        portrait_asset=make_asset("a-model-portrait").pk,
        animation_map='{"idle": "Idle", "dance": "Boogie"}',
    ).content.decode()
    assert "a-model-portrait is a character asset; choose a image or sprite asset" in text
    assert "Unknown state(s): dance" in text

    text = _variant_post(
        editor, character, model_asset=model.pk, animation_map='{"talk": "Chatter"}'
    ).content.decode()
    assert "These clips are not in wrong-model: talk -&gt; &#x27;Chatter&#x27;" in text
    assert "Available clips: Idle, Talk, Wave." in text

    text = _variant_post(
        editor, character, model_asset=model.pk, availability='[{"type": "NOPE"}]'
    ).content.decode()
    assert "NOPE" in text  # condition problems are shown on the field
    assert not NpcModelVariant.objects.filter(character=character).exists()


def test_variant_admin_refuses_an_unpublished_pinned_version(editor):
    character = make_character("pinny", with_variant=False)
    asset = make_definition("pinny-glb")
    draft = make_version(asset, 1, status=VersionStatus.VALIDATED, clips=["Idle"])
    text = _variant_post(
        editor, character, model_asset=asset.pk, pinned_version=draft.pk
    ).content.decode()
    assert "Version 1 is validated" in text and "pin a published version" in text
    assert "These clips are not in" not in text  # no misleading second error


def test_variant_page_lists_clips_and_links_the_asset_preview():
    client = login("viewer-plus", EDITORS)
    asset = make_definition("shown-glb")
    version = make_version(asset, 1, status=VersionStatus.PUBLISHED, clips=["Idle", "Jump"])
    asset.default_version = version
    asset.save()
    character = make_character("shown", with_variant=False)
    variant = NpcModelVariant.objects.create(
        character=character, variant_key="classic", model_asset=asset, is_default=True
    )
    text = client.get(f"{VARIANTS}{variant.pk}/change/").content.decode()
    assert "shown-glb v1: Idle, Jump" in text
    assert f"/admin/assets/assetversion/{version.pk}/preview/" in text

    bundled = make_character("bundled-look")
    text = client.get(f"{VARIANTS}{bundled.variants.get().pk}/change/").content.decode()
    assert "bundled-look-model (bundled): Idle, Talk, Wave" in text
    assert "Bundled with the game (no stored version to preview)." in text
    # NPC QA limitation 4: extras are validated and published but not drawn yet; staff are told.
    assert "Checked and published, but not shown in the game yet" in text


# --- placements ----------------------------------------------------------------------------------


def _placement_post(client, character, world, place, **overrides):
    data = {
        "placement_key": "dock",
        "character": character.pk,
        "active": "on",
        "sort_order": "0",
        "world": world.pk,
        "location": place.pk,
        "region": "",
        "x": "1.5",
        "y": "0",
        "z": "-2",
        "rotation_y": "0",
        "variant": "",
        "behavior": "",
        "scale": "1",
        "interaction_radius": "2.5",
        "spawn_conditions": "[]",
    }
    data.update(overrides)
    return client.post(f"{PLACEMENTS}add/", data)


def test_placement_admin_saves_numeric_transform_and_shows_hierarchy_errors(editor):
    character = make_character("placed")
    world, place = make_place()
    other_world, _ = make_place("far-island", "far-bay")

    text = _placement_post(editor, character, other_world, place).content.decode()
    assert "This Place is on a different Island." in text
    text = _placement_post(
        editor, character, world, place, spawn_conditions='[{"type": "AGE_BAND", "in": ["X"]}]'
    ).content.decode()
    assert "spawn_conditions" in text and not NpcPlacement.objects.exists()

    response = _placement_post(editor, character, world, place)
    assert response.status_code == 302
    placement = NpcPlacement.objects.get()
    assert (placement.x, placement.z) == (1.5, -2.0)
    assert placement.created_by == editor.account


# --- dialogue authoring --------------------------------------------------------------------------


def test_dialogue_start_node_is_limited_to_its_own_nodes(editor):
    character = make_character("talker")
    first = make_dialogue(character, "first")
    second = make_dialogue(character, "second")
    foreign = second.nodes.get(node_key="greet")
    page = editor.get(f"{DIALOGUES}{first.pk}/change/").content.decode()
    assert f'value="{first.start_node_id}"' in page
    assert f'<option value="{foreign.pk}"' not in page

    nodes = list(first.nodes.order_by("sort_order"))
    data = {
        "character": character.pk,
        "dialogue_key": "first",
        "title": "First",
        "trigger": "on_interact",
        "mode": "AUTHORED",
        "priority": "0",
        "start_node": foreign.pk,
        "active": "on",
        "age_bands": "",
        "conditions": "[]",
        "nodes-TOTAL_FORMS": str(len(nodes)),
        "nodes-INITIAL_FORMS": str(len(nodes)),
        "nodes-MIN_NUM_FORMS": "0",
        "nodes-MAX_NUM_FORMS": "1000",
    }
    for i, node in enumerate(nodes):
        data.update(
            {
                f"nodes-{i}-id": node.pk,
                f"nodes-{i}-dialogue": first.pk,
                f"nodes-{i}-node_key": node.node_key,
                f"nodes-{i}-text": node.text,
                f"nodes-{i}-emotion": node.emotion,
                f"nodes-{i}-animation_state": node.animation_state,
                f"nodes-{i}-audio_asset": "",
                f"nodes-{i}-next_node": "",
                f"nodes-{i}-sort_order": node.sort_order,
            }
        )
    text = editor.post(f"{DIALOGUES}{first.pk}/change/", data).content.decode()
    assert "Select a valid choice" in text

    data["start_node"] = nodes[1].pk
    response = editor.post(f"{DIALOGUES}{first.pk}/change/", data)
    assert response.status_code == 302, response.content.decode()[:3000]
    first.refresh_from_db()
    assert first.start_node_id == nodes[1].pk and first.updated_by == editor.account


def test_dialogue_node_audio_must_be_an_audio_asset(editor):
    character = make_character("voiced")
    dialogue = make_dialogue(character)
    node = dialogue.nodes.get(node_key="bye")
    data = {
        "dialogue": dialogue.pk,
        "node_key": "bye",
        "sort_order": "1",
        "text": "See you soon!",
        "emotion": "neutral",
        "animation_state": "",
        "audio_asset": make_asset("not-audio", kind="image").pk,
        "next_node": "",
        "allowed_topic": "",
        "age_bands": "",
        "conditions": "[]",
        "choices-TOTAL_FORMS": "0",
        "choices-INITIAL_FORMS": "0",
        "choices-MIN_NUM_FORMS": "0",
        "choices-MAX_NUM_FORMS": "1000",
    }
    url = f"/admin/npcs/npcdialoguenode/{node.pk}/change/"
    assert (
        "not-audio is a image asset; choose a audio asset"
        in editor.post(url, data).content.decode()
    )
    data["audio_asset"] = make_asset("real-line", kind="audio").pk
    assert editor.post(url, data).status_code == 302
    node.refresh_from_db()
    assert node.audio_asset.asset_id == "real-line"


def test_dialogue_choices_keep_the_order_staff_give_them(editor):
    """QA-D1: the choice inline carries `sort_order`, so "Tell me more" can come before "Maybe
    later" even though its key sorts after it."""
    from apps.npcs.models import NpcDialogueChoice

    character = make_character("chooser")
    dialogue = make_dialogue(character)
    # The goodbye node has no choices yet; the second choice leads back to the greeting.
    node = dialogue.nodes.get(node_key="bye")
    greet = dialogue.nodes.get(node_key="greet")
    url = f"/admin/npcs/npcdialoguenode/{node.pk}/change/"
    assert 'name="choices-__prefix__-sort_order"' in editor.get(url).content.decode()
    data = {
        "dialogue": dialogue.pk,
        "node_key": node.node_key,
        "sort_order": str(node.sort_order),
        "text": node.text,
        "emotion": node.emotion,
        "animation_state": node.animation_state,
        "audio_asset": "",
        "next_node": "",
        "allowed_topic": "",
        "age_bands": "",
        "conditions": "[]",
        "choices-TOTAL_FORMS": "2",
        "choices-INITIAL_FORMS": "0",
        "choices-MIN_NUM_FORMS": "0",
        "choices-MAX_NUM_FORMS": "1000",
    }
    for i, (key, label, order, action, next_node) in enumerate(
        [("more", "Tell me more", "0", "NONE", greet.pk), ("later", "Maybe later", "1", "END", "")]
    ):
        data.update(
            {
                f"choices-{i}-node": node.pk,
                f"choices-{i}-choice_key": key,
                f"choices-{i}-label": label,
                f"choices-{i}-next_node": next_node,
                f"choices-{i}-action": action,
                f"choices-{i}-action_value": "",
                f"choices-{i}-conditions": "[]",
                f"choices-{i}-sort_order": order,
            }
        )
    response = editor.post(url, data)
    assert response.status_code == 302, response.content.decode()[:3000]
    served = NpcDialogueChoice.objects.filter(node=node).values_list("choice_key", flat=True)
    assert list(served) == ["more", "later"]


# --- Mixamo exports (NPC Manager QA, docs/NPC_MANAGER_QA_REPORT.md) -------------------------------

MIXAMO_TAKES = ["Armature|mixamo.com|Layer0", "Armature|mixamo.com|Layer0.001"]


def _mixamo_model(asset_id: str):
    asset = make_definition(asset_id)
    version = make_version(asset, 1, status=VersionStatus.PUBLISHED, clips=MIXAMO_TAKES)
    asset.default_version = version
    asset.save()
    return asset


def test_a_mixamo_model_never_gets_semantic_states_by_guesswork(editor):
    """Idle/Talk/Wave are refused for a model whose takes are the default Mixamo names, and the
    refusal lists those names so staff see what the export produced. Nothing maps them for staff."""
    character = make_character("pirate-mixamo", with_variant=False)
    model = _mixamo_model("pirate-mixamo-glb")
    text = _variant_post(
        editor,
        character,
        model_asset=model.pk,
        animation_map='{"idle": "Idle", "talk": "Talk", "wave": "Wave"}',
    ).content.decode()
    assert "These clips are not in pirate-mixamo-glb" in text
    assert "Armature|mixamo.com|Layer0, Armature|mixamo.com|Layer0.001" in text
    assert not NpcModelVariant.objects.filter(character=character).exists()

    # No map at all is allowed (the NPC stands with procedural motion) and stays empty.
    response = _variant_post(editor, character, model_asset=model.pk, animation_map="{}")
    assert response.status_code == 302, response.content.decode()[:3000]
    assert NpcModelVariant.objects.get(character=character).animation_map == {}


def test_staff_may_map_an_exact_take_name_they_have_checked(editor):
    """A take name is accepted only verbatim, as staff typed it: the explicit, reviewed choice."""
    character = make_character("pirate-checked", with_variant=False)
    model = _mixamo_model("pirate-checked-glb")
    response = _variant_post(
        editor,
        character,
        model_asset=model.pk,
        animation_map='{"idle": "Armature|mixamo.com|Layer0"}',
    )
    assert response.status_code == 302, response.content.decode()[:3000]
    variant = NpcModelVariant.objects.get(character=character)
    assert variant.animation_map == {"idle": "Armature|mixamo.com|Layer0"}
    # A near miss (the Layer0 take with the wrong suffix) is still refused.
    text = _variant_post(
        editor,
        make_character("pirate-near-miss", with_variant=False),
        model_asset=model.pk,
        animation_map='{"idle": "Armature|mixamo.com|Layer0.002"}',
    ).content.decode()
    assert "These clips are not in pirate-checked-glb" in text
