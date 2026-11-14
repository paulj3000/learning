"""The Adaptive Adventure Director on Django (AMP-05; ADR-016, docs/ROADMAP.md Phases 28 and 29).

A Python port of the Amplify `getNextLearningActivity` Lambda
(`amplify/functions/get-next-learning-activity/handler.ts`) and the pure TypeScript modules it
ran (`react/src/features/director/{select,needs,reachability}.ts`,
`react/src/features/worlds/travel.ts`, `react/src/features/mastery/summary.ts`). Same rules,
same constants, same wire shape; only the data source changed (canonical Django rows instead
of DynamoDB scans):

* candidates: active catalog `Adventure`s for the child's age band (the one hard filter), kept
  only where the child can sail to the adventure's world. A world is reachable when it is
  active, authored for the band, and its `travelRequirement` (the export's `islands.json`,
  kept in `World.source`) is met by one of the child's `WorldChange` keys. An adventure at a
  story-only place (no `Location` row) belongs to no world and is never filtered out.
* need: the child's `SkillProgress` counters through the mastery rules (`education.mastery`),
  prerequisites resolved recursively, review decay at read time. Status and skill id only
  (`MasterySummary`); counts, dates and error patterns never reach the ranking.
* ranking: need weight per practised skill, a completed penalty, a recent-play penalty over the
  three most recent sessions; ties break on title so the order is stable.

Deterministic for a given database state and `now`. No AI, no writes, no logging of child data.
`CONTINUES_STORY` stays in the wire vocabulary but is never produced, exactly as on Amplify
(its one caller never supplied a story lookup).
"""

from dataclasses import dataclass, field
from datetime import datetime

from django.utils import timezone

from apps.ai.tutor_content import SKILLS, get_skill
from apps.catalog.models import Adventure, World
from apps.game_sessions.models import AdventureSession, SessionKind, SessionStatus
from apps.progression.models import WorldChange

from . import mastery
from .models import SkillProgress, SkillStatus

# `react/src/features/director/types.ts` SKILL_NEED_WEIGHT.
SKILL_NEED_WEIGHT: dict[str, int] = {
    SkillStatus.LOCKED: 0,
    SkillStatus.INTRODUCED: 3,
    SkillStatus.DEVELOPING: 2,
    SkillStatus.PROFICIENT: 1,
    SkillStatus.MASTERED: 0,
}
# `react/src/features/director/select.ts`.
COMPLETED_PENALTY = 4
RECENT_PENALTY = 3
RECENT_WINDOW = 3
# `amplify/functions/get-next-learning-activity/handler.ts` `toResult`.
MAX_SUGGESTIONS = 3

REASON_KINDS = (
    "PRACTISES_SKILL",
    "CONTINUES_STORY",
    "ALREADY_COMPLETED",
    "PLAYED_RECENTLY",
    "NO_SKILLS_NEEDED",
)

# `content/exported/curriculum.json`: each skill's age bands, through its domain's grade
# (`listSkillsByAgeBand`). Pinned to the export by `tests/test_director.py`.
SKILL_AGE_BANDS: dict[str, frozenset[str]] = {
    "counting-sets": frozenset({"SPROUT", "PATHFINDER"}),
    "comparing-lengths": frozenset({"PATHFINDER", "EXPLORER"}),
    "addition-within-ten": frozenset({"PATHFINDER", "EXPLORER"}),
    "patterns": frozenset({"PATHFINDER", "EXPLORER"}),
    "measurement": frozenset({"PATHFINDER", "EXPLORER"}),
    "subtraction-within-ten": frozenset({"PATHFINDER", "EXPLORER"}),
    "multiplication-facts": frozenset({"EXPLORER"}),
    "observation": frozenset({"SPROUT", "PATHFINDER"}),
    "classification": frozenset({"SPROUT", "PATHFINDER"}),
    "cause-and-effect": frozenset({"SPROUT", "PATHFINDER"}),
    "animal-science": frozenset({"SPROUT", "PATHFINDER"}),
}


