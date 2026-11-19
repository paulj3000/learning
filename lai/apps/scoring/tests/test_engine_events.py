"""Parity with the Game Engine Core's gameplay event contract v1 (shared golden vectors)."""

import copy
import json
from pathlib import Path

import pytest

from apps.scoring import engine_events
from apps.scoring.contracts import SourceKind
from apps.scoring.engine_events import Disposition, classify, validate

GOLDEN = Path(__file__).resolve().parents[4] / "tests" / "golden" / "gameplay-events-v1.json"
VECTORS = json.loads(GOLDEN.read_text())


def test_the_golden_file_is_the_same_contract():
    assert VECTORS["schema"] == engine_events.SCHEMA
    assert VECTORS["version"] == engine_events.VERSION


@pytest.mark.parametrize("vector", VECTORS["valid"], ids=lambda v: v["name"])
def test_every_valid_vector_passes(vector):
    assert validate(vector["event"]) == []


@pytest.mark.parametrize("vector", VECTORS["invalid"], ids=lambda v: v["name"])
def test_every_invalid_vector_fails_on_its_path(vector):
    paths = {issue.path for issue in validate(vector["event"])}
    assert vector["issuePath"] in paths


def test_every_v1_type_is_covered_by_a_valid_vector():
    covered = {v["event"]["type"] for v in VECTORS["valid"]}
    assert covered == set(engine_events.PAYLOAD_RULES)


@pytest.mark.parametrize("value", [None, [], "event", 3])
def test_non_objects_are_rejected_without_raising(value):
    assert validate(value)


def _valid(kind):
    return copy.deepcopy(next(v["event"] for v in VECTORS["valid"] if v["event"]["type"] == kind))


def test_a_points_field_cannot_ride_along():
    event = _valid("quest.completed")
    event["payload"]["points"] = 100
    assert "payload.points" in {i.path for i in validate(event)}


def test_true_is_not_version_one():
    event = _valid("quest.completed")
    event["version"] = True
    assert "version" in {i.path for i in validate(event)}


def test_server_record_claims_name_the_source_kind_they_will_be_derived_from():
    result = classify(_valid("quest.completed"))
    assert result.disposition is Disposition.SERVER_RECORD
    assert result.source_kind is SourceKind.QUEST_COMPLETED


@pytest.mark.parametrize(
    ("kind", "source"),
    [
        ("jump.challenge.completed", SourceKind.JUMP_CHALLENGE),
        ("course.completed", SourceKind.PLATFORM_COURSE),
    ],
)
def test_client_only_claims_are_deferred(kind, source):
    result = classify(_valid(kind))
    assert result.disposition is Disposition.DEFERRED and result.source_kind is source


@pytest.mark.parametrize(
    "kind",
    [
        "jump.alternative.used",
        "jump.challenge.started",
        "course.checkpoint.reached",
        "learning.question.presented",
        "npc.interaction.completed",
        "adventure.started",
    ],
)
def test_informational_claims_are_never_scored(kind):
    assert classify(_valid(kind)).disposition is Disposition.INFORMATIONAL


def test_the_alternative_route_completes_the_same_challenge_as_the_jump():
    jump = _valid("jump.challenge.completed")
    alternative = copy.deepcopy(jump)
    alternative["payload"]["routeId"] = "ramp-route"
    assert validate(alternative) == []
    assert classify(alternative) == classify(jump)


def test_a_learning_answer_claim_never_carries_correctness():
    result = classify(_valid("learning.answer.submitted"))
    assert result.disposition is Disposition.SERVER_RECORD and result.source_kind is None
