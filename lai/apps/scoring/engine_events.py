"""Django side of the Game Engine Core's gameplay event contract v1 (GE-108, GE-104).

`game/src/contracts/gameplayEvents.ts` (`lai.gameplay-event`, v1) is the source of truth; this
module mirrors its validator exactly, and both are tested against the same golden vectors,
`tests/golden/gameplay-events-v1.json`. A change there is a change here, in the same commit
series, and the golden file is what tells them apart if they drift.

Every event is a claim. `classify` says what Django does with one:

- `SERVER_RECORD`: Django already holds (or will write, through its own play route) the record
  this claim describes; scoring derives from that record, never from the claim.
- `DEFERRED`: only the client knows it happened (jump challenges, platform courses). Nothing
  authoritative follows until there is a server-checkable source (TRUST_BOUNDARY.md).
- `INFORMATIONAL`: never scored (presented questions, starts, checkpoints, the alternative
  route notice, NPC talk). `jump.alternative.used` is informational *only*: the alternative
  route earns exactly what the jump route earns.

There is deliberately no HTTP route that stores claims yet: every SERVER_RECORD claim is
already recorded by its own play route, and storing DEFERRED client claims is a new kind of
child data that needs a retention decision first (docs/scoring/TRUST_BOUNDARY.md section 4).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from .contracts import SourceKind

SCHEMA = "lai.gameplay-event"
VERSION = 1
SEMANTIC_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
EVENT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{7,63}$")
ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$")

ID, ID_OR_NULL, LEARNING_REF, COUNT = "id", "idOrNull", "learningRef", "count"

PAYLOAD_RULES: dict[str, dict[str, str]] = {
    "learning.question.presented": {"learningRef": LEARNING_REF},
    "learning.answer.submitted": {"learningRef": LEARNING_REF, "choiceId": ID_OR_NULL},
    "exploration.area.entered": {"areaId": ID},
    "exploration.discovery.found": {"discoveryId": ID},
    "collectible.collected": {"collectibleId": ID, "setId": ID_OR_NULL},
    "jump.challenge.started": {"challengeId": ID},
    "jump.challenge.completed": {"challengeId": ID, "routeId": ID},
    "jump.alternative.used": {"challengeId": ID, "routeId": ID},
    "course.checkpoint.reached": {"courseId": ID, "checkpointId": ID},
    "course.completed": {"courseId": ID, "goalId": ID},
    "puzzle.completed": {"puzzleId": ID},
    "npc.interaction.completed": {"npcId": ID, "interactionId": ID},
    "quest.step.completed": {"questId": ID, "stepId": ID},
    "quest.completed": {"questId": ID},
    "adventure.started": {},
    "adventure.completed": {},
    "realm.milestone.reached": {"milestoneId": ID},
}
#: Optional payload fields (additive v1 changes): may be absent; when present, checked as listed.
OPTIONAL_PAYLOAD_RULES: dict[str, dict[str, str]] = {
    # The placement's pickup change key, so a pending pickup matches its server record exactly.
    "collectible.collected": {"pickupKey": ID_OR_NULL},
    # Hints opened before answering (issue #102); absent means unknown. Evidence only: the solve
    # route caps it at the band's hint count and it never changes what is earned.
    "learning.answer.submitted": {"hintsUsed": COUNT},
}
LEARNING_REF_FIELDS = {
    "ADVENTURE_STEP": ("stepId",),
    "CHEST_CHALLENGE": ("chestEntityId", "challengeAttemptId"),
    "AREA_PUZZLE": ("puzzleId", "challengeAttemptId"),
    "QUESTION_ITEM": ("questionId", "challengeAttemptId"),
}
ENVELOPE_KEYS = {
    "schema",
    "version",
    "type",
    "eventId",
    "occurredAt",
    "sessionRef",
    "realmId",
    "adventureId",
    "areaId",
    "payload",
}


@dataclass(frozen=True)
class Issue:
    path: str
    message: str


def _is_record(value) -> bool:
    return isinstance(value, dict)


def _check_id(value, path: str, issues: list[Issue], nullable: bool = False) -> None:
    if value is None and nullable:
        return
    if not isinstance(value, str) or not SEMANTIC_ID.match(value):
        issues.append(
            Issue(path, "must be a semantic id or null" if nullable else "must be a semantic id")
        )


def _check_count(value, path: str, issues: list[Issue]) -> None:
    # bool is an int in Python; JSON true is not a count.
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        issues.append(Issue(path, "must be a non-negative integer"))


def _check_strict(value: dict, allowed, path: str, issues: list[Issue]) -> None:
    allowed = set(allowed)
    for key in value:
        if key not in allowed:
            issues.append(Issue(f"{path}.{key}" if path else key, "is not part of the v1 contract"))


def _check_learning_ref(value, path: str, issues: list[Issue]) -> None:
    if not _is_record(value):
        issues.append(Issue(path, "must be an object"))
        return
    kind = value.get("kind")
    if not isinstance(kind, str) or kind not in LEARNING_REF_FIELDS:
        issues.append(Issue(f"{path}.kind", "must be a learning ref kind"))
        return
    fields = LEARNING_REF_FIELDS[kind]
    _check_strict(value, ("kind", *fields), path, issues)
    for name in fields:
        _check_id(value.get(name), f"{path}.{name}", issues)


def _valid_timestamp(value) -> bool:
    if not isinstance(value, str) or not ISO_UTC.match(value):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def validate(event) -> list[Issue]:
    """Every problem with an untrusted v1 event; empty when valid. Never raises."""
    if not _is_record(event):
        return [Issue("", "must be an object")]
    issues: list[Issue] = []
    _check_strict(event, ENVELOPE_KEYS, "", issues)
    if event.get("schema") != SCHEMA:
        issues.append(Issue("schema", f'must be "{SCHEMA}"'))
    version = event.get("version")
    if isinstance(version, bool) or version != VERSION:
        issues.append(Issue("version", f"must be {VERSION}"))
    event_id = event.get("eventId")
    if not isinstance(event_id, str) or not EVENT_ID.match(event_id):
        issues.append(Issue("eventId", "must be 8 to 64 letters, digits or hyphens"))
    if not _valid_timestamp(event.get("occurredAt")):
        issues.append(Issue("occurredAt", "must be an ISO 8601 UTC timestamp ending in Z"))
    session_ref = event.get("sessionRef")
    if session_ref is not None and (
        not isinstance(session_ref, str) or not UUID.match(session_ref)
    ):
        issues.append(Issue("sessionRef", "must be a UUID or null"))
    _check_id(event.get("realmId"), "realmId", issues)
    _check_id(event.get("adventureId"), "adventureId", issues)
    _check_id(event.get("areaId"), "areaId", issues, nullable=True)

    kind = event.get("type")
    payload = event.get("payload")
    if not isinstance(kind, str) or kind not in PAYLOAD_RULES:
        issues.append(Issue("type", "is not a v1 gameplay event type"))
    elif not _is_record(payload):
        issues.append(Issue("payload", "must be an object"))
    else:
        rules = PAYLOAD_RULES[kind]
        optional = OPTIONAL_PAYLOAD_RULES.get(kind, {})
        _check_strict(payload, {**rules, **optional}, "payload", issues)
        for name, rule in optional.items():
            if name not in payload:
                continue
            if rule == COUNT:
                _check_count(payload[name], f"payload.{name}", issues)
            else:
                _check_id(payload[name], f"payload.{name}", issues, nullable=rule == ID_OR_NULL)
        for name, rule in rules.items():
            path = f"payload.{name}"
            if name not in payload:
                issues.append(Issue(path, "is required"))
            elif rule == LEARNING_REF:
                _check_learning_ref(payload[name], path, issues)
            else:
                _check_id(payload[name], path, issues, nullable=rule == ID_OR_NULL)
    return issues


class Disposition(StrEnum):
    SERVER_RECORD = "SERVER_RECORD"
    DEFERRED = "DEFERRED"
    INFORMATIONAL = "INFORMATIONAL"


@dataclass(frozen=True)
class Classification:
    disposition: Disposition
    source_kind: SourceKind | None = None
    source_ref_hint: str = ""
    """The ref the server record would carry, for matching a pending notification. A hint, not
    a key: the award key comes from the server record."""


_SERVER_RECORD = {
    "exploration.area.entered": (SourceKind.LOCATION_FIRST_VISIT, lambda e, p: p["areaId"]),
    "exploration.discovery.found": (SourceKind.SECRET_DISCOVERED, lambda e, p: p["discoveryId"]),
    "collectible.collected": (
        SourceKind.PICKUP_COLLECTED,
        lambda e, p: f"{e.get('areaId') or ''}/{p.get('pickupKey') or p['collectibleId']}",
    ),
    "puzzle.completed": (
        SourceKind.PUZZLE_SOLVED,
        lambda e, p: f"{e.get('areaId') or ''}/{p['puzzleId']}",
    ),
    "quest.completed": (SourceKind.QUEST_COMPLETED, lambda e, p: p["questId"]),
    "adventure.completed": (SourceKind.ADVENTURE_COMPLETED, lambda e, p: e["adventureId"]),
    "realm.milestone.reached": (SourceKind.REALM_MILESTONE, lambda e, p: p["milestoneId"]),
    "learning.answer.submitted": (None, lambda e, p: ""),
}
_DEFERRED = {
    "jump.challenge.completed": (SourceKind.JUMP_CHALLENGE, lambda e, p: p["challengeId"]),
    "course.completed": (SourceKind.PLATFORM_COURSE, lambda e, p: p["courseId"]),
}


def classify(event: dict) -> Classification:
    """What Django does with a *valid* v1 claim (call `validate` first)."""
    kind = event["type"]
    payload = event["payload"]
    if kind in _SERVER_RECORD:
        source, ref = _SERVER_RECORD[kind]
        return Classification(Disposition.SERVER_RECORD, source, ref(event, payload))
    if kind in _DEFERRED:
        source, ref = _DEFERRED[kind]
        return Classification(Disposition.DEFERRED, source, ref(event, payload))
    return Classification(Disposition.INFORMATIONAL)
