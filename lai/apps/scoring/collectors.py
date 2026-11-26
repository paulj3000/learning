"""Facts from server records (GE-104, GE-109). Read-only: no collector writes anything.

Each collector reads one kind of record that Django wrote *after deciding something itself*
and yields `ScoringFact`s. That is the trust boundary (docs/scoring/TRUST_BOUNDARY.md): the
client's word reaches scoring only through records the server already bounded, and the
trust tier on each fact says how much the server established.

What is deliberately *not* a source, and why:

- `WorldChange` rows on their own: `POST world-changes/` lets the client write any well-formed
  key, so a world change proves nothing alone. Chests and puzzles are read from their
  attempts; a pickup is accepted only when its key is an authored placement's pickup key.
- REGION sessions marked COMPLETED: the client may complete a region session.
- REPLAY chests (TR-20): practice only, never permanent.
- Story reflections: participation evidence, not a graded answer.
- Jumps, falls, respawns, course checkpoints: only the client knows them (deferred; see
  `JUMP_CHALLENGE` and `PLATFORM_COURSE` in contracts.py). Falls and respawns are never a
  source of anything, including penalties.

Realm apps add sources with `register_collector` (for example a seasonal completion once its
trigger is server-checked); the core collectors already cover every realm's chests, pickups,
puzzles, quests, discoveries and granted reward rules.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator

from django.conf import settings

from apps.catalog.models import Quest
from apps.core.content_status import ContentStatus
from apps.education.challenges import Correctness as ChallengeCorrectness
from apps.education.models import SkillProgress, SkillStatus
from apps.game_sessions.models import (
    AdventureAction,
    AdventureSession,
    ChallengeAttempt,
    Correctness,
    PuzzleAttempt,
    SessionKind,
    SessionStatus,
)
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import WorldChange, WorldState
from apps.quests.models import QuestProgress, QuestStatus
from apps.regions.models import (
    AreaPuzzle,
    ChestPresentation,
    PuzzleKind,
    TreasureChest,
    WorldObjectPlacement,
)

from . import rules
from .contracts import ScoringFact, SourceKind, Trust

Collector = Callable[[object], Iterable[ScoringFact]]

#: Puzzle kinds that accept the client's "I did it" for an authored puzzle, once
#: (`puzzles._no_answer`). Every other kind is graded against authored parameters, so a new kind
#: is graded by default (CHOOSE_ANSWER and ORDER_SEQUENCE were missing from the old allow-list;
#: issue #102 adds NAVIGATE_ROUTE, SORT_ITEMS and SHARE_ITEMS). Trust is not part of an
#: idempotency key and no shipped rule requires SERVER_GRADED, so this changes no award.
UNGRADED_PUZZLE_KINDS = {PuzzleKind.COLLECT_OBJECT, PuzzleKind.RETURN_TO_NPC}
GRADED_PUZZLE_KINDS = set(PuzzleKind.values) - UNGRADED_PUZZLE_KINDS
PICKUP_CHANGE_TYPE = "COLLECTIBLE_FOUND"
MILESTONE_STATUSES = (SkillStatus.PROFICIENT, SkillStatus.MASTERED)
DEFAULT_EXCLUDED_PREFIXES = ("playground", "dev-", "test-", "engine-playground")


def excluded_prefixes() -> tuple[str, ...]:
    """Scopes whose activity never earns real awards: the development playground and its kin
    (GE-100). Configurable, never empty of the defaults."""
    extra = tuple(getattr(settings, "LAI_SCORING_EXCLUDED_SCOPE_PREFIXES", ()) or ())
    return DEFAULT_EXCLUDED_PREFIXES + extra


def is_excluded(*keys: str) -> bool:
    prefixes = excluded_prefixes()
    return any(key and key.startswith(prefixes) for key in keys)


# --- Learning -------------------------------------------------------------------------------------


def answers(child) -> Iterator[ScoringFact]:
    """Step answers the adventure engine graded CORRECT (`submit_answer`), once per step.

    Every support level counts the same: a hint never lowers what an answer earns. The first
    correct answer is the one counted; an adventure replay finds the same key and pays nothing.
    """
    rows = (
        AdventureAction.objects.filter(
            session__child=child,
            session__kind=SessionKind.ADVENTURE,
            action_type="ANSWER",
            correctness=Correctness.CORRECT,
        )
        .select_related("session__adventure")
        .order_by("created_at")
    )
    for action in rows:
        slug = action.session.adventure.slug if action.session.adventure else ""
        if not slug or is_excluded(slug):
            continue
        yield ScoringFact(
            SourceKind.ANSWER_CORRECT,
            f"{slug}/{action.step_id}",
            Trust.SERVER_GRADED,
            action.created_at,
            scope_key=slug,
            session_id=action.session_id,
        )


def learning_challenges(child) -> Iterator[ScoringFact]:
    """Chest challenges (generated or from the Question Studio bank) answered correctly."""
    rows = (
        ChallengeAttempt.objects.for_child(child)
        .filter(correctness=ChallengeCorrectness.CORRECT.value, chest__isnull=False)
        .exclude(chest__presentation=ChestPresentation.REPLAY)
        .select_related("chest")
        .order_by("answered_at", "issued_at")
    )
    for attempt in rows:
        if is_excluded(attempt.region_id):
            continue
        yield ScoringFact(
            SourceKind.LEARNING_CHALLENGE,
            f"{attempt.region_id}/{attempt.chest.entity_id}",
            Trust.SERVER_GRADED,
            attempt.answered_at or attempt.issued_at,
            scope_key=attempt.region_id,
            session_id=attempt.session_id,
            attributes={"skillId": attempt.skill_id, "source": attempt.source},
        )


def mastery_milestones(child) -> Iterator[ScoringFact]:
    """An objective reaching PROFICIENT, and again MASTERED, from the shared mastery counters.

    A later review decay does not take a milestone back: it was reached, and is kept.
    MASTERED implies PROFICIENT was passed, so both are facts.
    """
    for progress in SkillProgress.objects.for_child(child).order_by("learning_objective_code"):
        level = progress.recent_level
        if level not in MILESTONE_STATUSES:
            continue
        reached = MILESTONE_STATUSES[: MILESTONE_STATUSES.index(level) + 1]
        for status in reached:
            yield ScoringFact(
                SourceKind.MASTERY_MILESTONE,
                f"{progress.learning_objective_code}/{status}",
                Trust.SERVER_GRADED,
                progress.last_practiced_at or child.created_at,
                attributes={"objective": progress.learning_objective_code},
            )


# --- Exploration ----------------------------------------------------------------------------------


def first_visits(child) -> Iterator[ScoringFact]:
    """The first session the child opened in each 3D Area (only published areas start one)."""
    seen: set[str] = set()
    rows = (
        AdventureSession.objects.for_child(child)
        .filter(kind=SessionKind.REGION)
        .exclude(region_id="")
        .order_by("started_at")
    )
    for session in rows:
        if session.region_id in seen or is_excluded(session.region_id, session.location_slug):
            continue
        seen.add(session.region_id)
        yield ScoringFact(
            SourceKind.LOCATION_FIRST_VISIT,
            session.region_id,
            Trust.SERVER_BOUNDED,
            session.started_at,
            scope_key=session.region_id,
            session_id=session.pk,
        )


def discoveries(child) -> Iterator[ScoringFact]:
    """Discoveries `progression.discoveries.record_discovery` accepted after checking their
    requirements. The only writer of `discovered_objects`."""
    state = WorldState.objects.for_child(child).first()
    if state is None:
        return
    for discovery_id in dict.fromkeys(state.discovered_objects):
        if is_excluded(discovery_id):
            continue
        yield ScoringFact(
            SourceKind.SECRET_DISCOVERED, discovery_id, Trust.SERVER_GRADED, state.updated_at
        )


def _category(categories: set[str]) -> str:
    """One category for a set of granted item categories: QUEST_ITEM wins (a functional item,
    such as a key, is never treated as treasure), then KEEPSAKE, then the alphabetical first."""
    for preferred in ("QUEST_ITEM", "KEEPSAKE"):
        if preferred in categories:
            return preferred
    return min(categories) if categories else ""


def _pickup_regions() -> dict[str, tuple[str, str, bool]]:
    """Authored pickup keys -> (region id, item category of what the pickup grants, whether it
    grants a `hidden` item). A key is unique to its placement in practice; the first region
    wins if an author ever reused one."""
    mapping: dict[str, tuple[str, str, bool]] = {}
    rows = (
        WorldObjectPlacement.objects.exclude(pickup_change_key="")
        .select_related("region", "pickup_reward_rule")
        .prefetch_related("pickup_reward_rule__items")
        .order_by("region__region_id", "entity_id")
    )
    for placement in rows:
        if not placement.is_pickup or placement.pickup_change_key in mapping:
            continue
        rule = placement.pickup_reward_rule
        items = list(rule.items.all()) if rule else []
        categories = {item.category for item in items}
        hidden = any(item.hidden for item in items)
        mapping[placement.pickup_change_key] = (
            placement.region.region_id,
            _category(categories),
            hidden,
        )
    return mapping


def pickups(child) -> Iterator[ScoringFact]:
    """Authored pickups (treasure coins, shells, ember shards). The server checks that the key
    is a real placement's and records it once; it cannot check the child walked there.

    `itemCategory` lets a policy pay coins for treasure only: a QUEST_ITEM pickup (the brass
    key that opens a chest) is functional, not treasure (Treasure Rush review, 2026-11-18)."""
    authored = _pickup_regions()
    rows = WorldChange.objects.for_child(child).filter(change_type=PICKUP_CHANGE_TYPE)
    for change in rows.order_by("created_at"):
        region_id, category, _ = authored.get(change.change_key, (None, "", False))
        if region_id is None or is_excluded(region_id):
            continue
        yield ScoringFact(
            SourceKind.PICKUP_COLLECTED,
            f"{region_id}/{change.change_key}",
            Trust.SERVER_BOUNDED,
            change.created_at,
            scope_key=region_id,
            attributes={"itemCategory": category},
        )


def secret_pickups(child) -> Iterator[ScoringFact]:
    """A pickup that grants an item authored `hidden` is a secret found (GE-109): Firepeak's
    hidden ember shards, North Pole's ornaments and golden bells. Content decides, not a realm
    table. It stacks with the pickup's own award: finding a secret is its own accomplishment."""
    authored = _pickup_regions()
    rows = WorldChange.objects.for_child(child).filter(change_type=PICKUP_CHANGE_TYPE)
    for change in rows.order_by("created_at"):
        region_id, _, hidden = authored.get(change.change_key, (None, "", False))
        if region_id is None or not hidden or is_excluded(region_id):
            continue
        yield ScoringFact(
            SourceKind.SECRET_DISCOVERED,
            f"{region_id}/{change.change_key}",
            Trust.SERVER_BOUNDED,
            change.created_at,
            scope_key=region_id,
        )


