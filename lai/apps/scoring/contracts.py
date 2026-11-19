"""Scoring contracts (GE-101). The shared, frozen vocabulary of the scoring engine.

Everything another branch may rely on is in this module, and only here: currencies, source
kinds, trust tiers, the fact shape collectors produce, and the idempotency key. A change to any
of it is a contract change and goes back through GE-101 (docs/engineering/multi-agent-workflow.md,
"Splitting a larger feature into work packages"). The narrative contract, with the API shapes, is
docs/scoring/SCORING_CONTRACTS.md.

The model in one paragraph: a child's awards are *derived*, never claimed. Collectors read
records that Django already wrote after deciding something itself (a graded answer, a solved
puzzle, a finished quest) and turn each into a `ScoringFact`. The active `ScoringPolicy` turns
facts into awards. The ledger stores each award once, under a key built from the fact's source,
so a replay, a retry, a second tab, a backfill or a later policy version can never pay twice.
Nothing the client sends is an amount.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from enum import IntEnum, StrEnum
from uuid import UUID

CONTRACT_VERSION = 1


class Currency(StrEnum):
    """What an award is counted in. Each is a separate total; none converts into another.

    None can be spent, bought, traded, lost or taken away: there is no sink and no shop
    (GE-107). `STAR` is counted per adventure scope (GE-106).
    """

    XP = "XP"
    LEARNING_POINTS = "LEARNING_POINTS"
    COINS = "COINS"
    STAR = "STAR"


class SourceKind(StrEnum):
    """What the child did. `source_ref` is always a stable authored id, never a row id, so the
    same accomplishment has the same key in every session (that is the replay rule)."""

    ANSWER_CORRECT = "ANSWER_CORRECT"
    """A step answer the adventure engine graded CORRECT. ref: `<adventure-slug>/<step-id>`."""
    LEARNING_CHALLENGE = "LEARNING_CHALLENGE"
    """A chest challenge answered correctly (not a REPLAY chest). ref: `<region>/<chest-entity>`."""
    MASTERY_MILESTONE = "MASTERY_MILESTONE"
    """A learning objective first reaching PROFICIENT or MASTERED. ref: `<objective>/<status>`."""
    LOCATION_FIRST_VISIT = "LOCATION_FIRST_VISIT"
    """The first session in a published 3D Area. ref: `<region-id>`."""
    SECRET_DISCOVERED = "SECRET_DISCOVERED"  # noqa: S105 - a source kind, not a secret
    """A discovery whose requirements the server checked. ref: `<discovery-id>`."""
    PICKUP_COLLECTED = "PICKUP_COLLECTED"
    """An authored pickup placement (e.g. a treasure coin). ref: `<region>/<pickup-change-key>`."""
    PUZZLE_SOLVED = "PUZZLE_SOLVED"
    """A 3D Area puzzle solved. ref: `<region>/<puzzle-id>`."""
    QUEST_COMPLETED = "QUEST_COMPLETED"
    """ref: `<quest-slug>`."""
    ADVENTURE_COMPLETED = "ADVENTURE_COMPLETED"
    """A step-based adventure finished through graded steps. ref: `<adventure-slug>`."""
    REALM_MILESTONE = "REALM_MILESTONE"
    """Every active quest of a world (Island) completed. ref: `<world-slug>`."""
    REWARD_RULE_GRANTED = "REWARD_RULE_GRANTED"
    """An existing catalog RewardRule fired for the child (GrantedRule). ref: `<rule-id>`.
    The compatibility adapter for every realm's achievements, keepsakes and set completions."""
    ADVENTURE_STAR = "ADVENTURE_STAR"
    """The n-th exploration star of a 3D Area. ref: `<region-id>/<n>`."""
    JUMP_CHALLENGE = "JUMP_CHALLENGE"
    """Deferred: client-reported only, so never authoritative today. ref: `<challenge-id>`."""
    PLATFORM_COURSE = "PLATFORM_COURSE"
    """Deferred: client-reported only, so never authoritative today. ref: `<course-id>`."""


class Trust(IntEnum):
    """How much the server itself established. Ordered: a rule's minimum is a floor.

    - SERVER_GRADED: Django decided the outcome (graded an answer, checked requirements).
    - SERVER_BOUNDED: the child's claim is accepted, but only for an authored, published thing,
      once per child, from a finite set (a pickup tap, a client-saved quest state). The worst a
      forged claim can do is earn a bounded, already-authored award early.
    - CLIENT_REPORTED: only the client says it happened (a jump, a course). Never authoritative:
      no policy can award on it (`MINIMUM_AUTHORITATIVE_TRUST`). Recorded nowhere until the
      engine contract gives the server something to check (docs/scoring/TRUST_BOUNDARY.md).
    """

    CLIENT_REPORTED = 0
    SERVER_BOUNDED = 1
    SERVER_GRADED = 2


MINIMUM_AUTHORITATIVE_TRUST = Trust.SERVER_BOUNDED
"""No policy, setting or rule can lower this. Enforced in `rules.decide`, not by convention."""


class EntryKind(StrEnum):
    AWARD = "AWARD"
    """Always positive. Written only by the reconciler from a fact."""
    CORRECTION = "CORRECTION"
    """A staff compensating entry for a defect, referencing the entry it corrects. Never used
    because of anything the child did: a wrong answer, a hint or a fall costs nothing."""


@dataclass(frozen=True)
class ScoringFact:
    """One thing the child accomplished, as a collector derived it from server records."""

    source_kind: SourceKind
    source_ref: str
    trust: Trust
    occurred_at: datetime
    scope_key: str = ""
    """The adventure scope it belongs to (a region id or adventure slug); used for stars and
    personal bests. Empty when the fact belongs to no single adventure."""
    session_id: UUID | None = None
    """The child's own AdventureSession that produced it, when there is one."""
    attributes: dict = field(default_factory=dict, compare=False, hash=False)
    """Facts about the fact a selector may read (e.g. `{"itemCategory": "KEEPSAKE"}`). Never
    child free text and never an amount."""


KEY_PREFIX = f"v{CONTRACT_VERSION}"
MAX_KEY_LENGTH = 200


def idempotency_key(
    source_kind: SourceKind, source_ref: str, currency: Currency, stacking_group: str
) -> str:
    """The ledger's uniqueness key: one award per source, currency and stacking group.

    It deliberately leaves out the policy version and the rule: when the owner retunes values
    in a new policy version, everything already earned stays earned once, and nothing is paid
    again. Long refs are hashed so the key fits; the readable parts stay readable.
    """
    key = f"{KEY_PREFIX}|{source_kind}|{source_ref}|{currency}|{stacking_group}"
    if len(key) <= MAX_KEY_LENGTH:
        return key
    digest = hashlib.sha256(source_ref.encode()).hexdigest()[:32]
    return f"{KEY_PREFIX}|{source_kind}|#{digest}|{currency}|{stacking_group}"
