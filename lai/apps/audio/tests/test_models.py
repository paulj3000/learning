"""SM-P2-02 and SM-P2-04: cue and assignment validation."""

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.audio.models import SoundAssignment, SoundCue
from apps.audio.tests.helpers import assign, audio_asset, cue
from apps.catalog.models import World
from apps.regions.models import WorldObjectPlacement

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


# --- cues ----------------------------


def test_a_valid_cue_references_an_audio_asset_and_keeps_no_file_or_key():
    asset, _ = audio_asset("chest-creak")
    obj = cue("sfx.chest.open", asset, volume=0.85, cooldown_ms=200, max_concurrent=2)
    assert obj.asset == asset and obj.channel == "sfx" and obj.enabled
    fields = {f.name for f in SoundCue._meta.get_fields()}
    assert not fields & {"url", "storage_key", "file", "bucket"}


def test_a_duplicate_cue_id_is_rejected():
    asset, _ = audio_asset("coin-clink")
    cue("sfx.coin.collect", asset)
    duplicate = SoundCue(cue_id="sfx.coin.collect", name="x", channel="sfx", asset=asset)
    with pytest.raises(ValidationError):
        duplicate.full_clean()
    with pytest.raises(IntegrityError), transaction.atomic():
        SoundCue.objects.create(cue_id="sfx.coin.collect", name="x", channel="sfx", asset=asset)


@pytest.mark.parametrize(
    "cue_id",
    [
        "chest.open",
        "sfx",
        "sfx.Chest.Open",
        "sfx.chest-open",
        "sfx..x",
        "sfx.a.b.c.d.e",
        "SFX.a.b",
        "",
    ],
)
def test_malformed_cue_ids_are_rejected(cue_id):
    asset, _ = audio_asset("coin-clink")
    with pytest.raises(ValidationError):
        SoundCue(cue_id=cue_id, name="x", channel="sfx", asset=asset).full_clean()


def test_the_id_must_start_with_its_channel():
    asset, _ = audio_asset("coin-clink")
    with pytest.raises(ValidationError) as error:
        SoundCue(cue_id="music.coin.collect", name="x", channel="sfx", asset=asset).full_clean()
    assert "cue_id" in error.value.message_dict


def test_the_database_also_refuses_an_id_that_lies_about_its_channel():
    asset, _ = audio_asset("coin-clink")
    with pytest.raises(IntegrityError), transaction.atomic():
        SoundCue.objects.create(cue_id="music.coin.collect", name="x", channel="sfx", asset=asset)


def test_an_unknown_channel_is_rejected():
    asset, _ = audio_asset("coin-clink")
    with pytest.raises(ValidationError):
        SoundCue(cue_id="foley.a.b", name="x", channel="foley", asset=asset).full_clean()


def test_an_asset_that_is_not_audio_is_rejected():
    from apps.assets.tests.helpers import make_definition

    prop = make_definition("treasure-chest", kind="prop", category="prop")
    with pytest.raises(ValidationError) as error:
        SoundCue(cue_id="sfx.chest.open", name="x", channel="sfx", asset=prop).full_clean()
    assert "asset" in error.value.message_dict


def test_an_audio_category_that_does_not_suit_the_channel_is_rejected():
    music, _ = audio_asset("cove-theme", category="music")
    with pytest.raises(ValidationError) as error:
        SoundCue(cue_id="sfx.chest.open", name="x", channel="sfx", asset=music).full_clean()
    assert "does not suit" in str(error.value)
    # Music and voice share a category; "other" suits any channel.
    other, _ = audio_asset("misc-sound", category="other")
    cue("music.cove.explore", music)
    cue("voice.pip.greeting", music)
    cue("ui.menu.select", other)


@pytest.mark.parametrize(
    "field,value",
    [
        ("volume", 1.5),
        ("volume", -0.1),
        ("priority", 101),
        ("max_concurrent", 0),
        ("cooldown_ms", 60_001),
        ("fade_in_ms", 10_001),
    ],
)
def test_out_of_range_playback_settings_are_rejected(field, value):
    asset, _ = audio_asset("coin-clink")
    with pytest.raises(ValidationError):
        SoundCue(
            cue_id="sfx.coin.collect", name="x", channel="sfx", asset=asset, **{field: value}
        ).full_clean()


