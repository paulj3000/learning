"""LAI-JMP-01c: player avatar identities on the existing asset library."""

import io

import pytest
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.test import Client

from apps.assets import services as asset_services
from apps.assets.management.commands.ensure_asset_roles import EDITORS, PUBLISHERS, ROLES
from apps.assets.models import VersionStatus
from apps.assets.tests.helpers import glb_bytes, make_definition, make_version
from apps.avatars import services, validation
from apps.avatars.dependencies import REFUSAL_CODE
from apps.avatars.models import PlayerAvatar
from apps.avatars.vocabulary import AVATAR_KEYS, AvatarStatus

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

CLIPS = ("Idle", "Walk", "Jump", "Wave", "Celebrate")


def publish(asset, clips=CLIPS):
    version = asset_services.upload_version(
        asset, io.BytesIO(glb_bytes(clips=clips)), original_filename="hero.glb"
    )
    published = asset_services.publish_version(version)
    if published.asset.default_version_id is None:
        asset_services.set_default_version(published)
    asset.refresh_from_db()
    return published


def avatar(key="FOX") -> PlayerAvatar:
    return PlayerAvatar.objects.get(avatar_key=key)


def ready_fox(**fields) -> PlayerAvatar:
    """FOX, drawn with a published character model and available to children."""
    model = make_definition("player-fox", category="character")
    publish(model)
    fox = avatar("FOX")
    fox.model_asset = model
    fox.status = AvatarStatus.AVAILABLE
    for name, value in fields.items():
        setattr(fox, name, value)
    fox.full_clean()
    fox.save()
    return fox


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()


# --- the catalogue -------------------------------------------------------------------------------


def test_the_migration_seeds_the_six_identities_as_drafts_with_no_model():
    rows = {row.avatar_key: row for row in PlayerAvatar.objects.all()}
    assert set(rows) == set(AVATAR_KEYS)
    assert rows["MERMAID"].display_name == "Mermaid"
    assert {row.status for row in rows.values()} == {AvatarStatus.DRAFT}
    assert all(row.model_asset_id is None for row in rows.values())


def test_identities_mirror_the_child_profile_avatar_choices():
    from apps.users.serializers import AVATAR_KEYS as PROFILE_KEYS

    assert tuple(AVATAR_KEYS) == tuple(PROFILE_KEYS)


# --- validation ----------------------------------------------------------------------------------


def test_an_available_avatar_needs_a_published_character_model():
    fox = avatar()
    fox.status = AvatarStatus.AVAILABLE
    assert "Choose a model before making the avatar available." in validation.problems(
        fox, for_availability=True
    )
    prop = make_definition("a-crate", kind="prop", category="prop")
    fox.model_asset = prop
    assert any(
        "must be a character asset" in p for p in validation.problems(fox, for_availability=True)
    )

    unpublished = make_definition("player-draft", category="character")
    make_version(unpublished)  # validated, never published, so no default version
    fox.model_asset = unpublished
    assert any(
        "no published default version" in p for p in validation.problems(fox, for_availability=True)
    )


def test_a_draft_may_be_saved_half_configured_but_never_with_a_bad_map():
    fox = avatar()
    fox.full_clean()  # no model, draft: fine
    fox.animation_map = {"dance": "Dance"}
    with pytest.raises(ValidationError, match="not a player state"):
        fox.full_clean()


def test_the_animation_map_must_name_clips_the_model_has():
    fox = ready_fox()
    fox.animation_map = {"jump": "BigJump"}
    with pytest.raises(ValidationError, match='no clip called "BigJump"'):
        fox.full_clean()


def test_customization_is_checked():
    fox = avatar()
    fox.customization = {
        "colorMaterials": {"Body": "purple"},
        "attachPoints": {"tail": "Tail"},
        "hats": [],
    }
    found = validation.problems(fox, for_availability=False)
    assert any('"hats" is not supported' in p for p in found)
    assert any('material "Body" must take one of body, accent' in p for p in found)
    assert any('"tail" is not an attachment slot' in p for p in found)


def test_a_pinned_version_must_belong_to_the_model():
    fox = ready_fox()
    other = make_definition("player-other", category="character")
    fox.pinned_version = publish(other)
    with pytest.raises(ValidationError, match="pinned version must be a version of"):
        fox.full_clean()


