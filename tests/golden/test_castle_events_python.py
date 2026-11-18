"""Golden-vector parity for the castle's ambient events (SC-R08-01).

Every case in `castle-events.json` was produced by the client rules
(`react/src/features/great-storybook/castleEvents.ts`). The server port in
`apps.regions.castle_events` must agree, so the fallback a client computes offline is the event
the server would have chosen without a model.
"""

import pytest
from golden_vectors import assert_case, case_id, cases, load_suite

from apps.regions import castle_events

SUITE = "castle-events"


def eligible_events(catalog, state):
    return [event["id"] for event in castle_events.eligible_events(catalog, state)]


def default_event(catalog, state):
    event = castle_events.default_event(catalog, state)
    return event["id"] if event else None


PORTS = {"eligibleEvents": eligible_events, "defaultEvent": default_event}


def test_every_function_in_the_suite_has_a_python_port():
    assert set(load_suite(SUITE)["functions"]) == set(PORTS)


@pytest.mark.parametrize(
    ("function", "case"),
    [(name, case) for name in PORTS for case in cases(SUITE, name)],
    ids=lambda value: value if isinstance(value, str) else case_id(value),
)
def test_python_matches_typescript(function, case):
    assert_case(case, lambda inputs: PORTS[function](**inputs))