def test_a_pinned_version_must_be_a_published_version_of_the_same_asset():
    from apps.audio.tests.helpers import asset_upload

    asset, v1 = audio_asset("coin-clink")
    other, other_v = audio_asset("other-clink")
    draft = asset_upload(asset, seconds=2)
    for version in (other_v, draft):
        with pytest.raises(ValidationError) as error:
            SoundCue(
                cue_id="sfx.coin.collect",
                name="x",
                channel="sfx",
                asset=asset,
                pinned_version=version,
            ).full_clean()
        assert "pinned_version" in error.value.message_dict
    SoundCue(
        cue_id="sfx.coin.collect", name="x", channel="sfx", asset=asset, pinned_version=v1
    ).full_clean()


# --- assignments ----------------------------


@pytest.fixture
def scene(treasure):
    place = treasure.region.location
    return {
        "region": treasure.region,
        "place": place,
        "island": place.world,
        "chest": treasure.chest,
        "quest": treasure.quest,
        "cue": cue("sfx.chest.open"),
    }


def test_a_chest_open_assignment_in_its_area_is_valid(scene):
    obj = assign(
        scene["cue"],
        target_type="chest",
        target_id=scene["chest"].entity_id,
        event="on_open",
        region=scene["region"],
    )
    assert (obj.scope_type, obj.scope_id) == ("area", scene["region"].region_id)


def test_an_event_a_target_type_cannot_raise_is_rejected(scene):
    with pytest.raises(ValidationError) as error:
        assign(
            scene["cue"],
            target_type="chest",
            target_id=scene["chest"].entity_id,
            event="on_enter",
            region=scene["region"],
        )
    assert "cannot raise" in str(error.value)


def test_an_unknown_target_type_or_event_is_rejected_by_the_database_too(scene):
    for bad in ({"target_type": "rocket"}, {"event": "on_explode"}):
        fields = {"target_type": "scope", "target_id": "", "event": "on_enter", **bad}
        with pytest.raises(IntegrityError), transaction.atomic():
            SoundAssignment.objects.create(cue=scene["cue"], region=scene["region"], **fields)


@pytest.mark.parametrize(
    "target_type,target_id,why",
    [
        ("chest", "no-such-chest", "has no chest"),
        ("object", "no-such-thing", "has no object"),
        ("adventure", "no-such-adventure", "Unknown adventure"),
        ("quest", "no-such-quest", "Unknown quest"),
        ("npc", "no-such-npc", "Unknown NPC"),
        ("reward", "no-such-rule", "Unknown reward rule"),
    ],
)
def test_a_target_that_does_not_exist_is_rejected(scene, target_type, target_id, why):
    from apps.audio.vocabulary import EVENTS_BY_TARGET

    event = sorted(EVENTS_BY_TARGET[target_type])[0]
    with pytest.raises(ValidationError) as error:
        assign(
            scene["cue"],
            target_type=target_type,
            target_id=target_id,
            event=event,
            region=scene["region"],
        )
    assert why in str(error.value)


def test_chests_and_objects_need_a_3d_area_scope(scene):
    with pytest.raises(ValidationError) as error:
        assign(
            scene["cue"],
            target_type="chest",
            target_id=scene["chest"].entity_id,
            event="on_open",
            location=scene["place"],
        )
    assert "must be placed in a 3D Area" in str(error.value)


def test_an_object_of_this_area_is_a_valid_target(scene):
    placement = WorldObjectPlacement.objects.filter(region=scene["region"]).first()
    assert placement is not None
    assign(
        scene["cue"],
        target_type="object",
        target_id=placement.entity_id,
        event="on_interact",
        region=scene["region"],
    )


