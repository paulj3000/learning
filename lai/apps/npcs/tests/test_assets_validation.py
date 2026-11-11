"""LAI-NPC-003 / 035: asset and configuration checks that refuse a publish with clear messages."""

import pytest

from apps.assets.models import VersionStatus
from apps.assets.tests.helpers import make_definition, make_version
from apps.catalog.models import AssetStatus
from apps.npcs.models import NpcRelease, NpcVariantAsset
from apps.npcs.publishing import PublishError, preview, publish
from apps.npcs.validation import assets as asset_checks

from .helpers import make_asset, make_character, make_dialogue, make_place, make_placement

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def _refused(staff) -> list[str]:
    with pytest.raises(PublishError) as error:
        publish(staff)
    assert error.value.code == "invalid"
    assert not NpcRelease.objects.exists()  # a failed publish writes nothing
    return error.value.problems


@pytest.fixture
def staff():
    from .helpers import make_staff

    return make_staff()


def test_valid_bundled_character_has_no_asset_problems():
    make_character("fine")
    assert asset_checks.problems(preview().built.snapshot) == []


def test_unknown_bundled_clip_names_are_listed_with_the_available_clips(staff):
    character = make_character("clippy")
    variant = character.variants.get()
    variant.animation_map = {"idle": "Idle", "talk": "Chatter"}
    variant.save()
    problems = _refused(staff)
    assert any(
        "clippy variant classic animation map: talk uses clip 'Chatter'" in p
        and "(available clips: Idle, Talk, Wave)" in p
        for p in problems
    ), problems


def test_clip_names_are_checked_against_the_resolved_published_version(staff):
    asset = make_definition("versioned-npc")
    v1 = make_version(asset, 1, status=VersionStatus.PUBLISHED, clips=["Idle", "Run"])
    make_version(asset, 2, status=VersionStatus.PUBLISHED, clips=["Idle", "Talk"])
    asset.default_version = v1
    asset.save()
    character = make_character("pinned", with_variant=False)
    from .helpers import make_variant

    make_variant(character, model_asset=asset, animation_map={"idle": "Idle", "talk": "Talk"})
    problems = _refused(staff)
    assert any("talk uses clip 'Talk', which versioned-npc v1 does not have" in p for p in problems)

    variant = character.variants.get()
    variant.pinned_version = asset.versions.get(number=2)
    variant.save()
    assert not preview().problems  # v2 has the Talk clip


def test_wrong_kinds_unpublished_versions_and_retired_assets_are_refused(staff):
    character = make_character("kinds")
    variant = character.variants.get()
    variant.portrait_asset = make_asset("not-a-portrait", kind="audio")
    variant.save()
    NpcVariantAsset.objects.create(
        variant=variant, role="TEXTURE", asset=make_asset("a-sound", kind="audio")
    )
    NpcVariantAsset.objects.create(
        variant=variant, role="ACCESSORY", asset=make_asset("a-hat", kind="prop")
    )
    unpublished = make_definition("draft-model")
    make_version(unpublished, 1, status=VersionStatus.VALIDATED, clips=["Idle"])
    other = make_character("unpub", with_variant=False)
    from .helpers import make_variant

    make_variant(
        other,
        model_asset=unpublished,
        pinned_version=unpublished.versions.get(),
        animation_map={"idle": "Idle"},
    )
    dialogue = make_dialogue(character)
    node = dialogue.nodes.get(node_key="greet")
    node.audio_asset = make_asset("line-picture", kind="image")
    node.save()
    retired = make_character("gone")
    model = retired.variants.get().model_asset
    model.status = AssetStatus.RETIRED
    model.save()

    problems = _refused(staff)
    joined = "\n".join(problems)
    assert "kinds variant classic portrait: asset not-a-portrait is a audio" in joined
    assert "kinds variant classic texture: asset a-sound is a audio, expected texture or image" in (
        joined
    )
    assert "a-hat" not in joined  # a prop is a valid accessory
    assert "unpub variant classic model: asset draft-model version 1 is not published" in joined
    assert "line-picture is a image, expected audio" in joined
    assert "gone variant classic model: asset gone-model is retired" in joined


def test_stale_draft_rows_are_rechecked_at_publish(staff):
    character = make_character("stale")
    placement = make_placement(character)
    other_world, _ = make_place("elsewhere", "elsewhere-bay")
    placement.world = other_world  # saved without full_clean: the Place is on another Island
    placement.save()
    problems = _refused(staff)
    assert any(
        p.startswith("placement test-bay/spot: location: This Place is on a different Island")
        for p in problems
    ), problems