def puzzles(child) -> Iterator[ScoringFact]:
    seen: set[tuple[str, str]] = set()
    rows = (
        PuzzleAttempt.objects.for_child(child)
        .filter(correct=True)
        .select_related("area_puzzle")
        .order_by("submitted_at")
    )
    for attempt in rows:
        key = (attempt.region_id, attempt.puzzle_key)
        if key in seen or is_excluded(attempt.region_id):
            continue
        seen.add(key)
        kind = attempt.area_puzzle.kind if attempt.area_puzzle else ""
        yield ScoringFact(
            SourceKind.PUZZLE_SOLVED,
            f"{attempt.region_id}/{attempt.puzzle_key}",
            Trust.SERVER_GRADED if kind in GRADED_PUZZLE_KINDS else Trust.SERVER_BOUNDED,
            attempt.submitted_at,
            scope_key=attempt.region_id,
            session_id=attempt.session_id,
            attributes={"puzzleKind": kind},
        )


# --- Quests, adventures, realms -------------------------------------------------------------------


def quests(child) -> Iterator[ScoringFact]:
    """Completed, *active* quests. SERVER_BOUNDED: the quest state route checks stage and
    objective ids but not every objective's proof (see TRUST_BOUNDARY.md; the castle branch adds
    proofs). An inactive (legacy) quest that completes alongside a live one is not counted, so
    one accomplishment is not paid twice (Treasure Rush review, 2026-11-18)."""
    rows = (
        QuestProgress.objects.for_child(child)
        .filter(status=QuestStatus.COMPLETED, quest__active=True)
        .select_related("quest__world")
        .order_by("completed_at")
    )
    for progress in rows:
        slug = progress.quest.slug
        if is_excluded(slug):
            continue
        yield ScoringFact(
            SourceKind.QUEST_COMPLETED,
            slug,
            Trust.SERVER_BOUNDED,
            progress.completed_at or progress.last_updated_at,
            attributes={"world": progress.quest.world.slug if progress.quest.world else ""},
        )