def test_the_thumbnail_must_be_an_image():
    fox = avatar()
    fox.thumbnail_asset = make_definition("a-crate", kind="prop", category="prop")
    assert "The thumbnail must be an image asset." in validation.problems(
        fox, for_availability=False
    )


def test_the_effective_map_fills_states_from_standard_clip_names():
    assert validation.effective_animation_map({}, CLIPS) == {
        "idle": "Idle",
        "walk": "Walk",
        "jump": "Jump",
        "interact": "Wave",
        "celebrate": "Celebrate",
    }
    # An explicit entry wins; one naming a missing clip falls back to the standard name.
    assert (
        validation.effective_animation_map({"walk": "Idle", "jump": "Nope"}, CLIPS)["walk"]
        == "Idle"
    )
    assert validation.effective_animation_map({"jump": "Nope"}, CLIPS)["jump"] == "Jump"
    assert validation.effective_animation_map({}, ()) == {}


def test_missing_clips_are_warnings_never_problems():
    model = make_definition("player-still", category="character")
    publish(model, clips=("Idle",))
    fox = avatar()
    fox.model_asset = model
    assert validation.problems(fox, for_availability=True) == []
    assert "walk, jump" in validation.warnings(fox)[0]


# --- what children are served --------------------------------------------------------------------


def test_a_draft_or_disabled_identity_serves_the_placeholder():
    fox = ready_fox()
    for status in (AvatarStatus.DRAFT, AvatarStatus.DISABLED):
        fox.status = status
        fox.save()
        served = services.describe(fox, "FOX")
        assert served["model"] is None and served["reason"] == "not_available"


def test_an_available_identity_serves_its_published_model_by_reference():
    fox = ready_fox(
        scale=1.2,
        rotation_offset_y=3.14,
        customization={"colorMaterials": {"Body": "body"}, "attachPoints": {"head": "Head"}},
    )
    served = services.describe(fox, "FOX")
    assert served["reason"] is None
    model = served["model"]
    assert model["ref"] == "player-fox" and model["assetId"] == "player-fox"
    assert model["version"] == 1 and model["clips"] == list(CLIPS)
    assert model["scale"] == 1.2 and model["rotationOffset"] == 3.14
    assert model["animationMap"]["jump"] == "Jump"
    assert model["customization"]["colorMaterials"] == {"Body": "body"}
    # Served by reference through the asset resolver: no storage key, no URL to a draft.
    assert "storage" not in str(served) and "url" not in model


def test_a_pinned_version_is_served_as_an_at_reference():
    fox = ready_fox()
    v2 = publish(fox.model_asset, clips=("Idle", "Walk"))
    asset_services.set_default_version(v2)
    fox.pinned_version = fox.model_asset.versions.get(number=1)
    fox.save()
    served = services.describe(avatar(), "FOX")
    assert served["model"]["ref"] == "player-fox@1"
    assert served["model"]["version"] == 1


def test_a_retired_model_is_never_served():
    fox = ready_fox()
    fox.status = AvatarStatus.DRAFT
    fox.save()  # a draft does not block retirement
    asset_services.retire_asset(fox.model_asset)
    fox.refresh_from_db()
    PlayerAvatar.objects.filter(pk=fox.pk).update(status=AvatarStatus.AVAILABLE)
    served = services.describe(avatar(), "FOX")
    assert served["model"] is None and served["reason"] in ("invalid", "retired")


def test_an_unconfigured_identity_serves_the_placeholder():
    PlayerAvatar.objects.filter(avatar_key="OWL").delete()
    served = services.describe(None, "OWL")
    assert served == {
        "avatarKey": "OWL",
        "displayName": "Owl",
        "model": None,
        "reason": "not_configured",
    }


# --- the child-scoped API ------------------------------------------------------------------------


def url_for(child):
    return f"/api/v1/children/{child.pk}/avatar/"


def test_a_parent_gets_their_own_childs_avatar(api, families, cognito):
    ready_fox()
    response = api(families.a).get(url_for(families.a1))
    assert response.status_code == 200
    assert response["Cache-Control"] == "private, no-cache"
    body = response.json()
    assert body["avatarKey"] == "FOX" and body["model"]["ref"] == "player-fox"


