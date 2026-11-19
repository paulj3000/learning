"""The scoring decision, as pure functions (GE-102, GE-105, GE-107). No database, no clock.

`decide(rules, fact)` is the whole economy: which awards a fact earns under a policy's rules.
Everything that could be tuned into a compulsion loop is absent by construction: there is no
randomness, no multiplier, no time factor, no streak, no penalty input (a fact is always
something the child accomplished, so there is nothing to subtract for), and no repeatable
award (the idempotency key is built from the fact's stable source, so a replay pays nothing).

Stacking (GE-107), explicitly:

- Rules are grouped by `(stacking_group, currency)`. A rule with no group is its own group.
- Within a group exactly one rule applies: the most specific selector (exact ref, then the
  longest prefix, then match-anything), then the highest priority, then the lowest rule key.
- Different groups stack: a quest can earn XP from "quest-completion" and coins from
  "quest-coins", and a special quest's exact-ref rule replaces the general rule in the same
  group instead of adding to it.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from .contracts import (
    MINIMUM_AUTHORITATIVE_TRUST,
    Currency,
    ScoringFact,
    SourceKind,
    Trust,
    idempotency_key,
)

MAX_AMOUNT = 10_000


@dataclass(frozen=True)
class RuleSpec:
    rule_key: str
    source_kind: SourceKind
    currency: Currency
    amount: int
    selector: str = ""
    """'' matches every ref; 'abc' only that ref; 'abc*' every ref starting with 'abc'."""
    stacking_group: str = ""
    priority: int = 0
    minimum_trust: Trust = Trust.SERVER_BOUNDED
    attribute_equals: dict = field(default_factory=dict, hash=False, compare=False)
    """Every listed fact attribute must equal the given value (e.g. itemCategory KEEPSAKE)."""

    @property
    def group(self) -> str:
        return self.stacking_group or f"rule:{self.rule_key}"


@dataclass(frozen=True)
class AwardDecision:
    rule_key: str
    currency: Currency
    amount: int
    stacking_group: str
    idempotency_key: str


class InvalidRule(ValueError):
    pass


def rule_problems(rule: RuleSpec) -> list[str]:
    """Every reason a rule cannot be part of a policy. Admin refuses a policy with any."""
    problems = []
    if not 1 <= rule.amount <= MAX_AMOUNT:
        problems.append(f"{rule.rule_key}: amount must be between 1 and {MAX_AMOUNT}")
    if rule.minimum_trust < MINIMUM_AUTHORITATIVE_TRUST:
        problems.append(f"{rule.rule_key}: client-reported events can never award")
    if "*" in rule.selector[:-1]:
        problems.append(f"{rule.rule_key}: '*' is allowed only at the end of a selector")
    if rule.currency == Currency.STAR and rule.source_kind != SourceKind.ADVENTURE_STAR:
        problems.append(f"{rule.rule_key}: stars come only from ADVENTURE_STAR")
    return problems


def specificity(selector: str, ref: str) -> int | None:
    """None when the selector does not match; otherwise higher is more specific."""
    if selector == "":
        return 0
    if selector.endswith("*"):
        prefix = selector[:-1]
        return 1 + len(prefix) if ref.startswith(prefix) else None
    return 10_000 if selector == ref else None


def _matches(rule: RuleSpec, fact: ScoringFact) -> int | None:
    if rule.source_kind != fact.source_kind:
        return None
    floor = max(rule.minimum_trust, MINIMUM_AUTHORITATIVE_TRUST)
    if fact.trust < floor:
        return None
    for name, value in rule.attribute_equals.items():
        if fact.attributes.get(name) != value:
            return None
    return specificity(rule.selector, fact.source_ref)


def decide(rules: Iterable[RuleSpec], fact: ScoringFact) -> list[AwardDecision]:
    """The awards `fact` earns under `rules`, in a stable order. Empty when none apply."""
    best: dict[tuple[str, Currency], tuple[tuple, RuleSpec]] = {}
    for rule in rules:
        score = _matches(rule, fact)
        if score is None:
            continue
        rank = (score, rule.priority, _reverse(rule.rule_key))
        slot = (rule.group, rule.currency)
        if slot not in best or rank > best[slot][0]:
            best[slot] = (rank, rule)
    decisions = [
        AwardDecision(
            rule_key=rule.rule_key,
            currency=rule.currency,
            amount=rule.amount,
            stacking_group=group,
            idempotency_key=idempotency_key(
                fact.source_kind, fact.source_ref, rule.currency, group
            ),
        )
        for (group, _), (_, rule) in best.items()
    ]
    return sorted(decisions, key=lambda d: (d.currency, d.stacking_group))


def _reverse(text: str) -> tuple[int, ...]:
    """Sorts so that a *lower* rule key ranks higher, keeping `max` deterministic."""
    return tuple(-ord(ch) for ch in text)


# --- Levels (GE-105) ------------------------------------------------------------------------------


@dataclass(frozen=True)
class LevelProgress:
    level: int
    xp: int
    level_floor_xp: int
    next_level_xp: int | None
    """None at the top level: there is always a last level, never an endless treadmill."""


def threshold_problems(thresholds: Sequence[int]) -> list[str]:
    if not thresholds:
        return ["level thresholds: at least one is needed (the first must be 0)"]
    problems = []
    if thresholds[0] != 0:
        problems.append("level thresholds: the first must be 0 (every child starts at level 1)")
    if any(not isinstance(t, int) or isinstance(t, bool) or t < 0 for t in thresholds):
        problems.append("level thresholds: whole numbers of 0 or more")
    elif any(b <= a for a, b in zip(thresholds, thresholds[1:], strict=False)):
        problems.append("level thresholds: each must be larger than the one before")
    return problems


def level_for(xp: int, thresholds: Sequence[int]) -> LevelProgress:
    """Levels only rise: XP never decreases for anything a child does (corrections are staff
    defect repairs and the projection floors them at zero)."""
    xp = max(0, xp)
    level = 0
    for threshold in thresholds:
        if xp >= threshold:
            level += 1
        else:
            break
    level = max(1, level)
    floor = thresholds[level - 1] if thresholds else 0
    nxt = thresholds[level] if level < len(thresholds) else None
    return LevelProgress(level=level, xp=xp, level_floor_xp=floor, next_level_xp=nxt)


# --- Stars (GE-106) -------------------------------------------------------------------------------

MAX_STARS = 3


def stars_for(goals_met: int, goals_total: int) -> int:
    """Exploration stars for a 3D Area: what fraction of its authored goals (puzzles, chests,
    pickups) the child has done, as 0 to 3. Never about speed, hints, attempts or falls."""
    if goals_total <= 0:
        return 0
    met = min(max(goals_met, 0), goals_total)
    if met == goals_total:
        return MAX_STARS
    return min(MAX_STARS - 1, (MAX_STARS * met) // goals_total)