def adventures(child) -> Iterator[ScoringFact]:
    """Step adventures finished through graded steps (`submit_answer` is the only route that
    completes an ADVENTURE session). Once per adventure, however often it is replayed."""
    seen: set[str] = set()
    rows = (
        AdventureSession.objects.for_child(child)
        .filter(kind=SessionKind.ADVENTURE, status=SessionStatus.COMPLETED)
        .select_related("adventure")
        .order_by("completed_at")
    )
    for session in rows:
        slug = session.adventure.slug if session.adventure else ""
        if not slug or slug in seen or is_excluded(slug):
            continue
        seen.add(slug)
        yield ScoringFact(
            SourceKind.ADVENTURE_COMPLETED,
            slug,
            Trust.SERVER_GRADED,
            session.completed_at or session.last_activity_at,
            scope_key=slug,
            session_id=session.pk,
        )


def realm_milestones(child) -> Iterator[ScoringFact]:
    """Every active quest of a world, for the child's age band, completed."""
    done = {
        row.quest_id: row
        for row in QuestProgress.objects.for_child(child).filter(status=QuestStatus.COMPLETED)
    }
    by_world: dict[str, list[Quest]] = {}
    for quest in Quest.objects.filter(active=True).select_related("world").order_by("slug"):
        if quest.world is None or child.age_band not in (quest.age_bands or []):
            continue
        by_world.setdefault(quest.world.slug, []).append(quest)
    for world_slug, world_quests in sorted(by_world.items()):
        if is_excluded(world_slug) or not all(q.pk in done for q in world_quests):
            continue
        finished = max(
            (done[q.pk].completed_at or done[q.pk].last_updated_at) for q in world_quests
        )
        yield ScoringFact(SourceKind.REALM_MILESTONE, world_slug, Trust.SERVER_BOUNDED, finished)


