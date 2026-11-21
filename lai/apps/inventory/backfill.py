"""Backfill of the Storykeeper Castle keepsakes for historical completions (SC-R07-01 residual).

The three castle keepsake rules were added after some children had already finished what they
reward. Nothing replays a finished story or adventure, so those children never got the item. This
module grants it **through the existing rule and grant path** (`grant_reward_rule`), only on
server-authoritative evidence, never from a client-writable fact.

Evidence per rule (all read from rows only Django writes; the generic client POST cannot create
any of them without the same proof):

- `reward-secret-door-key` (WORLD_CHANGE `THE_CASTLES_SECRET_DOOR_COMPLETE`, STORY producer): the
  child has a **completed `StoryProgress`** of a producing story. The world-change row is not
  required and is never trusted by itself: a forged or misplaced copy of the key, at any location,
  qualifies nobody. A legacy blank-location row is also not enough on its own.
- `reward-three-clues-lens` (WORLD_CHANGE `SECRET_DOOR_CLUES_COLLECTED`, ADVENTURE producer): a
  **COMPLETED adventure session** of the producer template whose action trail reached the
  producing step (the same proof the client POST demands).
- `reward-painted-words-brush` (ADVENTURE_COMPLETED `the-painted-words`): a COMPLETED adventure
  session of that template.

Properties: per child, under the child row lock; idempotent (`GrantedRule` is claimed first, and a
child who already owns every item of the rule, from any path, is skipped); never deletes or edits
anything; never touches another child (every query goes through `for_child`). A dry run writes
nothing. The report is counts only.
"""

from dataclasses import dataclass, field

from django.db import transaction

from apps.game_sessions.models import AdventureSession, SessionKind, SessionStatus
from apps.progression import protected_changes as protected
from apps.progression.client_changes import _step_reached
from apps.progression.models import StoryProgress
from apps.users.services import iter_child_profile_ids_for_system, lock_child_profile_for_system

from .models import GrantedRule, InventoryItem
from .services import grant_reward_rule

CASTLE_KEEPSAKE_RULES = (
    "reward-painted-words-brush",
    "reward-three-clues-lens",
    "reward-secret-door-key",
)


@dataclass
class RuleReport:
    eligible: int = 0
    granted: int = 0
    already_had: int = 0


@dataclass
class BackfillReport:
    children_scanned: int = 0
    rules: dict[str, RuleReport] = field(default_factory=dict)
    apply: bool = False

    def rule(self, rule_id: str) -> RuleReport:
        return self.rules.setdefault(rule_id, RuleReport())


def _adventure_evidence(child, template_slug: str, step_id: str = ""):
    """A completed session of `template_slug` (that reached `step_id` if given), or None."""
    sessions = (
        AdventureSession.objects.for_child(child)
        .filter(
            kind=SessionKind.ADVENTURE,
            status=SessionStatus.COMPLETED,
            adventure__slug=template_slug,
        )
        .order_by("pk")
    )
    for session in sessions:
        if not step_id or _step_reached(session, step_id):
            return session
    return None


def _evidence(child, rule):
    """(has evidence, session to record as the source or None) for one castle keepsake rule."""
    trigger = rule.trigger
    if trigger.get("type") == "ADVENTURE_COMPLETED":
        session = _adventure_evidence(child, trigger.get("templateSlug", ""))
        return session is not None, session
    if trigger.get("type") != "WORLD_CHANGE":
        return False, None
    entry = protected.lookup(trigger.get("changeKey", ""))
    if entry is None:
        return False, None
    stories = {p.slug for p in entry.producers if p.kind == protected.STORY}
    if (
        stories
        and StoryProgress.objects.for_child(child)
        .filter(story_slug__in=stories, completed_at__isnull=False)
        .exists()
    ):
        return True, None
    for producer in entry.producers:
        if producer.kind == protected.ADVENTURE:
            session = _adventure_evidence(child, producer.slug, producer.step_id)
            if session is not None:
                return True, session
    return False, None


def _backfill_child(child_id, rules, report: BackfillReport, *, apply: bool) -> None:
    with transaction.atomic():
        child = lock_child_profile_for_system(child_id)
        report.children_scanned += 1
        for rule in rules:
            counts = report.rule(rule.rule_id)
            item_ids = set(rule.items.values_list("pk", flat=True))
            owned = set(
                InventoryItem.objects.for_child(child)
                .filter(item_id__in=item_ids)
                .values_list("item_id", flat=True)
            )
            if GrantedRule.objects.for_child(child).filter(rule=rule).exists() or (
                item_ids and item_ids <= owned
            ):
                counts.already_had += 1
                continue
            has, session = _evidence(child, rule)
            if not has:
                continue
            counts.eligible += 1
            if apply:
                grant = grant_reward_rule(child, rule, source_session=session)
                counts.granted += 1 if grant.granted else 0


def backfill_castle_keepsakes(*, apply: bool = False) -> BackfillReport:
    """Grant the castle keepsakes to every child with historical evidence. Dry run by default."""
    from apps.catalog.models import RewardRule

    rules = list(RewardRule.objects.filter(rule_id__in=CASTLE_KEEPSAKE_RULES).order_by("rule_id"))
    report = BackfillReport(apply=apply)
    for rule in rules:
        report.rule(rule.rule_id)
    for child_id in iter_child_profile_ids_for_system():
        _backfill_child(child_id, rules, report, apply=apply)
    return report
