"""Workstream D: behaviour release validation per type (LAI-NPC-019, LAI-NPC-025)."""

from __future__ import annotations

import pytest

from apps.npcs.behaviors import runtime_parameters
from apps.npcs.validation import behavior
from apps.npcs.validation.behavior import behavior_problems


def published(behavior_type: str, **parameters) -> list[str]:
    return behavior_problems(behavior_type, runtime_parameters(behavior_type, parameters))


VALID = {
    "stationary": {"facePlayer": False},
    "wander": {"radius": 4, "speed": 1, "pauseSeconds": [1, 2]},
    "patrol": {"waypoints": [{"x": 3, "z": 0, "pauseSeconds": 2}, {"x": 0, "z": 3}], "speed": 1},
    "follow": {"stopDistance": 2, "speed": 3, "giveUpDistance": 20},
    "guide": {"waypoints": [{"x": 5, "z": 5}], "speed": 1.5, "waitForPlayerDistance": 4},
    "reactive": {"reactions": {"treasure.found": "celebrate"}},
    "scripted": {
        "steps": [
            {"action": "moveTo", "x": 2, "z": 0},
            {"action": "play", "state": "wave"},
            {"action": "wait", "seconds": 1},
            {"action": "face", "yaw": 1.5},
        ],
        "loop": False,
    },
}


@pytest.mark.parametrize("behavior_type", sorted(VALID))
def test_each_type_accepts_valid_parameters(behavior_type):
    assert published(behavior_type, **VALID[behavior_type]) == []


@pytest.mark.parametrize(
    ("behavior_type", "parameters", "fragment"),
    [
        ("stationary", {"facePlayer": "yes"}, "facePlayer must be true or false"),
        ("stationary", {"speed": 1}, "not used by stationary: speed"),
        ("wander", {"speed": 1}, "wander needs: radius"),
        ("wander", {"radius": 4, "speed": 1, "pauseSeconds": [3, 1]}, "min must not exceed max"),
        ("patrol", {"waypoints": [{"x": 1, "z": 1}], "speed": 1}, "waypoints: list 2 to 32"),
        ("patrol", {"waypoints": [{"x": 1}, {"x": 0, "z": 0}], "speed": 1}, "z must be a number"),
        ("follow", {"stopDistance": 0, "speed": 1}, "stopDistance must be a number"),
        ("guide", {"waypoints": [], "speed": 1}, "waypoints: list 1 to 32"),
        ("reactive", {"reactions": {"made.up": "wave"}}, "unknown adventure event"),
        ("reactive", {"reactions": {"answer.correct": "fly"}}, "unknown animation state"),
        ("scripted", {"steps": [{"action": "teleport"}]}, "one of moveTo"),
        ("scripted", {"steps": [{"action": "play", "state": "fly"}]}, "animation state"),
    ],
)
def test_each_type_reports_schema_problems(behavior_type, parameters, fragment):
    found = published(behavior_type, **parameters)
    assert any(fragment in problem for problem in found), found


def test_waypoints_and_moves_outside_bounds_are_reported():
    patrol = published(
        "patrol",
        boundsRadius=5,
        speed=1,
        waypoints=[{"x": 3, "z": 0}, {"x": 6, "z": 8}],
    )
    assert patrol == ["waypoints[1] (6, 8) is 10.0 m from the placement, outside boundsRadius 5 m"]
    scripted = published(
        "scripted",
        boundsRadius=2,
        steps=[{"action": "wait", "seconds": 1}, {"action": "moveTo", "x": 0, "z": -3}],
    )
    assert scripted == ["steps[1] (0, -3) is 3.0 m from the placement, outside boundsRadius 2 m"]
    guide = published("guide", speed=1, waypoints=[{"x": 20, "z": 0}])
    assert len(guide) == 1 and "boundsRadius 15 m" in guide[0]


def test_type_specific_geometry():
    assert published("wander", radius=8, speed=1, boundsRadius=5) == [
        "wander radius 8 m is larger than boundsRadius 5 m"
    ]
    assert published("follow", stopDistance=8, speed=1, giveUpDistance=6) == [
        "follow stopDistance 8 m must be smaller than giveUpDistance 6 m"
    ]
    found = published(
        "guide", speed=1, boundsRadius=2, waitForPlayerDistance=5, waypoints=[{"x": 1, "z": 0}]
    )
    assert found == [
        "guide waitForPlayerDistance 5 m is larger than the bounds circle (4 m across), "
        "so the guide would never wait"
    ]


def test_geometry_waits_for_a_well_formed_schema():
    found = published("patrol", speed="fast", waypoints=[{"x": 99, "z": 0}, {"x": 0, "z": 0}])
    assert not any("outside boundsRadius" in problem for problem in found)


def test_problems_checks_each_used_behaviour_once_from_the_snapshot():
    snapshot = {
        "placements": [
            {"placementKey": "a", "behavior": "walk-far"},
            {"placementKey": "b", "behavior": "walk-far"},
            {"placementKey": "c", "behavior": None},
            {"placementKey": "d", "behavior": "missing"},
        ],
        "behaviors": {
            "walk-far": {
                "type": "patrol",
                "parameters": runtime_parameters(
                    "patrol",
                    {"speed": 1, "waypoints": [{"x": 0, "z": 0}, {"x": 40, "z": 0}]},
                ),
            },
            "unused": {"type": "wander", "parameters": {"speed": 1}},
        },
    }
    assert behavior.problems(snapshot) == [
        "behaviour walk-far: waypoints[1] (40, 0) is 40.0 m from the placement, outside "
        "boundsRadius 15 m"
    ]
    assert behavior.problems({}) == []


@pytest.mark.django_db
def test_release_validation_refuses_an_out_of_bounds_patrol():
    from apps.npcs.publishing.snapshot import build_snapshot
    from apps.npcs.tests.helpers import make_behavior, make_character, make_placement
    from apps.npcs.validation import release_problems

    profile = make_behavior(
        "far-patrol",
        "patrol",
        speed=1,
        boundsRadius=3,
        waypoints=[{"x": 0, "z": 0}, {"x": 5, "z": 0}],
    )
    make_placement(make_character(), "spot", behavior=profile)
    found = release_problems(build_snapshot())
    assert any(p.startswith("behaviour far-patrol: waypoints[1]") for p in found), found
