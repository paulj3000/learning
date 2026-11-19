"""The append-only ledger, its projection, corrections and erasure (GE-103)."""

from io import StringIO

import pytest
from django.core.management import call_command
from django.db import IntegrityError, transaction

from apps.core.models import CrossChildReference
from apps.core.tests.test_django_admin import make_admin
from apps.game_sessions.play import start_or_resume_region_session
from apps.scoring import ledger
from apps.scoring.contracts import Currency, EntryKind, SourceKind, Trust
from apps.scoring.models import (
    AppendOnlyLedger,
    AwardLedgerEntry,
    ProgressionProjection,
)
from apps.users.models import ChildProfile

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


_staff_count = iter(range(1000))


def staff():
    return make_admin(f"ledger-staff-{next(_staff_count)}")[0]


def projection(child):
    return ProgressionProjection.objects.get(child=child)


# --- Append only ------------------------------------------------------------------------------


def test_an_entry_cannot_be_saved_again(families, grant):
    entry = grant(families.a1)
    entry.amount = 9999
    with pytest.raises(AppendOnlyLedger):
        entry.save()
    assert AwardLedgerEntry.objects.get(pk=entry.pk).amount == 50


def test_queryset_update_is_refused(families, grant):
    grant(families.a1)
    with pytest.raises(AppendOnlyLedger):
        AwardLedgerEntry.objects.update(amount=1)
    with pytest.raises(AppendOnlyLedger):
        AwardLedgerEntry.objects.filter(child=families.a1).update(amount=1)


def test_an_entry_and_a_queryset_cannot_be_deleted(families, grant):
    entry = grant(families.a1)
    with pytest.raises(AppendOnlyLedger):
        entry.delete()
    with pytest.raises(AppendOnlyLedger):
        AwardLedgerEntry.objects.all().delete()
    assert AwardLedgerEntry.objects.count() == 1


def test_the_database_holds_one_entry_per_child_and_key(families, grant):
    entry = grant(families.a1)
    with pytest.raises(IntegrityError), transaction.atomic():
        AwardLedgerEntry.objects.create(
            child=families.a1,
            idempotency_key=entry.idempotency_key,
            currency=Currency.XP,
            amount=1,
            source_kind=SourceKind.QUEST_COMPLETED,
            source_ref="x",
            trust=int(Trust.SERVER_BOUNDED),
            occurred_at=entry.occurred_at,
        )
    # another child may hold the same key
    assert grant(families.b1) is not None


def test_the_database_refuses_a_non_positive_award(families, grant):
    entry = grant(families.a1)
    for amount in (0, -5):
        with pytest.raises(IntegrityError), transaction.atomic():
            AwardLedgerEntry.objects.create(
                child=families.a1,
                idempotency_key=f"k{amount}",
                currency=Currency.XP,
                amount=amount,
                source_kind=SourceKind.QUEST_COMPLETED,
                source_ref="x",
                trust=1,
                occurred_at=entry.occurred_at,
            )


# --- Idempotence ------------------------------------------------------------------------------


def test_record_awards_twice_creates_nothing_the_second_time(families, grant):
    first = grant(families.a1)
    before = projection(families.a1)
    assert first is not None
    assert grant(families.a1) is None
    after = projection(families.a1)
    assert (after.xp, after.entry_count) == (before.xp, before.entry_count) == (50, 1)
    assert AwardLedgerEntry.objects.filter(child=families.a1).count() == 1


def test_an_empty_plan_writes_nothing(families, scoring):
    assert ledger.record_awards(families.a1, scoring, []) == []
    assert not ProgressionProjection.objects.exists()


# --- Corrections ------------------------------------------------------------------------------


