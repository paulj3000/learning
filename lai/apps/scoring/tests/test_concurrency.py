"""Concurrent reconciles and awards (GE-103, GE-110): real parallel transactions on PostgreSQL.

`transaction=True` so each thread commits on its own connection, as simultaneous requests and a
backfill running alongside live play would. The unique (child, idempotency key) constraint and
the projection row lock decide the outcome, not timing.
"""

from io import StringIO

import pytest
from django.db.models import Count

from apps.game_sessions.tests.test_concurrency import race
from apps.scoring import fixtures, ledger, policies, reconcile
from apps.scoring.contracts import Currency, ScoringFact, SourceKind, Trust, idempotency_key
from apps.scoring.models import AwardLedgerEntry, ProgressionProjection
from apps.scoring.rules import AwardDecision

from .test_collectors_and_reconcile import answer_chest

pytestmark = [pytest.mark.postgres, pytest.mark.django_db(transaction=True)]


@pytest.fixture
def live(settings):
    settings.LAI_SCORING_ENABLED = True
    settings.LAI_SCORING_ALLOW_UNAPPROVED = True
    return policies.activate(fixtures.create_dev_policy())


def no_duplicate_keys(child) -> bool:
    duplicates = (
        AwardLedgerEntry.objects.filter(child=child)
        .values("idempotency_key")
        .annotate(n=Count("id"))
        .filter(n__gt=1)
    )
    return not duplicates.exists()


def test_parallel_reconciles_award_each_source_once(treasure, live, settings):
    child = treasure.families.a1
    # Recorded while scoring is off, so the live hook (which runs at commit in these real
    # transactions) has not already paid: the racers below find the facts unpaid.
    settings.LAI_SCORING_ENABLED = False
    answer_chest(treasure, child)  # a correct chest answer: several facts at once
    settings.LAI_SCORING_ENABLED = True
    assert not AwardLedgerEntry.objects.filter(child=child).exists()

    results = race(lambda: reconcile.reconcile_child(child), count=4)

    assert not [r for r in results if isinstance(r, Exception)], results
    created = sum(len(r.new_entries) for r in results)
    assert created == AwardLedgerEntry.objects.filter(child=child).count() > 0
    assert no_duplicate_keys(child)
    assert ledger.projection_matches_ledger(child)
    assert ProgressionProjection.objects.filter(child=child).count() == 1


def test_parallel_writes_of_one_award_record_it_once(treasure, live):
    child = treasure.families.a1
    fact = ScoringFact(SourceKind.QUEST_COMPLETED, "race", Trust.SERVER_BOUNDED, live.created_at)
    key = idempotency_key(fact.source_kind, fact.source_ref, Currency.XP, "g")
    planned = [ledger.Planned(fact, AwardDecision("quest-completion", Currency.XP, 250, "g", key))]

    results = race(lambda: ledger.record_awards(child, live, planned), count=4)

    assert not [r for r in results if isinstance(r, Exception)], results
    assert sum(len(r) for r in results) == 1
    assert AwardLedgerEntry.objects.filter(child=child, idempotency_key=key).count() == 1
    assert ProgressionProjection.objects.get(child=child).xp == 250


def test_a_backfill_racing_live_play_never_duplicates(treasure, live, settings):
    """Children reconciled by the command while one of them is also reconciled live."""
    from django.core.management import call_command

    child = treasure.families.a1
    settings.LAI_SCORING_ENABLED = False
    answer_chest(treasure, child)
    settings.LAI_SCORING_ENABLED = True

    def backfill():
        call_command("scoring_reconcile", stdout=StringIO())
        return "backfill"

    def live_play():
        return reconcile.reconcile_child(child)

    work = iter([backfill, live_play, live_play])
    results = race(lambda: next(work)(), count=3)

    assert not [r for r in results if isinstance(r, Exception)], results
    assert AwardLedgerEntry.objects.filter(child=child).exists()
    assert no_duplicate_keys(child)
    assert ledger.projection_matches_ledger(child)


def test_the_live_hook_pays_at_commit(treasure, live):
    """In real transactions the post-commit hook awards without any explicit reconcile."""
    child = treasure.families.a1
    answer_chest(treasure, child)
    assert (
        AwardLedgerEntry.objects.filter(
            child=child, source_kind=SourceKind.LEARNING_CHALLENGE
        ).count()
        == 1
    )
