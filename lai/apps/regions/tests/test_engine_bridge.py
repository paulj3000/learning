"""The engine bridge block on a 3D Area's scene (GE-070, GE-065): shape checked before publish."""

import pytest

from apps.catalog.importer import import_content
from apps.regions.engine_bridge import engine_bridge_problems, scene_engine_bridge_problems
from apps.regions.models import WorldRegion
from apps.regions.publishing import area_problems
from apps.regions.treasure_rush_seed import REGION_ID, seed_treasure_rush

HAZARDS = {"id": "gameplay.hazards", "config": {"hazards": []}}


def test_a_well_formed_block_has_no_problems():
    assert engine_bridge_problems({"capabilities": [HAZARDS], "allowEnginePlatforms": False}) == []
    assert engine_bridge_problems({"capabilities": [{"id": "environment.volumes"}]}) == []
    assert engine_bridge_problems({}) == []  # nothing requested is allowed


@pytest.mark.parametrize(
    ("block", "expected"),
    [
        ([HAZARDS], "engineBridge: must be an object"),
        ("hazards", "engineBridge: must be an object"),
        ({"capabilities": HAZARDS}, "engineBridge.capabilities: must be a list of {id, config}"),
        ({"capabilities": ["gameplay.hazards"]}, "engineBridge.capabilities[0]: must be an object"),
        (
            {"capabilities": [{"config": {}}]},
            "engineBridge.capabilities[0].id: must be a capability id",
        ),
        (
            {"capabilities": [{"id": "has spaces"}]},
            "engineBridge.capabilities[0].id: must be a capability id",
        ),
        (
            {"capabilities": [{"id": "gameplay.hazards", "config": []}]},
            "engineBridge.capabilities[0].config: must be an object",
        ),
        (
            {"capabilities": [HAZARDS, HAZARDS]},
            "engineBridge.capabilities[1].id: gameplay.hazards is listed twice",
        ),
        (
            {"capabilities": [{"id": "gameplay.hazards", "tuning": 1}]},
            "engineBridge.capabilities[0]: unknown keys tuning",
        ),
        (
            {"allowEnginePlatforms": "yes"},
            "engineBridge.allowEnginePlatforms: must be true or false",
        ),
        ({"capabilities": [], "timer": 30}, "engineBridge: unknown keys timer"),
    ],
)
def test_malformed_blocks_are_refused_with_a_path(block, expected):
    assert any(problem.startswith(expected) for problem in engine_bridge_problems(block)), (
        engine_bridge_problems(block)
    )


@pytest.mark.parametrize("capability", ["movement.jump", "camera.thirdPerson", "character.avatar"])
def test_what_the_location_itself_runs_is_refused(capability):
    problems = engine_bridge_problems({"capabilities": [{"id": capability}]})
    assert problems == [
        f"engineBridge.capabilities[0].id: {capability} is run by the location itself "
        "(movement, camera and avatar), never by the engine bridge"
    ]


def test_a_scene_without_a_bridge_has_nothing_to_check():
    assert scene_engine_bridge_problems({}) == []
    assert scene_engine_bridge_problems({"platforming": {}}) == []
    assert scene_engine_bridge_problems(None) == []
    assert scene_engine_bridge_problems({"engineBridge": None}) == [
        "engineBridge: must be an object"
    ]


@pytest.mark.postgres
@pytest.mark.django_db
def test_publishing_refuses_a_malformed_bridge_and_accepts_a_good_one():
    import_content()
    seed_treasure_rush()
    region = WorldRegion.objects.get(region_id=REGION_ID)
    assert not any(problem.startswith("engineBridge") for problem in area_problems(region))

    region.scene = {**region.scene, "engineBridge": {"capabilities": [{"id": "movement.jump"}]}}
    region.save(update_fields=["scene"])
    assert any(
        problem.startswith("engineBridge.capabilities[0].id") for problem in area_problems(region)
    )

    region.scene = {**region.scene, "engineBridge": {"capabilities": [HAZARDS]}}
    region.save(update_fields=["scene"])
    assert not any(problem.startswith("engineBridge") for problem in area_problems(region))
