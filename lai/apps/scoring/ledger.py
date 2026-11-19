"""The award ledger's writes (GE-103). Every write is atomic with its projection update.

- `record_awards`: the reconciler's only write. Idempotent under the database's unique
  (child, idempotency_key): of two concurrent writers exactly one inserts; the other finds the
  row and records nothing. The projection row is locked first, so totals cannot interleave.
- `record_correction`: a staff compensating entry. It references the entry it corrects, has a
  reason, and can never take that entry's net amount below zero or above its original. It
  exists to repair defects (a mis-set policy value); it is never used for anything a child did.
- `rebuild_projection`: recomputes the totals from the ledger alone. The projection is a cache.
- `erase_child_scoring`: a parent's privacy erasure. The only path that removes entries.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from django.db import IntegrityError, transaction
from django.db.models import Max, Sum
from django.utils import timezone

from .contracts import Currency, EntryKind, ScoringFact
from .models import AwardLedgerEntry, AwardRule, ProgressionProjection, ScoringPolicy
from .rules import AwardDecision

TOTAL_FIELDS = {
    Currency.XP: "xp",
    Currency.LEARNING_POINTS: "learning_points",
    Currency.COINS: "coins",
    Currency.STAR: "stars",
}


class CorrectionRefused(ValueError):
    pass


@dataclass(frozen=True)
class Planned:
    fact: ScoringFact
    decision: AwardDecision


def _lock_projection(child) -> ProgressionProjection:
    ProgressionProjection.objects.get_or_create(child=child)
    return ProgressionProjection.objects.select_for_update().get(child=child)


def _apply(projection: ProgressionProjection, currency: str, amount: int, at) -> None:
    name = TOTAL_FIELDS[Currency(currency)]
    setattr(projection, name, max(0, getattr(projection, name) + amount))
    projection.entry_count += 1
    if projection.last_entry_at is None or at > projection.last_entry_at:
        projection.last_entry_at = at


@transaction.atomic
def record_awards(
    child, policy: ScoringPolicy, planned: Sequence[Planned]
) -> list[AwardLedgerEntry]:
    """Insert the planned awards the child does not have yet. Returns only the new entries."""
    if not planned:
        return []
    projection = _lock_projection(child)
    existing = set(
        AwardLedgerEntry.objects.for_child(child)
        .filter(idempotency_key__in=[p.decision.idempotency_key for p in planned])
        .values_list("idempotency_key", flat=True)
    )
    rules = {r.rule_key: r for r in AwardRule.objects.filter(policy=policy)}
    sessions = _own_session_ids(child, {p.fact.session_id for p in planned if p.fact.session_id})
    created: list[AwardLedgerEntry] = []
    now = timezone.now()
    for item in planned:
        decision, fact = item.decision, item.fact
        if decision.idempotency_key in existing:
            continue
        existing.add(decision.idempotency_key)
        entry = AwardLedgerEntry(
            child=child,
            idempotency_key=decision.idempotency_key,
            entry_kind=EntryKind.AWARD,
            currency=decision.currency,
            amount=decision.amount,
            source_kind=fact.source_kind,
            source_ref=fact.source_ref[:200],
            scope_key=fact.scope_key[:120],
            trust=int(fact.trust),
            policy=policy,
            policy_version=policy.version,
            rule=rules.get(decision.rule_key),
            session_id=fact.session_id if fact.session_id in sessions else None,
            occurred_at=fact.occurred_at,
            recorded_at=now,
        )
        try:
            with transaction.atomic():  # a savepoint: a lost race costs only this row
                entry.save()
        except IntegrityError:
            continue
        _apply(projection, entry.currency, entry.amount, now)
        created.append(entry)
    if created:
        projection.save()
    return created


def _own_session_ids(child, ids: set) -> set:
    """Only the child's own sessions are linked (the model also refuses a cross-child link)."""
    if not ids:
        return set()
    from apps.game_sessions.models import AdventureSession

    return set(
        AdventureSession.objects.for_child(child).filter(pk__in=ids).values_list("pk", flat=True)
    )


@transaction.atomic
def record_correction(entry: AwardLedgerEntry, amount: int, reason: str, user) -> AwardLedgerEntry:
    if not (getattr(user, "is_active", False) and getattr(user, "is_staff", False)):
        raise CorrectionRefused("Only staff can record a correction.")
    reason = (reason or "").strip()
    if not reason:
        raise CorrectionRefused("A correction needs a reason.")
    if amount == 0:
        raise CorrectionRefused("A correction must change something.")
    original = AwardLedgerEntry.objects.select_for_update().get(pk=entry.pk)
    if original.entry_kind != EntryKind.AWARD:
        raise CorrectionRefused("Correct the original award, not a correction.")
    child = original.child
    projection = _lock_projection(child)
    already = (
        AwardLedgerEntry.objects.filter(corrects=original).aggregate(total=Sum("amount"))["total"]
        or 0
    )
    net = original.amount + already + amount
    if net < 0:
        raise CorrectionRefused("A correction can never take an award below zero.")
    if net > original.amount:
        raise CorrectionRefused("A correction can only reduce or restore an award, not raise it.")
    count = AwardLedgerEntry.objects.filter(corrects=original).count()
    now = timezone.now()
    correction = AwardLedgerEntry.objects.create(
        child=child,
        idempotency_key=f"correction|{original.pk}|{count + 1}",
        entry_kind=EntryKind.CORRECTION,
        currency=original.currency,
        amount=amount,
        source_kind=original.source_kind,
        source_ref=original.source_ref,
        scope_key=original.scope_key,
        trust=original.trust,
        policy=original.policy,
        policy_version=original.policy_version,
        rule=original.rule,
        corrects=original,
        reason=reason[:300],
        created_by=user,
        occurred_at=now,
        recorded_at=now,
    )
    _apply(projection, correction.currency, correction.amount, now)
    projection.save()
    return correction


def ledger_totals(child) -> dict[str, int]:
    rows = (
        AwardLedgerEntry.objects.for_child(child).values("currency").annotate(total=Sum("amount"))
    )
    totals = {name: 0 for name in TOTAL_FIELDS.values()}
    for row in rows:
        totals[TOTAL_FIELDS[Currency(row["currency"])]] = max(0, row["total"] or 0)
    return totals


@transaction.atomic
def rebuild_projection(child) -> ProgressionProjection:
    projection = _lock_projection(child)
    entries = AwardLedgerEntry.objects.for_child(child)
    for name, total in ledger_totals(child).items():
        setattr(projection, name, total)
    projection.entry_count = entries.count()
    projection.last_entry_at = entries.aggregate(last=Max("recorded_at"))["last"]
    projection.save()
    return projection


def projection_matches_ledger(child) -> bool:
    projection = ProgressionProjection.objects.for_child(child).first()
    totals = ledger_totals(child)
    count = AwardLedgerEntry.objects.for_child(child).count()
    if projection is None:
        return count == 0
    return count == projection.entry_count and all(
        getattr(projection, name) == total for name, total in totals.items()
    )


@transaction.atomic
def erase_child_scoring(child) -> int:
    deleted = AwardLedgerEntry.objects.erase_for_child(child)
    ProgressionProjection.objects.for_child(child).delete()
    return deleted
