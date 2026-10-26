"""Golden-vector parity for the Python reward resolution (LAI-0604).

Every case in `rewards.json` was produced by the TypeScript Reward Engine; the Python port must
give the same result.
"""

import pytest
from golden_vectors import assert_case, case_id, cases, load_suite

from apps.inventory import rewards

SUITE = "rewards"
PORTS = {
    "resolveRewards": rewards.resolve_rewards,
    "rewardedItemIds": rewards.rewarded_item_ids,
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
