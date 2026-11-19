"""Record a compensating correction for one award (GE-103). Superusers only.

The ledger is child progress, so it is not on the Django admin (no child progress model is).
A correction repairs a defect, such as a mis-set policy value; it is never used because of
anything a child did. The original award stays in the ledger, and the correction references it
with a reason. By default the whole remaining amount is reversed; `--amount` reverses part of
it (negative) or restores part of an earlier reversal (positive, never above the original).

    manage.py scoring_correct <entry-id> --staff <username> --reason "mis-set value in v3"
"""

import uuid

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Sum

from apps.scoring import ledger
from apps.scoring.contracts import EntryKind
from apps.scoring.models import AwardLedgerEntry


class Command(BaseCommand):
    help = "Reverse (or partly restore) one ledger award with an audited correction entry."

    def add_arguments(self, parser):
        parser.add_argument("entry_id")
        parser.add_argument(
            "--staff",
            required=True,
            help="The superuser recording it (their Django Admin username).",
        )
        parser.add_argument("--reason", required=True, help="Staff text only: no child details.")
        parser.add_argument("--amount", type=int, help="Default: reverse what remains.")

    def handle(self, *args, entry_id, staff, reason, amount, **options):
        # Staff accounts sign in to Django Admin by `admin_username` (ADR-034).
        user = get_user_model().objects.filter(admin_username=staff).first()
        if user is None or not (user.is_active and user.is_superuser):
            raise CommandError("Corrections need an active superuser (--staff).")
        try:
            entry_uuid = uuid.UUID(entry_id)
        except ValueError:
            raise CommandError("The entry id must be a ledger entry UUID.") from None
        awards = AwardLedgerEntry.objects.filter(pk=entry_uuid, entry_kind=EntryKind.AWARD)
        entry = awards.first()
        if entry is None:
            raise CommandError("No such award (corrections themselves cannot be corrected).")
        if amount is None:
            corrected = entry.corrections.aggregate(total=Sum("amount"))["total"] or 0
            amount = -(entry.amount + corrected)
            if amount == 0:
                raise CommandError("Nothing remains to reverse.")
        try:
            correction = ledger.record_correction(entry, amount, reason, user)
        except ledger.CorrectionRefused as error:
            raise CommandError(str(error)) from None
        self.stdout.write(
            f"Correction {correction.pk}: {correction.amount} {correction.currency} recorded."
        )