def test_a_correction_reduces_the_total_and_the_projection(families, grant):
    entry = grant(families.a1, amount=100)
    correction = ledger.record_correction(entry, -40, "mis-set value", staff())
    assert correction.entry_kind == EntryKind.CORRECTION and correction.corrects_id == entry.pk
    assert correction.amount == -40 and correction.reason == "mis-set value"
    assert projection(families.a1).xp == 60
    assert ledger.projection_matches_ledger(families.a1)
    # the original is untouched
    assert AwardLedgerEntry.objects.get(pk=entry.pk).amount == 100


def test_a_correction_can_be_partially_restored(families, grant):
    entry = grant(families.a1, amount=100)
    ledger.record_correction(entry, -100, "reverse", staff())
    ledger.record_correction(entry, 30, "restore some", staff())
    assert projection(families.a1).xp == 30


def test_only_active_staff_record_corrections(families, grant):
    entry = grant(families.a1)
    parent_like = families.a  # a ParentAccount is not staff
    for user in (parent_like, None):
        with pytest.raises(ledger.CorrectionRefused):
            ledger.record_correction(entry, -1, "no", user)
    inactive, _ = make_admin("gone-staff", active=False)
    with pytest.raises(ledger.CorrectionRefused):
        ledger.record_correction(entry, -1, "no", inactive)
    assert AwardLedgerEntry.objects.count() == 1


@pytest.mark.parametrize("reason", ["", "   ", None])
def test_a_correction_needs_a_reason(families, grant, reason):
    entry = grant(families.a1)
    with pytest.raises(ledger.CorrectionRefused):
        ledger.record_correction(entry, -1, reason, staff())


def test_a_correction_must_change_something(families, grant):
    with pytest.raises(ledger.CorrectionRefused):
        ledger.record_correction(grant(families.a1), 0, "nothing", staff())


def test_a_correction_cannot_go_below_zero_or_above_the_original(families, grant):
    entry = grant(families.a1, amount=100)
    with pytest.raises(ledger.CorrectionRefused):
        ledger.record_correction(entry, -101, "too much", staff())
    with pytest.raises(ledger.CorrectionRefused):
        ledger.record_correction(entry, 1, "raise it", staff())
    ledger.record_correction(entry, -60, "ok", staff())
    with pytest.raises(ledger.CorrectionRefused):  # 100 - 60 - 41 < 0 cumulatively
        ledger.record_correction(entry, -41, "too much again", staff())
    assert projection(families.a1).xp == 40


def test_a_correction_cannot_be_corrected(families, grant):
    entry = grant(families.a1)
    correction = ledger.record_correction(entry, -10, "fix", staff())
    with pytest.raises(ledger.CorrectionRefused):
        ledger.record_correction(correction, 10, "undo", staff())


def test_the_database_refuses_a_correction_without_a_reason(families, grant):
    entry = grant(families.a1)
    with pytest.raises(IntegrityError), transaction.atomic():
        AwardLedgerEntry.objects.create(
            child=families.a1,
            idempotency_key="c",
            entry_kind=EntryKind.CORRECTION,
            corrects=entry,
            reason="",
            currency=Currency.XP,
            amount=-1,
            source_kind=SourceKind.QUEST_COMPLETED,
            source_ref="x",
            trust=1,
            occurred_at=entry.occurred_at,
        )


# --- Projection -------------------------------------------------------------------------------


def test_the_rebuilt_projection_equals_the_maintained_one(families, grant):
    for i, currency in enumerate([Currency.XP, Currency.COINS, Currency.LEARNING_POINTS]):
        grant(families.a1, ref=f"r{i}", amount=10 * (i + 1), currency=currency)
    grant(families.a1, ref="s", amount=1, currency=Currency.STAR)
    ledger.record_correction(grant(families.a1, ref="big", amount=70), -20, "fix", staff())
    maintained = projection(families.a1)
    expected = (maintained.xp, maintained.learning_points, maintained.coins, maintained.stars)
    count, last = maintained.entry_count, maintained.last_entry_at
    assert ledger.projection_matches_ledger(families.a1)
    rebuilt = ledger.rebuild_projection(families.a1)
    assert (rebuilt.xp, rebuilt.learning_points, rebuilt.coins, rebuilt.stars) == expected
    assert expected == (60, 30, 20, 1)
    assert rebuilt.entry_count == count == 6
    assert rebuilt.last_entry_at == last
    assert ledger.projection_matches_ledger(families.a1)


