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