def skills_for_age_band(age_band: str) -> list[str]:
    """`listSkillsByAgeBand`: curriculum skill ids for the band, in export order."""
    return [s.id for s in SKILLS if age_band in SKILL_AGE_BANDS.get(s.id, frozenset())]


# --- pure rules -------------------------------------------------------------------------------


def resolve_skill_statuses(skill_ids: list[str], counts_by_skill: dict[str, dict]) -> dict:
    """`resolveSkillStatuses`: raw status per skill, prerequisites resolved recursively.

    "Known" for a prerequisite is PROFICIENT or MASTERED before decay. An unknown skill, or a
    prerequisite cycle, resolves to LOCKED.
    """
    resolved: dict[str, str] = {}
    resolving: set[str] = set()

    def resolve(skill_id: str) -> str:
        if skill_id in resolved:
            return resolved[skill_id]
        if skill_id in resolving:
            return SkillStatus.LOCKED
        skill = get_skill(skill_id)
        if skill is None:
            resolved[skill_id] = SkillStatus.LOCKED
            return SkillStatus.LOCKED
        resolving.add(skill_id)
        satisfied = all(
            resolve(p) in (SkillStatus.PROFICIENT, SkillStatus.MASTERED)
            for p in skill.prerequisite_skill_ids
        )
        resolving.discard(skill_id)
        counts = counts_by_skill.get(skill_id) or dict(mastery.ZERO_COUNTS)
        status = mastery.compute_skill_status(counts, satisfied)
        resolved[skill_id] = status
        return status

    for skill_id in skill_ids:
        resolve(skill_id)
    return resolved


def mastery_summaries(
    skill_ids: list[str], counts_by_skill: dict[str, dict], now: str
) -> list[tuple[str, str]]:
    """`buildMasterySummary`: `(skill_id, status)` after review decay. Nothing else."""
    raw = resolve_skill_statuses(skill_ids, counts_by_skill)
    summaries = []
    for skill_id in skill_ids:
        counts = counts_by_skill.get(skill_id) or mastery.ZERO_COUNTS
        status = mastery.apply_review_decay(raw[skill_id], counts["lastPracticedAt"], now)
        summaries.append((skill_id, str(status)))
    return summaries


def need_weights(summaries: list[tuple[str, str]]) -> dict[str, tuple[str, int]]:
    """`needWeightBySkillId`: skill id -> (status, weight), zero-weight skills dropped."""
    return {
        skill_id: (status, SKILL_NEED_WEIGHT[status])
        for skill_id, status in summaries
        if SKILL_NEED_WEIGHT.get(status, 0) > 0
    }


@dataclass(frozen=True)
class Candidate:
    slug: str
    title: str
    objective_ids: tuple[str, ...]  # distinct, in step order


@dataclass
class Suggestion:
    adventure_slug: str
    title: str
    score: int
    reasons: list[dict] = field(default_factory=list)


def _reason(kind: str, **values) -> dict:
    """The flattened wire reason (`flattenReason`): every field present, unused ones null."""
    reason = {
        "kind": kind,
        "skillId": None,
        "status": None,
        "weight": None,
        "storyId": None,
        "penalty": None,
    }
    reason.update(values)
    return reason


def score_adventure(
    candidate: Candidate,
    needs: dict[str, tuple[str, int]],
    completed_slugs: set[str],
    recent_slugs: list[str],
) -> Suggestion:
    """`scoreAdventure`: the score and every term that moved it."""
    score = 0
    reasons = []
    for objective_id in candidate.objective_ids:
        need = needs.get(objective_id)
        if need is None:
            continue
        status, weight = need
        score += weight
        reasons.append(
            _reason("PRACTISES_SKILL", skillId=objective_id, status=status, weight=weight)
        )
    if not reasons:
        reasons.append(_reason("NO_SKILLS_NEEDED"))
    if candidate.slug in completed_slugs:
        score -= COMPLETED_PENALTY
        reasons.append(_reason("ALREADY_COMPLETED", penalty=COMPLETED_PENALTY))
    if candidate.slug in recent_slugs[:RECENT_WINDOW]:
        score -= RECENT_PENALTY
        reasons.append(_reason("PLAYED_RECENTLY", penalty=RECENT_PENALTY))
    return Suggestion(candidate.slug, candidate.title, score, reasons)


