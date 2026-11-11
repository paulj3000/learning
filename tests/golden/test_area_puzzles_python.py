"""Golden-vector parity for 3D Area puzzles (ADR-047 F, LAI-0812).

Every case in `area-puzzles.json` was produced by the client rules
(`react/src/features/region-play/areaPuzzles.ts`). The server graders in
`apps.regions.puzzles` must agree, or raise where TypeScript throws, so local feedback never
disagrees with the grade the server records.
"""

import pytest
from golden_vectors import assert_case, case_id, cases, load_suite

from apps.regions import puzzles
from apps.regions.models import PuzzleKind

SUITE = "area-puzzles"


def observe_solved(feature_ids, observed):
    params = {"features": [{"id": feature} for feature in feature_ids]}
    return puzzles.grade(PuzzleKind.OBSERVE_FEATURES, params, {"observed": observed})


def platforms_solved(stones, slots, placements):
    params = {"stones": stones, "slots": slots}
    return puzzles.grade(PuzzleKind.PLACE_PLATFORMS, params, {"placements": placements})


def simulate_valves(valves, start, sequence):
    if set(sequence) - {valve["id"] for valve in valves}:
        raise puzzles.InvalidSubmission
    return puzzles.simulate_valves({"valves": valves, "start": start}, sequence)


def solve_valves(valves, start, goal):
    return puzzles.solve_valves({"valves": valves, "start": start, "goal": goal})


PORTS = {
    "observeSolved": observe_solved,
    "platformsSolved": platforms_solved,
    "simulateValves": simulate_valves,
    "solveValves": solve_valves,
}


def test_every_function_in_the_suite_has_a_python_port():
    assert set(load_suite(SUITE)["functions"]) == set(PORTS)


@pytest.mark.parametrize(
    ("function", "case"),
    [(name, case) for name in PORTS for case in cases(SUITE, name)],
    ids=lambda value: value if isinstance(value, str) else case_id(value),
)
def test_python_matches_typescript(function, case):
    assert_case(case, lambda inputs: PORTS[function](**inputs))