def test_each_child_gets_the_avatar_they_chose(api, families, cognito):
    ready_fox()
    families.a2.avatar_key = "OWL"
    families.a2.save()
    body = api(families.a).get(url_for(families.a2)).json()
    assert body["avatarKey"] == "OWL" and body["model"] is None


def test_another_familys_child_is_a_404_and_auth_is_required(api, families, cognito):
    ready_fox()
    assert api(families.a).get(url_for(families.b1)).status_code == 404
    assert Client().get(url_for(families.a1)).status_code == 401
    assert api("sub-never-provisioned").get(url_for(families.a1)).status_code == 403


def test_the_answer_carries_no_child_data(api, families, cognito):
    ready_fox()
    text = api(families.a).get(url_for(families.a1)).content.decode()
    assert families.a1.nickname not in text and "Secret-Interest" not in text


# --- the asset library's retirement guard --------------------------------------------------------


def test_retiring_a_model_an_available_avatar_uses_is_refused():
    fox = ready_fox()
    with pytest.raises(asset_services.AssetActionRefused) as refused:
        asset_services.retire_asset(fox.model_asset)
    assert refused.value.code == REFUSAL_CODE
    assert "Fox" in refused.value.message
    with pytest.raises(asset_services.AssetActionRefused):
        asset_services.retire_version(fox.model_asset.default_version)


def test_an_older_version_and_a_draft_avatars_model_can_be_retired():
    fox = ready_fox()
    v1 = fox.model_asset.default_version
    v2 = publish(fox.model_asset, clips=("Idle", "Walk"))  # a different file
    asset_services.set_default_version(v2)
    asset_services.retire_version(v1)  # not what children are served any more
    v1.refresh_from_db()
    assert v1.status == VersionStatus.RETIRED
    fox.status = AvatarStatus.DRAFT
    fox.save()
    asset_services.retire_asset(fox.model_asset)


# --- Django Admin --------------------------------------------------------------------------------


def staff(*groups):
    from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

    call_command("ensure_asset_roles", verbosity=0)
    name = "staff-" + "-".join(group.split()[1] for group in groups)
    account = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{name}", admin_username=name, is_staff=True
    )
    account.groups.set(Group.objects.filter(name__in=groups))
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    return client


def test_asset_roles_grant_avatar_configuration_and_publishing():
    assert {"avatars.view_playeravatar", "avatars.change_playeravatar"} <= set(ROLES[EDITORS])
    assert "avatars.publish_playeravatar" not in ROLES[EDITORS]
    assert "avatars.publish_playeravatar" in ROLES[PUBLISHERS]


def test_staff_see_what_children_would_receive():
    ready_fox()
    page = staff(EDITORS).get(f"/admin/avatars/playeravatar/{avatar().pk}/change/")
    assert page.status_code == 200
    html = page.content.decode()
    assert "What children choosing this avatar receive" in html and "player-fox" in html


def test_there_is_no_add_or_delete():
    client = staff(PUBLISHERS)
    assert client.get("/admin/avatars/playeravatar/add/").status_code == 403
    assert client.get(f"/admin/avatars/playeravatar/{avatar().pk}/delete/").status_code == 403


def _action(client, action, *avatars):
    return client.post(
        "/admin/avatars/playeravatar/",
        {"action": action, "_selected_action": [a.pk for a in avatars]},
        follow=True,
    )


def test_only_publishers_make_an_avatar_available_and_only_when_it_is_ready():
    model = make_definition("player-fox", category="character")
    publish(model)
    fox = avatar()
    fox.model_asset = model
    fox.save()
    owl = avatar("OWL")  # no model

    _action(staff(EDITORS), "make_available", fox)
    assert avatar().status == AvatarStatus.DRAFT

    publisher = staff(PUBLISHERS)
    _action(publisher, "make_available", fox, owl)
    assert avatar().status == AvatarStatus.AVAILABLE
    assert avatar("OWL").status == AvatarStatus.DRAFT

    _action(publisher, "disable", fox)
    assert avatar().status == AvatarStatus.DISABLED
