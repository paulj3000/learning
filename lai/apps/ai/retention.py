"""Retention for AI audit metadata (LAI-0707; docs/AI_SERVICE.md section 7).

No retention period is approved yet: it belongs to the privacy design (LAI-0308, gate G9). So
nothing runs on a schedule and nothing deletes by default. `manage.py ai_retention` applies a
period only when one is given explicitly (`--older-than-days`) or configured
(`LAI_AI_AUDIT_RETENTION_DAYS`), and only with `--apply`; otherwise it reports what it would do.

Rules:
* only `ai_*` rows are touched, never gameplay, progress, stories or profiles;
* a safety event still OPEN for review is kept, whatever its age, unless the operator passes
  `--include-open`; an audit row a kept safety event points to is kept with it;
* idempotent: running it twice deletes nothing the second time;
* observable: one `ai.retention` log line and the returned counts; never ids or text.
"""

import logging
from dataclasses import dataclass
from datetime import timedelta

from django.db import transaction
from django.utils.timezone import now

from .models import AIInteractionAudit, SafetyEvent, SafetyEventReviewStatus

logger = logging.getLogger("lai.ai")

MIN_DAYS = 1
MAX_DAYS = 3650


class RetentionNotConfigured(Exception):
    """No retention period was given or configured; nothing may be deleted."""


@dataclass(frozen=True)
class RetentionReport:
    cutoff_days: int
    applied: bool
    audits: int
    safety_events: int
    kept_open_safety_events: int

    def as_dict(self) -> dict:
        return {
            "olderThanDays": self.cutoff_days,
            "applied": self.applied,
            "audits": self.audits,
            "safetyEvents": self.safety_events,
            "keptOpenSafetyEvents": self.kept_open_safety_events,
        }


def apply_retention(
    *, older_than_days: int | None, apply: bool, include_open: bool = False, at=None
) -> RetentionReport:
    if older_than_days is None:
        raise RetentionNotConfigured
    if not MIN_DAYS <= older_than_days <= MAX_DAYS:
        raise ValueError(f"older_than_days must be between {MIN_DAYS} and {MAX_DAYS}")
    cutoff = (at or now()) - timedelta(days=older_than_days)

    old_events = SafetyEvent.objects.filter(created_at__lt=cutoff)
    kept_open = old_events.filter(review_status=SafetyEventReviewStatus.OPEN)
    events = old_events if include_open else old_events.exclude(pk__in=kept_open.values("pk"))
    kept_open_count = 0 if include_open else kept_open.count()
    # Keep audit rows that a surviving safety event still links to.
    surviving_links = SafetyEvent.objects.exclude(pk__in=events.values("pk")).filter(
        audit__isnull=False
    )
    audits = AIInteractionAudit.objects.filter(created_at__lt=cutoff).exclude(
        pk__in=surviving_links.values("audit_id")
    )

    if not apply:
        report = RetentionReport(
            older_than_days, False, audits.count(), events.count(), kept_open_count
        )
    else:
        with transaction.atomic():
            event_count, _ = events.delete()
            audit_count, _ = audits.delete()
        report = RetentionReport(older_than_days, True, audit_count, event_count, kept_open_count)
    logger.info(
        "ai.retention applied=%s older_than_days=%s audits=%s safety_events=%s kept_open=%s",
        report.applied,
        report.cutoff_days,
        report.audits,
        report.safety_events,
        report.kept_open_safety_events,
    )
    return report