def test_a_scope_sound_needs_a_scope_and_no_target_id(scene):
    with pytest.raises(ValidationError):
        assign(scene["cue"], target_type="scope", target_id="", event="on_enter")
    with pytest.raises(ValidationError):
        assign(
            scene["cue"],
            target_type="scope",
            target_id="x",
            event="on_enter",
            region=scene["region"],
        )
    with pytest.raises(IntegrityError), transaction.atomic():
        SoundAssignment.objects.create(
            cue=scene["cue"], target_type="adventure", target_id="", event="on_enter"
        )


def test_only_one_scope_may_be_set(scene):
    with pytest.raises(ValidationError):
        assign(scene["cue"], event="on_enter", region=scene["region"], location=scene["place"])
    with pytest.raises(IntegrityError), transaction.atomic():
        SoundAssignment.objects.create(
            cue=scene["cue"],
            target_type="scope",
            event="on_enter",
            region=scene["region"],
            location=scene["place"],
        )


def test_a_quest_must_belong_to_the_scopes_island(scene):
    from apps.catalog.models import Quest

    quest = Quest.objects.filter(world__isnull=False).first()
    other = World.objects.exclude(pk=quest.world_id).first()
    assert quest is not None and other is not None
    ok = assign(
        scene["cue"],
        target_type="quest",
        target_id=quest.slug,
        event="on_complete",
        world=quest.world,
    )
    assert ok.pk
    with pytest.raises(ValidationError) as error:
        assign(
            scene["cue"], target_type="quest", target_id=quest.slug, event="on_enter", world=other
        )
    assert "does not belong to this Island" in str(error.value)


def test_an_adventure_must_belong_to_the_scopes_place(scene):
    from apps.catalog.models import Adventure

    adventure = Adventure.objects.filter(location=scene["place"]).first()
    foreign = (
        Adventure.objects.exclude(location=scene["place"]).exclude(location__isnull=True).first()
    )
    assert adventure is not None and foreign is not None
    assert assign(
        scene["cue"],
        target_type="adventure",
        target_id=adventure.slug,
        event="on_complete",
        location=scene["place"],
    ).pk
    with pytest.raises(ValidationError) as error:
        assign(
            scene["cue"],
            target_type="adventure",
            target_id=foreign.slug,
            event="on_enter",
            location=scene["place"],
        )
    assert "does not belong to this Place" in str(error.value)


def test_the_same_slot_cannot_be_assigned_twice_even_with_no_scope(scene):
    other = cue("sfx.chest.slam")
    first = assign(scene["cue"], target_type="reward", target_id=_any_reward(), event="on_collect")
    assert first.pk
    with pytest.raises(IntegrityError), transaction.atomic():
        SoundAssignment.objects.create(
            cue=other, target_type="reward", target_id=_any_reward(), event="on_collect"
        )


def _any_reward():
    from apps.catalog.models import RewardRule

    return RewardRule.objects.first().rule_id


def test_a_cue_with_assignments_cannot_be_deleted(scene):
    assign(scene["cue"], event="on_enter", region=scene["region"])
    with pytest.raises(Exception, match="protected|PROTECT|Cannot delete"):
        scene["cue"].delete()


def test_one_slot_holds_one_cue_per_channel(scene):
    music_asset, _ = audio_asset("cove-theme", category="music", seconds=2)
    music = cue("music.cove.explore", music_asset)
    ambient = cue("ambient.cove.waves", audio_asset("cove-waves", seconds=3)[0])
    second_music = cue("music.cove.alt", music_asset)
    assign(music, event="on_enter", region=scene["region"])
    assign(ambient, event="on_enter", region=scene["region"])  # another channel: allowed
    with pytest.raises(IntegrityError), transaction.atomic():
        SoundAssignment.objects.create(
            cue=second_music, target_type="scope", event="on_enter", region=scene["region"]
        )
    with pytest.raises(ValidationError):
        assign(second_music, event="on_enter", region=scene["region"])


def test_a_cues_channel_cannot_change_after_it_is_created():
    obj = cue("sfx.coin.collect")
    obj.channel = "ui"
    with pytest.raises(ValidationError):
        obj.save()
