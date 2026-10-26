"""Golden-vector parity for the Python discovery rules (LAI-0605)."""

import pytest
from golden_vectors import assert_case, case_id, cases, load_suite

from apps.progression import discovery_rules

SUITE = "discovery"
PORTS = {
    "isDiscoveryOpen": discovery_rules.is_discovery_open,
    "resolveDiscovery": discovery_rules.resolve_discovery,
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
