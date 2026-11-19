"""Realm compatibility adapters (GE-109): 3D adventures, courses and realms as data.

Most of every realm is already read by the core collectors: chests, pickups, puzzles, quests,
discoveries and granted reward rules. Two things are not in any server row as such, so they
are declared here, as data, never as realm-specific code:

1. Which quests prove that a 3D adventure (or a platform course) was completed.
2. Which adventures make up a realm, for the realm milestone.

Secret discoveries need no table: a pickup that grants an item authored `hidden` is a secret
(`collectors.secret_pickups`).

**Proof, not trust in a status.** A quest's status can be reached with world changes the client
may post (`POST world-changes/`; quest objectives of kind BUILD are satisfied by a change key).
So an adventure or course counts only when its quests are COMPLETED *and* every BUILD key they
name is backed by a server-owned record: a correctly answered chest challenge, a solved Area
puzzle, or an authored pickup collected through the play API. A forged world change proves
nothing here. Jumps themselves are never a source (docs/scoring/TRUST_BOUNDARY.md section 3).

Sources: docs/firepeak/SCORING_INTEGRATION_AUDIT.md (feature/firepeak-volcano-adventure
3e2b513c), docs/engine/TREASURE_RUSH_SCORING_INVENTORY.md (feature/treasure-rush-palm-trees
6818f74b). Storykeeper Castle needs no entry: its adventures are step adventures (core
`adventures` collector) and its discoveries are server-checked (core `discoveries`).
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from enum import StrEnum

from apps.education.challenges import Correctness as ChallengeCorrectness
from apps.game_sessions.models import ChallengeAttempt, PuzzleAttempt
from apps.progression.models import WorldChange
from apps.quests.models import QuestProgress, QuestStatus
from apps.regions.models import WorldObjectPlacement

from .contracts import ScoringFact, SourceKind, Trust


class Completion(StrEnum):
    ADVENTURE = "ADVENTURE"
    COURSE = "COURSE"


@dataclass(frozen=True)
class RealmAdventure:
    realm: str
    """The realm (Island, `World.slug`) it belongs to."""
    ref: str
    """The award's source ref: a stable authored id (the 3D Area or course id)."""
    quests: tuple[str, ...]
    """Every quest that must be completed, with proven BUILD objectives."""
    scope_key: str
    """The 3D Area its awards are grouped under (per-adventure results, personal bests)."""
    kind: Completion = Completion.ADVENTURE


REALM_ADVENTURES: tuple[RealmAdventure, ...] = (
    RealmAdventure(
        "learning-adventure-island",
        "treasure-cove",
        ("pips-missing-treasure",),
        "treasure-rush-cove",
    ),
    # Pirate's Leap is a platform course, completed by the server-graded crow's nest chest at
    # its goal (quest `pirates-leap`). Both the jump and the walking route reach it.
    RealmAdventure(
        "learning-adventure-island",
        "pirates-leap",
        ("pirates-leap",),
        "treasure-rush-cove",
        Completion.COURSE,
    ),
    RealmAdventure(
        "learning-adventure-island",
        "firepeak-volcano",
        ("the-volcano-awakens",),
        "firepeak-volcano",
    ),
    RealmAdventure(
        "learning-adventure-island",
        "firepeak-heart",
        ("the-heart-of-firepeak",),
        "firepeak-heart",
    ),
    RealmAdventure(
        "north-pole",
        "north-pole-village",
        tuple(
            f"np-q0{n}-{name}"
            for n, name in enumerate(
                (
                    "welcome",
                    "toy-workshop",
                    "candy-cane-forest",
                    "frozen-lake",
                    "missing-reindeer",
                    "gingerbread-mystery",
                    "snowflake-mountain",
                    "restore-the-star",
                    "christmas-eve",
                ),
                start=1,
            )
        ),
        "north-pole-village",
    ),
)


def proven_change_keys(child) -> set[str]:
    """World-change keys backed by a server-owned record for this child. Never a bare world
    change: each key here comes from an attempt the server graded or a pickup it recorded."""
    keys: set[str] = set()
    chests = (
        ChallengeAttempt.objects.for_child(child)
        .filter(correctness=ChallengeCorrectness.CORRECT.value, chest__isnull=False)
        .values_list("chest__world_change_key", flat=True)
    )
    keys.update(k for k in chests if k)
    puzzles = (
        PuzzleAttempt.objects.for_child(child)
        .filter(correct=True, area_puzzle__isnull=False)
        .values_list("area_puzzle__world_change_key", flat=True)
    )
    keys.update(k for k in puzzles if k)
    authored = set(
        WorldObjectPlacement.objects.exclude(pickup_change_key="").values_list(
            "pickup_change_key", flat=True
        )
    )
    collected = WorldChange.objects.for_child(child).filter(
        change_type="COLLECTIBLE_FOUND", change_key__in=authored
    )
    keys.update(collected.values_list("change_key", flat=True))
    return keys


def build_keys(quest_source: dict) -> set[str]:
    """The change keys a quest's BUILD objectives require (its stages, as authored)."""
    return {
        objective["changeKey"]
        for stage in (quest_source or {}).get("stages", [])
        for objective in stage.get("objectives", [])
        if objective.get("kind") == "BUILD" and objective.get("changeKey")
    }


def _proven_completions(child, adventures) -> Iterator[tuple[RealmAdventure, object]]:
    wanted = {slug for adventure in adventures for slug in adventure.quests}
    done = {
        row.quest.slug: row
        for row in QuestProgress.objects.for_child(child)
        .filter(status=QuestStatus.COMPLETED, quest__slug__in=wanted)
        .select_related("quest")
    }
    if not done:
        return
    proven = proven_change_keys(child)
    for adventure in adventures:
        rows = [done.get(slug) for slug in adventure.quests]
        if any(row is None for row in rows):
            continue
        if not all(build_keys(row.quest.source) <= proven for row in rows):
            continue
        yield adventure, max(row.completed_at or row.last_updated_at for row in rows)


def realm_adventures(child) -> Iterator[ScoringFact]:
    """ADVENTURE_COMPLETED and PLATFORM_COURSE facts for 3D adventures and courses, plus a
    REALM_MILESTONE when every listed adventure of a realm is proven complete."""
    finished: dict[str, list] = {}
    for adventure, at in _proven_completions(child, REALM_ADVENTURES):
        kind = (
            SourceKind.PLATFORM_COURSE
            if adventure.kind is Completion.COURSE
            else SourceKind.ADVENTURE_COMPLETED
        )
        finished.setdefault(adventure.realm, []).append(at)
        yield ScoringFact(
            kind,
            adventure.ref,
            Trust.SERVER_BOUNDED,
            at,
            scope_key=adventure.scope_key,
            attributes={"realm": adventure.realm},
        )
    for realm, times in sorted(finished.items()):
        members = [a for a in REALM_ADVENTURES if a.realm == realm]
        if len(times) == len(members):
            # The same ref as the core world-based milestone, so the two can never pay twice.
            yield ScoringFact(SourceKind.REALM_MILESTONE, realm, Trust.SERVER_BOUNDED, max(times))
