"""Golden-vector parity for the Python Mastery Engine rules (LAI-0603).

Every case in `mastery.json` was produced by the TypeScript rules; the Python port must give the
same result.
"""

import pytest
from golden_vectors import assert_case, case_id, cases, load_suite

from apps.education import mastery

SUITE = "mastery"
PORTS = {
    "nextSkillProgressCounts": mastery.next_skill_progress_counts,
    "computeSkillStatus": mastery.compute_skill_status,
    "computeErrorPattern": mastery.compute_error_pattern,
    "applyReviewDecay": mastery.apply_review_decay,
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
