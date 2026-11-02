"""Shared, server-side limits on model calls (LAI-0708; docs/AI_SERVICE.md section 5).

Every limit is a fixed-window counter in PostgreSQL (`AIUsageCounter`), incremented with a
single atomic upsert, so it holds across gunicorn workers and EC2 instances without Redis. The
database is already shared by every Django process; a counter is one indexed row per subject
and window, and windows older than two days are pruned as new ones are written.

Checked in this order, before any model call; the first exhausted limit wins:

1. the runtime kill switch (`AIServiceControl`, cached briefly);
2. a global daily ceiling, the application's own cost cap;
3. per child per minute, per child per day, per family per day, per session per day;
4. concurrent turns per child (an in-flight count released when the turn ends; a crashed
   worker's slot lapses with its one-minute window).

A denied turn makes no model call and is audited as RATE_LIMITED (or KILL_SWITCH); it is never
counted as a generation. If the counter store itself fails, the turn fails closed: no model call
(`RATE_LIMIT_UNAVAILABLE`). Counts include denied attempts, so hammering a limit does not reopen
it.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import DatabaseError, connection, transaction

from ..models import AIServiceControl, UsageScope

logger = logging.getLogger("lai.ai")

CONTROL_CACHE_SECONDS = 15
_CONTROL_CACHE_KEY = "lai-ai-service-control"
PRUNE_AFTER = timedelta(days=2)


@dataclass(frozen=True)
class Admission:
    allowed: bool
    # "", "KILL_SWITCH", "RATE_LIMITED" or "RATE_LIMIT_UNAVAILABLE"
    denial: str = ""
    inflight_subject: str = ""
    inflight_window: datetime | None = None


def model_calls_enabled() -> bool:
    cached = cache.get(_CONTROL_CACHE_KEY)
    if cached is not None:
        return bool(cached)
    row = AIServiceControl.objects.filter(pk=1).first()
    enabled = row.model_calls_enabled if row else True
    cache.set(_CONTROL_CACHE_KEY, enabled, CONTROL_CACHE_SECONDS)
    return enabled


def clear_control_cache() -> None:
    cache.delete(_CONTROL_CACHE_KEY)


def _window(at: datetime, size: str) -> datetime:
    at = at.astimezone(UTC)
    if size == "minute":
        return at.replace(second=0, microsecond=0)
    return at.replace(hour=0, minute=0, second=0, microsecond=0)


_UPSERT = """
INSERT INTO ai_aiusagecounter (scope, subject, window_start, count, child_id, parent_id)
VALUES (%s, %s, %s, %s, %s, %s)
ON CONFLICT (scope, subject, window_start)
DO UPDATE SET count = ai_aiusagecounter.count + EXCLUDED.count
RETURNING count
"""


def _bump(scope: str, subject: str, window: datetime, delta: int, *, child=None, parent=None):
    with connection.cursor() as cursor:
        cursor.execute(
            _UPSERT,
            [
                scope,
                subject,
                window,
                delta,
                getattr(child, "pk", None),
                getattr(parent, "pk", None),
            ],
        )
        return cursor.fetchone()[0]


def _prune(at: datetime) -> None:
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM ai_aiusagecounter WHERE window_start < %s", [at - PRUNE_AFTER])


def admit(child, *, session_id: str = "", at: datetime | None = None) -> Admission:
    """Counts this turn against every limit and says whether a model call may happen."""
    at = at or datetime.now(UTC)
    try:
        if not model_calls_enabled():
            return Admission(False, "KILL_SWITCH")
        with transaction.atomic():
            return _count(child, session_id, at)
    except DatabaseError:
        logger.exception("ai.usage store unavailable")
        return Admission(False, "RATE_LIMIT_UNAVAILABLE")


def _count(child, session_id: str, at: datetime) -> Admission:
    day, minute = _window(at, "day"), _window(at, "minute")
    child_key = f"child:{child.pk}"
    checks = [
        (UsageScope.GLOBAL_DAY, "global", day, settings.LAI_AI_GLOBAL_TURNS_PER_DAY, {}),
        (
            UsageScope.CHILD_MINUTE,
            child_key,
            minute,
            settings.LAI_AI_CHILD_TURNS_PER_MINUTE,
            {"child": child},
        ),
        (
            UsageScope.CHILD_DAY,
            child_key,
            day,
            settings.LAI_AI_CHILD_TURNS_PER_DAY,
            {"child": child},
        ),
        (
            UsageScope.FAMILY_DAY,
            f"family:{child.parent_id}",
            day,
            settings.LAI_AI_FAMILY_TURNS_PER_DAY,
            {"parent": child.parent},
        ),
    ]
    if session_id:
        checks.append(
            (
                UsageScope.SESSION_DAY,
                f"session:{child.pk}:{session_id}"[:160],
                day,
                settings.LAI_AI_SESSION_TURNS_PER_DAY,
                {"child": child},
            )
        )
    for scope, subject, window, limit, owners in checks:
        if _bump(scope, subject, window, 1, **owners) > limit:
            return Admission(False, "RATE_LIMITED")
    inflight = _bump(UsageScope.CHILD_INFLIGHT, child_key, minute, 1, child=child)
    if inflight > settings.LAI_AI_CHILD_CONCURRENT_TURNS:
        _bump(UsageScope.CHILD_INFLIGHT, child_key, minute, -1, child=child)
        return Admission(False, "RATE_LIMITED")
    if at.second == 0 or minute.minute == 0:
        _prune(at)
    return Admission(True, inflight_subject=child_key, inflight_window=minute)


def release(child, admission: Admission) -> None:
    if not admission.allowed or admission.inflight_window is None:
        return
    try:
        with transaction.atomic():
            _bump(
                UsageScope.CHILD_INFLIGHT,
                admission.inflight_subject,
                admission.inflight_window,
                -1,
                child=child,
            )
    except DatabaseError:
        logger.exception("ai.usage release failed")