def granted_rules(child) -> Iterator[ScoringFact]:
    """Every existing RewardRule fired for the child: the compatibility adapter for each
    realm's keepsakes, badges, journal entries and set completions (FPV-18, TR-5)."""
    categories: dict[int, set[str]] = {}
    for item in InventoryItem.objects.for_child(child).select_related("item"):
        if item.source_rule_id:
            categories.setdefault(item.source_rule_id, set()).add(item.item.category)
    rows = GrantedRule.objects.for_child(child).select_related("rule").order_by("granted_at")
    for grant in rows:
        rule_id = grant.rule.rule_id
        if is_excluded(rule_id):
            continue
        trigger = grant.rule.trigger if isinstance(grant.rule.trigger, dict) else {}
        found = categories.get(grant.rule_id, set())
        yield ScoringFact(
            SourceKind.REWARD_RULE_GRANTED,
            rule_id,
            Trust.SERVER_BOUNDED,
            grant.granted_at,
            session_id=grant.source_session_id,
            attributes={
                "triggerType": trigger.get("type", ""),
                "itemCategory": "KEEPSAKE"
                if "KEEPSAKE" in found
                else (min(found) if found else ""),
            },
        )


# --- Stars (GE-106) -------------------------------------------------------------------------------


def _achieved(child) -> tuple[set, set, set]:
    """What the child has proven, for star goals: solved puzzles, opened chests, pickups."""
    solved = set(
        PuzzleAttempt.objects.for_child(child)
        .filter(correct=True)
        .values_list("region_id", "puzzle_key")
    )
    opened = {
        (a.region_id, a.chest.entity_id)
        for a in ChallengeAttempt.objects.for_child(child)
        .filter(correctness=ChallengeCorrectness.CORRECT.value, chest__isnull=False)
        .select_related("chest")
    }
    collected = set(
        WorldChange.objects.for_child(child)
        .filter(change_type=PICKUP_CHANGE_TYPE)
        .values_list("change_key", flat=True)
    )
    return solved, opened, collected


