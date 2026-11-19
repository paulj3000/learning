"""LAI-JMP-02 / LAI-JMP-04: platforming layout checks and staff tuning (`apps/regions/platforming.py`)."""

import pytest

from apps.catalog import authoring
from apps.regions import platforming

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

COURSE = {
    "platforms": [
        {
            "id": "ferry",
            "size": {"width": 2, "height": 0.5, "depth": 2},
            "position": {"x": 0, "y": 0, "z": 0},
            "motion": {"path": [{"x": 4, "y": 0, "z": 0}], "speed": 1.5},
        },
        {
            "id": "pad",
            "size": {"width": 2, "height": 0.3, "depth": 2},
            "position": {"x": 5, "y": 0, "z": 5},
            "bounce": {"height": 2},
        },
    ],
    "checkpoints": [{"id": "start", "x": -3, "z": 0, "label": "the beach"}],
}


def test_layout_problems_accept_a_forgiving_course_and_refuse_unsafe_ones():
    assert platforming.layout_problems(COURSE, bounds={"halfExtentX": 30, "halfExtentZ": 30}) == []
    bad = {
        "platforms": [
            {"id": "Bad Id", "size": {"width": 0.3, "height": 0.5, "depth": 2}, "position": {"x": 99, "y": 0, "z": 0}},
            {
                "id": "zoom",
                "size": {"width": 2, "height": 0.5, "depth": 2},
                "position": {"x": 0, "y": 0, "z": 0},
                "motion": {"path": [], "speed": 9},
                "activation": {"trigger": "PLATE", "source": "nope"},
            },
        ],
        "hazards": [{"id": "sea", "rect": {}}],
    }
    problems = " ".join(platforming.layout_problems(bad, bounds={"halfExtentX": 30, "halfExtentZ": 30}))
    for expected in (
        "platforms[0].id",
        "platforms[0].size",
        "platforms[0].position: must be inside",
        "platforms[1].motion.path",
        "platforms[1].motion.speed",
        "platforms[1].activation.source",
        "needs a checkpoint",
    ):
        assert expected in problems


def test_layout_problems_check_the_recovery_lead():
    bounds = {"halfExtentX": 30, "halfExtentZ": 30}
    assert platforming.layout_problems({**COURSE, "recoveryLead": "Whoa, the lava is too hot!"}, bounds=bounds) == []
    for lead in ("  ", "x" * 81, 7):
        problems = platforming.layout_problems({**COURSE, "recoveryLead": lead}, bounds=bounds)
        assert any("recoveryLead" in p for p in problems), lead


def test_layout_problems_check_per_hazard_recovery_leads():
    bounds = {"halfExtentX": 40, "halfExtentZ": 40}
    ok = {**COURSE, "recoveryLeads": {"fh-summit-rocks-1": "Bonk! A rock got you."}}
    assert platforming.layout_problems(ok, bounds=bounds) == []
    for leads in ({"rocks": "  "}, {"rocks": "x" * 81}, {"Bad Id": "Fine words"}, ["not", "a", "map"]):
        problems = platforming.layout_problems({**COURSE, "recoveryLeads": leads}, bounds=bounds)
        assert any("recoveryLeads" in p for p in problems), leads


def test_tuning_problems_name_unknown_platforms_settings_and_ranges():
    scene = {"platforming": COURSE}
    assert platforming.tuning_problems(scene, {"ferry": {"speed": 2, "pauseSeconds": 1}}) == []
    problems = platforming.tuning_problems(
        scene,
        {"ghost": {}, "ferry": {"speed": 99, "colour": 1, "enabled": "yes"}, "pad": {"bounceHeight": 0.1}},
    )
    assert any("ghost: no platform" in p for p in problems)
    assert any("ferry.speed" in p for p in problems)
    assert any("unknown settings colour" in p for p in problems)
    assert any("ferry.enabled" in p for p in problems)
    assert any("pad.bounceHeight" in p for p in problems)


