"""Golden-vector parity for the Python adventure engine (LAI-0601).

Every case in `adventure-engine.json` was produced by the TypeScript engine; the Python port
must give the same result, or raise where TypeScript throws.
"""

import pytest
from golden_vectors import assert_case, case_id, cases

from apps.adventures import engine

SUITE = "adventure-engine"
PORTS = {
    "validateStepAnswer": engine.validate_step_answer,
    "getNextStepId": engine.next_step_id,
    "nextHintLevel": engine.next_hint_level,
    "decideSubmission": engine.decide_submission,
    "isStepAnswer": engine.is_step_answer,
    "getHintText": engine.hint_text,
}


def test_every_function_in_the_suite_has_a_python_port():
    from golden_vectors import load_suite

    assert set(load_suite(SUITE)["functions"]) == set(PORTS)


@pytest.mark.parametrize(
    ("function", "case"),
    [(name, case) for name in PORTS for case in cases(SUITE, name)],
    ids=lambda value: value if isinstance(value, str) else case_id(value),
)
def test_python_matches_typescript(function, case):
    assert_case(case, lambda inputs: PORTS[function](**inputs))