def _goals(region_id: str, solved: set, opened: set, collected: set) -> tuple[int, int]:
    """(goals met, goals total) for one 3D Area."""
    puzzle_changes = dict(
        AreaPuzzle.objects.filter(
            region__region_id=region_id, status=ContentStatus.PUBLISHED
        ).values_list("puzzle_id", "world_change_key")
    )
    chests = dict(
        TreasureChest.objects.filter(region__region_id=region_id)
        .exclude(presentation=ChestPresentation.REPLAY)
        .values_list("entity_id", "world_change_key")
    )
    # Issue #102: a puzzle that records a chest's world change key *opens* that chest, so the
    # two are one goal. It is met by the puzzle solved (new play) or by the chest opened through
    # its old challenge (a child who played before the puzzle replaced the gate).
    opened_by_key = {chests[c] for (r, c) in opened if r == region_id and c in chests}
    puzzle_keys = set(puzzle_changes.values())
    chest_keys = [c for c, key in chests.items() if key not in puzzle_keys]
    pickup_keys = [
        p.pickup_change_key
        for p in WorldObjectPlacement.objects.filter(region__region_id=region_id)
        if p.is_pickup
    ]
    total = len(puzzle_changes) + len(chest_keys) + len(pickup_keys)
    met = (
        sum((region_id, k) in solved or key in opened_by_key for k, key in puzzle_changes.items())
        + sum((region_id, k) in opened for k in chest_keys)
        + sum(k in collected for k in pickup_keys)
    )
    return met, total


def stars(child) -> Iterator[ScoringFact]:
    """Exploration stars per 3D Area: authored goals done (puzzles solved, learning chests
    opened, pickups collected) out of the goals the area has. A chest opened by a puzzle (the
    puzzle records the chest's world change key, issue #102) is one goal, not two. One fact per
    star, so a star once earned is in the ledger for good, even if an author later adds goals to
    the area."""
    regions = {
        s.region_id
        for s in AdventureSession.objects.for_child(child).filter(kind=SessionKind.REGION)
        if s.region_id
    }
    if not regions:
        return
    achieved = _achieved(child)
    for region_id in sorted(regions):
        if is_excluded(region_id):
            continue
        met, total = _goals(region_id, *achieved)
        for n in range(1, rules.stars_for(met, total) + 1):
            yield ScoringFact(
                SourceKind.ADVENTURE_STAR,
                f"{region_id}/{n}",
                Trust.SERVER_BOUNDED,
                _latest_activity(child, region_id),
                scope_key=region_id,
            )


def _latest_activity(child, region_id: str):
    session = (
        AdventureSession.objects.for_child(child)
        .filter(region_id=region_id)
        .order_by("-last_activity_at")
        .first()
    )
    return session.last_activity_at


# --- Registry -------------------------------------------------------------------------------------


def _realm_adventures(child) -> Iterator[ScoringFact]:
    from .realms import realm_adventures  # realms imports this module's neighbours only

    for fact in realm_adventures(child):
        if not is_excluded(fact.scope_key):
            yield fact


CORE_COLLECTORS: tuple[Collector, ...] = (
    answers,
    learning_challenges,
    mastery_milestones,
    first_visits,
    discoveries,
    pickups,
    secret_pickups,
    puzzles,
    quests,
    adventures,
    realm_milestones,
    granted_rules,
    stars,
    _realm_adventures,
)
_extra: list[Collector] = []


def register_collector(collector: Collector) -> None:
    """For a realm app's own server-verified source. Idempotent per function."""
    if collector not in _extra:
        _extra.append(collector)


def collect(child) -> list[ScoringFact]:
    facts: list[ScoringFact] = []
    for collector in (*CORE_COLLECTORS, *_extra):
        facts.extend(collector(child))
    return facts
