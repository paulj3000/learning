"""SM-P7-07: staff-configured positional audio and audio zones, validated and published."""

import pytest
from django.core.exceptions import ValidationError

from apps.audio import services
from apps.audio.models import SoundAssignment, SoundCue
from apps.audio.targets import assignment_problems, region_zone_ids
from apps.audio.tests.helpers import assign, audio_asset, cue

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def spatial_cue(cue_id="sfx.chest.open", **fields):
    asset, _ = audio_asset(cue_id.replace(".", "-").replace("_", "-"))
    obj = SoundCue(cue_id=cue_id, name=cue_id, channel=cue_id.split(".")[0], asset=asset, **fields)
    return obj


def errors(obj):
    with pytest.raises(ValidationError) as caught:
        obj.full_clean()
    return caught.value.message_dict


class TestValidation:
    def test_a_cue_is_flat_unless_staff_choose_positional(self):
        obj = spatial_cue()
        obj.full_clean()
        assert obj.spatial_manifest() is None

    def test_positional_with_sensible_distances_is_valid_and_published_as_data(self):
        obj = spatial_cue(
            spatial_mode="on",
            spatial_ref_distance=2,
            spatial_max_distance=25,
            spatial_rolloff=1.5,
            spatial_distance_model="inverse",
        )
        obj.full_clean()
        assert obj.spatial_manifest() == {
            "enabled": True,
            "refDistance": 2.0,
            "maxDistance": 25.0,
            "rolloffFactor": 1.5,
            "distanceModel": "inverse",
        }

    def test_never_positional_publishes_enabled_false_only(self):
        assert spatial_cue(spatial_mode="off").spatial_manifest() == {"enabled": False}

    @pytest.mark.parametrize(
        ("fields", "field"),
        [
            ({"spatial_ref_distance": 0}, "spatial_ref_distance"),
            ({"spatial_ref_distance": -3}, "spatial_ref_distance"),
            ({"spatial_max_distance": 0.05}, "spatial_max_distance"),
            ({"spatial_ref_distance": 30, "spatial_max_distance": 20}, "spatial_max_distance"),
            ({"spatial_ref_distance": 5, "spatial_max_distance": 5}, "spatial_max_distance"),
            ({"spatial_rolloff": -1}, "spatial_rolloff"),
            ({"spatial_rolloff": 99}, "spatial_rolloff"),
            ({"spatial_distance_model": "cubic"}, "spatial_distance_model"),
            ({"spatial_cone_inner": 400}, "spatial_cone_inner"),
            ({"spatial_cone_inner": 90, "spatial_cone_outer": 45}, "spatial_cone_outer"),
            ({"spatial_cone_outer_gain": 1.5}, "spatial_cone_outer_gain"),
            ({"spatial_cone_outer_gain": 0.5}, "spatial_cone_outer_gain"),
        ],
    )
    def test_invalid_numbers_and_combinations_are_refused(self, fields, field):
        assert field in errors(spatial_cue(spatial_mode="on", **fields))

    def test_distances_without_choosing_positional_are_refused(self):
        assert "spatial_ref_distance" in errors(spatial_cue(spatial_ref_distance=3))
        assert "spatial_max_distance" in errors(
            spatial_cue("sfx.chest.close", spatial_mode="off", spatial_max_distance=9)
        )

    def test_the_database_has_no_constraint_gap_for_unknown_modes(self):
        assert "spatial_mode" in errors(spatial_cue(spatial_mode="sideways"))


class TestPublishing:
    def test_the_manifest_carries_spatial_settings_and_priorities(self, treasure, api, cognito):
        region = treasure.region
        wind = spatial_cue(
            "ambient.treasure_rush.wind",
            spatial_mode="on",
            spatial_ref_distance=4,
            spatial_max_distance=40,
        )
        wind.full_clean()
        wind.save()
        flat = spatial_cue("sfx.chest.open", spatial_mode="off")
        flat.save()
        plain = cue("sfx.coin.collect")
        assign(
            wind,
            target_type="zone",
            target_id="cove-zone-grove",
            event="on_enter",
            region=region,
            priority=5,
        )
        assign(
            plain, target_type="zone", target_id="cove-zone-ruins", event="on_enter", region=region
        )
        flat.shared = True
        flat.save()
        services.publish(None)
        f = treasure.families
        body = (
            api(f.a)
            .get(f"/api/v1/children/{f.a1.pk}/audio/manifests/regions/{region.region_id}/")
            .json()
        )
        sounds = {s["id"]: s for s in body["sounds"]}
        assert sounds["ambient.treasure_rush.wind"]["spatial"] == {
            "enabled": True,
            "refDistance": 4.0,
            "maxDistance": 40.0,
        }
        assert sounds["sfx.chest.open"]["spatial"] == {"enabled": False}
        assert "spatial" not in sounds["sfx.coin.collect"]  # the game decides: key omitted
        by_target = {a["targetId"]: a for a in body["assignments"]}
        assert by_target["cove-zone-grove"]["priority"] == 5
        assert "priority" not in by_target["cove-zone-ruins"]  # zero is omitted

    def test_an_older_release_without_spatial_keys_still_builds_a_manifest(self, treasure):
        from apps.audio.manifest import build_manifest
        from apps.audio.models import SoundRelease

        chest = cue("sfx.chest.open", shared=True)
        release = services.publish(None)
        snapshot = release.snapshot
        for item in snapshot["cues"]:
            item.pop("spatial", None)
        for item in snapshot["assignments"]:
            item.pop("priority", None)
        SoundRelease.objects.filter(pk=release.pk).update(snapshot=snapshot)
        manifest = build_manifest("region", treasure.region.region_id, [("global", None)])
        assert [s["id"] for s in manifest["sounds"]] == [chest.cue_id]
        assert "spatial" not in manifest["sounds"][0]


class TestZones:
    def test_the_areas_layout_names_its_zones(self, treasure):
        zones = region_zone_ids(treasure.region)
        assert {
            "cove-zone-landing",
            "cove-zone-grove",
            "cove-zone-beach",
            "cove-zone-ruins",
        } <= zones

    def test_a_zone_assignment_needs_a_real_zone_in_a_3d_area(self, treasure):
        target = cue("ambient.treasure_rush.ocean")
        good = SoundAssignment(
            cue=target,
            target_type="zone",
            target_id="cove-zone-grove",
            event="on_enter",
            region=treasure.region,
        )
        assert assignment_problems(good) == []
        bad = SoundAssignment(
            cue=target,
            target_type="zone",
            target_id="cove-zone-nowhere",
            event="on_enter",
            region=treasure.region,
        )
        assert any("no audio zone" in p for p in assignment_problems(bad))
        no_area = SoundAssignment(
            cue=target, target_type="zone", target_id="cove-zone-grove", event="on_enter"
        )
        assert any("3D Area" in p for p in assignment_problems(no_area))

    def test_a_zone_can_enter_and_exit_but_not_open(self, treasure):
        target = cue("ambient.treasure_rush.ocean")
        wrong = SoundAssignment(
            cue=target,
            target_type="zone",
            target_id="cove-zone-grove",
            event="on_open",
            region=treasure.region,
        )
        assert any("cannot raise" in p for p in assignment_problems(wrong))

    def test_priority_is_bounded(self, treasure):
        target = cue("ambient.treasure_rush.ocean")
        obj = SoundAssignment(
            cue=target,
            target_type="zone",
            target_id="cove-zone-grove",
            event="on_enter",
            region=treasure.region,
            priority=101,
        )
        with pytest.raises(ValidationError) as caught:
            obj.full_clean()
        assert "priority" in caught.value.message_dict