def test_a_child_with_no_entries_matches(families):
    assert ledger.projection_matches_ledger(families.a1)
    assert ledger.rebuild_projection(families.a1).entry_count == 0


def test_the_verify_command_detects_and_rebuilds_a_broken_projection(families, grant):
    grant(families.a1, amount=80)
    grant(families.b1, amount=20)
    ProgressionProjection.objects.filter(child=families.a1).update(xp=5)
    assert not ledger.projection_matches_ledger(families.a1)

    out = StringIO()
    call_command("scoring_verify_projections", stdout=out)
    assert "1 mismatched projection(s) found." in out.getvalue()
    assert projection(families.a1).xp == 5  # report only

    out = StringIO()
    call_command("scoring_verify_projections", "--rebuild", stdout=out)
    assert "1 mismatched projection(s) rebuilt." in out.getvalue()
    assert projection(families.a1).xp == 80

    out = StringIO()
    call_command("scoring_verify_projections", stdout=out)
    assert "0 mismatched" in out.getvalue()


# --- Erasure and deletion ---------------------------------------------------------------------


def test_erasure_removes_only_that_childs_scoring_including_corrections(families, grant):
    entry = grant(families.a1, amount=100)
    ledger.record_correction(entry, -10, "fix", staff())
    grant(families.a1, ref="two")
    grant(families.a2, ref="sibling")
    grant(families.b1, ref="other-family")

    assert ledger.erase_child_scoring(families.a1) == 3
    assert not AwardLedgerEntry.objects.filter(child=families.a1).exists()
    assert not ProgressionProjection.objects.filter(child=families.a1).exists()
    assert AwardLedgerEntry.objects.filter(child=families.a2).count() == 1
    assert AwardLedgerEntry.objects.filter(child=families.b1).count() == 1
    assert projection(families.a2).xp == 50


def test_erasing_a_child_with_nothing_is_fine(families):
    assert ledger.erase_child_scoring(families.a1) == 0


def test_deleting_the_child_profile_cascades_scoring_rows(families, grant):
    entry = grant(families.a1, amount=100)
    ledger.record_correction(entry, -10, "fix", staff())
    grant(families.a2)
    ChildProfile.objects.filter(pk=families.a1.pk).delete()
    assert not AwardLedgerEntry.objects.filter(child_id=families.a1.pk).exists()
    assert not ProgressionProjection.objects.filter(child_id=families.a1.pk).exists()
    assert AwardLedgerEntry.objects.filter(child=families.a2).count() == 1


# --- Cross-child links ------------------------------------------------------------------------


def test_a_ledger_entry_cannot_link_another_childs_session(treasure, scoring):
    other, _ = start_or_resume_region_session(treasure.families.b1, treasure.region)
    with pytest.raises(CrossChildReference):
        AwardLedgerEntry.objects.create(
            child=treasure.families.a1,
            idempotency_key="x",
            currency=Currency.XP,
            amount=1,
            source_kind=SourceKind.QUEST_COMPLETED,
            source_ref="x",
            trust=1,
            session=other,
            occurred_at=other.started_at,
        )


def test_record_awards_drops_a_session_that_is_not_the_childs(treasure, grant):
    other, _ = start_or_resume_region_session(treasure.families.b1, treasure.region)
    entry = grant(treasure.families.a1, session=other)
    assert entry is not None and entry.session_id is None
    own, _ = start_or_resume_region_session(treasure.families.a1, treasure.region)
    linked = grant(treasure.families.a1, ref="q2", session=own)
    assert linked.session_id == own.pk