def rank(
    candidates: list[Candidate],
    needs: dict[str, tuple[str, int]],
    completed_slugs: set[str],
    recent_slugs: list[str],
) -> list[Suggestion]:
    """`rankAdventures` (the age-band filter is already applied): best first, ties on title.

    TypeScript breaks ties with `localeCompare`; case-folded title then the title itself is the
    deterministic equivalent for the authored (ASCII) titles.
    """
    scored = [score_adventure(c, needs, completed_slugs, recent_slugs) for c in candidates]
    return sorted(scored, key=lambda s: (-s.score, s.title.casefold(), s.title))


def has_personalized_signal(ranking: list[Suggestion]) -> bool:
    """`hasSkillBasedSignal`: whether any record has a skill-based reason."""
    return any(r["kind"] == "PRACTISES_SKILL" for s in ranking for r in s.reasons)


def world_is_unlocked(world_source: dict | None, change_keys: set[str]) -> bool:
    """`isWorldUnlocked`: no requirement, or any one of its change keys recorded."""
    requirement = (world_source or {}).get("travelRequirement")
    if not requirement:
        return True
    return any(key in change_keys for key in requirement.get("anyOfChangeKeys") or [])


# --- database assembly ------------------------------------------------------------------------


def reachable_world_ids(age_band: str, change_keys: set[str]) -> set[int]:
    """`reachableWorldSlugs`, as primary keys."""
    return {
        world.pk
        for world in World.objects.filter(active=True, supported_age_bands__contains=[age_band])
        if world_is_unlocked(world.source, change_keys)
    }


def candidate_adventures(age_band: str, change_keys: set[str]) -> list[Candidate]:
    """Active adventures for the band at a reachable world, or at a story-only place."""
    reachable = reachable_world_ids(age_band, change_keys)
    adventures = (
        Adventure.objects.filter(active=True, age_bands__contains=[age_band])
        .select_related("location")
        .prefetch_related("steps")
    )
    candidates = []
    for adventure in adventures:
        if adventure.location is not None and adventure.location.world_id not in reachable:
            continue
        objective_ids: list[str] = []
        for step in sorted(adventure.steps.all(), key=lambda s: s.position):
            for objective_id in step.objective_ids:
                if objective_id not in objective_ids:
                    objective_ids.append(objective_id)
        candidates.append(Candidate(adventure.slug, adventure.title, tuple(objective_ids)))
    return candidates


def next_learning_activity(child, *, now: datetime | None = None) -> dict:
    """The child's top suggestions and whether they reflect actual skill practice.

    `{"suggestions": [{adventureSlug, title, score, reasons: [...]}], "hasPersonalizedSignal"}`,
    the `NextLearningActivityResult` shape the Amplify query returned.
    """
    now_iso = (now or timezone.now()).isoformat()
    change_keys = set(WorldChange.objects.for_child(child).values_list("change_key", flat=True))
    sessions = list(
        AdventureSession.objects.for_child(child)
        .filter(kind=SessionKind.ADVENTURE, adventure__isnull=False)
        .order_by("-last_activity_at", "-started_at")
        .values_list("adventure__slug", "status")
    )
    completed = {slug for slug, status in sessions if status == SessionStatus.COMPLETED}
    recent = [slug for slug, _ in sessions]

    skill_ids = skills_for_age_band(child.age_band)
    counts_by_skill = {
        row.learning_objective_code: mastery.counts_of(row)
        for row in SkillProgress.objects.for_child(child).filter(
            learning_objective_code__in=skill_ids
        )
    }
    needs = need_weights(mastery_summaries(skill_ids, counts_by_skill, now_iso))
    ranking = rank(candidate_adventures(child.age_band, change_keys), needs, completed, recent)
    return {
        "suggestions": [
            {
                "adventureSlug": s.adventure_slug,
                "title": s.title,
                "score": s.score,
                "reasons": s.reasons,
            }
            for s in ranking[:MAX_SUGGESTIONS]
        ],
        "hasPersonalizedSignal": has_personalized_signal(ranking),
    }