def test_staff_tune_platforms_through_the_area_content_revision(treasure):
    region = treasure.region
    region.scene = {**region.scene, "platforming": COURSE}
    region.save()
    kind = authoring.kind_for(region)
    body = authoring.current_body(region)
    assert body["platformTuning"] == {}

    body["platformTuning"] = {"ferry": {"speed": 2.5, "pauseSeconds": 2}, "pad": {"enabled": False}}
    assert authoring.validate(region, body) == []
    problems: list[str] = []
    finish = kind.apply(region, body, problems)
    assert problems == []
    finish()
    region.refresh_from_db()
    assert region.scene["platformTuning"]["ferry"] == {"speed": 2.5, "pauseSeconds": 2}
    # The layout itself is untouched: positions stay seed-authored (LAI-0805).
    assert region.scene["platforming"] == COURSE

    body["platformTuning"] = {"ferry": {"speed": 50}}
    assert any("ferry.speed" in p for p in authoring.validate(region, body))


def test_an_area_without_platforms_offers_no_tuning(treasure):
    region = treasure.region
    scene = {k: v for k, v in region.scene.items() if k not in ("platforming", "platformTuning")}
    region.scene = scene
    region.save()
    body = authoring.current_body(region)
    assert "platformTuning" not in body
    body["platformTuning"] = {}
    assert any("unknown keys platformTuning" in p for p in authoring.validate(region, body))


ENGINE_BRIDGE = {
    "capabilities": [
        {"id": "gameplay.hazards", "config": {}},
        {
            "id": "gameplay.platforms",
            "config": {
                "platforms": [
                    {"id": "plank-lift", "position": {"x": 0, "y": 1, "z": 0}, "size": {"x": 3, "y": 0.4, "z": 3}},
                    {"id": "crumble.one", "position": {"x": 9, "y": 1, "z": 0}, "size": {"x": 3, "y": 0.4, "z": 3}},
                    {"x": "not a platform"},
                ]
            },
        },
    ],
    "allowEnginePlatforms": True,
}


def test_engine_platform_ids_come_from_the_bridge_platforms_capability():
    assert platforming.engine_platform_ids({"engineBridge": ENGINE_BRIDGE}) == ["plank-lift", "crumble.one"]
    for odd in (
        {},
        {"engineBridge": "x"},
        {"engineBridge": {"capabilities": "x"}},
        {"engineBridge": {"capabilities": [{"id": "gameplay.platforms", "config": []}, 3]}},
    ):
        assert platforming.engine_platform_ids(odd) == []


def test_tuning_accepts_engine_platform_ids_and_live_ids_together_without_duplicates():
    scene = {"platforming": COURSE, "engineBridge": ENGINE_BRIDGE}
    assert platforming.platform_ids(scene) == ["ferry", "pad", "plank-lift", "crumble.one"]
    assert platforming.platform_ids({"platforming": COURSE}) == ["ferry", "pad"]  # existing data unchanged
    body = {
        "ferry": {"speed": 2},
        "plank-lift": {"speed": 3, "pauseSeconds": 1},
        "crumble.one": {"visibleSeconds": 5, "enabled": False},
    }
    assert platforming.tuning_problems(scene, body) == []
    assert platforming.tuning_problems({"engineBridge": ENGINE_BRIDGE}, {"plank-lift": {"speed": 2}}) == []


def test_tuning_for_engine_platforms_is_still_checked_for_ids_and_ranges():
    scene = {"engineBridge": ENGINE_BRIDGE}
    problems = platforming.tuning_problems(
        scene, {"ghost": {}, "plank-lift": {"speed": 99}, "crumble.one": {"hiddenSeconds": 0.1}}
    )
    assert any("ghost: no platform" in p for p in problems)
    assert any("plank-lift.speed" in p for p in problems)
    assert any("crumble.one.hiddenSeconds" in p for p in problems)


def test_staff_tune_an_area_whose_platforms_run_in_the_engine(treasure):
    region = treasure.region
    scene = {k: v for k, v in region.scene.items() if k not in ("platforming", "platformTuning")}
    region.scene = {**scene, "engineBridge": ENGINE_BRIDGE}
    region.save()
    kind = authoring.kind_for(region)
    body = authoring.current_body(region)
    assert body["platformTuning"] == {}
    body["platformTuning"] = {"plank-lift": {"speed": 2.5}}
    assert authoring.validate(region, body) == []
    problems: list[str] = []
    finish = kind.apply(region, body, problems)
    assert problems == []
    finish()
    region.refresh_from_db()
    assert region.scene["platformTuning"] == {"plank-lift": {"speed": 2.5}}
    assert region.scene["engineBridge"] == ENGINE_BRIDGE
    body["platformTuning"] = {"ghost": {"speed": 2}}
    assert any("ghost: no platform" in p for p in authoring.validate(region, body))
