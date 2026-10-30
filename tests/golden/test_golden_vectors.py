"""Format checks for the golden vectors (LAI-0303), from the Python side.

The Vitest test proves the files match the TypeScript rules; this proves Python can read every
file and that each case is usable by a port. Rule tests arrive with each Phase 6 port.
"""

import json

import pytest
from golden_vectors import ROOT, SCHEMA_VERSION, cases, load_suite, snake_case, suite_names

EXPECTED_SUITES = [
    "adventure-engine",
    "director",
    "director-content",
    "mastery",
    "quests",
    "rewards",
]


def test_every_suite_is_present():
    assert suite_names() == EXPECTED_SUITES


@pytest.mark.parametrize("name", EXPECTED_SUITES)
def test_suite_is_well_formed(name):
    suite = load_suite(name)
    assert suite["schemaVersion"] == SCHEMA_VERSION
    assert suite["suite"] == name
    assert suite["sources"]
    for function, vectors in suite["functions"].items():
        assert vectors["python"].isidentifier() and vectors["python"].islower(), function
        names = [case["name"] for case in vectors["cases"]]
        assert names and len(names) == len(set(names)), f"{function}: case names must be unique"
        for case in vectors["cases"]:
            assert set(case["input"]) <= set(vectors["args"]), f"{function}: {case['name']}"
            assert ("expected" in case) != ("throws" in case), f"{function}: {case['name']}"


def test_cases_map_inputs_to_snake_case_keyword_arguments():
    first = cases("mastery", "nextSkillProgressCounts")[0]
    assert set(first["input"]) == {"existing", "correctness", "support_level", "now"}
    assert snake_case("prerequisitesSatisfied") == "prerequisites_satisfied"


def test_content_bound_suite_matches_the_content_export():
    manifest = json.loads((ROOT / "content" / "exported" / "manifest.json").read_text())
    assert load_suite("director-content")["contentDigest"] == manifest["contentDigest"]
