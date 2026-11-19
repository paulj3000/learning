"""Read models for the child HUD and the parent dashboard (GE-105, GE-106, GE-108).

Everything here is derived. Nothing is stored that the ledger, the inventory or the mastery
counters do not already hold:

- totals and level: the projection row (a cache of the ledger) and the policy's thresholds;
- achievements: the child's KEEPSAKE items (FPV-18 put achievements there; no new model);
- trophies: completion items of collectible sets the child owns;
- per-adventure scores, stars and personal bests: ledger entries grouped by scope;
- subject mastery: `education.SkillProgress` grouped by `catalog.LearningObjective.domain`.

Personal bests are the child's own best visit (most XP earned in one session of an area).
They are private, never compared with another child, and never about time.
"""

from __future__ import annotations

from collections import defaultdict

from django.db.models import Sum

from apps.catalog.models import CollectibleSet, LearningObjective
from apps.education.models import SkillProgress, SkillStatus
from apps.inventory.models import InventoryItem

from . import policies, rules
from .contracts import CONTRACT_VERSION, Currency, EntryKind
from .models import AwardLedgerEntry, ProgressionProjection

RECENT_LIMIT = 20
FEED_LIMIT = 100


def award_body(entry: AwardLedgerEntry) -> dict:
    return {
        "id": str(entry.pk),
        "entryKind": entry.entry_kind,
        "currency": entry.currency,
        "amount": entry.amount,
        "sourceKind": entry.source_kind,
        "sourceRef": entry.source_ref,
        "scopeKey": entry.scope_key,
        "recordedAt": entry.recorded_at.isoformat(),
    }


def _policy_body(policy) -> dict | None:
    if policy is None:
        return None
    return {
        "key": policy.key,
        "version": policy.version,
        "provisional": policy.is_development_fixture or policy.economy_approved_at is None,
    }


def totals_body(child) -> dict:
    projection = ProgressionProjection.objects.for_child(child).first()
    if projection is None:
        return {"xp": 0, "learningPoints": 0, "coins": 0, "stars": 0}
    return {
        "xp": projection.xp,
        "learningPoints": projection.learning_points,
        "coins": projection.coins,
        "stars": projection.stars,
    }


def level_body(xp: int, policy) -> dict:
    progress = rules.level_for(xp, list(policy.level_thresholds) if policy else [0])
    return {
        "level": progress.level,
        "xp": progress.xp,
        "levelFloorXp": progress.level_floor_xp,
        "nextLevelXp": progress.next_level_xp,
    }


def achievements_body(child) -> list[dict]:
    rows = (
        InventoryItem.objects.for_child(child)
        .filter(item__category="KEEPSAKE")
        .select_related("item")
        .order_by("acquired_at", "item__item_id")
    )
    return [
        {
            "itemId": row.item.item_id,
            "displayName": row.item.display_name,
            "description": row.item.description,
            "acquiredAt": row.acquired_at.isoformat(),
        }
        for row in rows
    ]


def trophies_body(child) -> list[dict]:
    owned = {
        row.item_id: row for row in InventoryItem.objects.for_child(child).select_related("item")
    }
    trophies = []
    for collectible_set in (
        CollectibleSet.objects.exclude(completion_item=None)
        .select_related("completion_item")
        .order_by("set_id")
    ):
        row = owned.get(collectible_set.completion_item_id)
        if row is None:
            continue
        trophies.append(
            {
                "setId": collectible_set.set_id,
                "displayName": collectible_set.display_name,
                "itemId": row.item.item_id,
                "acquiredAt": row.acquired_at.isoformat(),
            }
        )
    return trophies


def adventures_body(child) -> list[dict]:
    entries = AwardLedgerEntry.objects.for_child(child).exclude(scope_key="")
    by_scope: dict[str, dict] = defaultdict(
        lambda: {"xp": 0, "learningPoints": 0, "coins": 0, "stars": 0}
    )
    field = {
        Currency.XP: "xp",
        Currency.LEARNING_POINTS: "learningPoints",
        Currency.COINS: "coins",
        Currency.STAR: "stars",
    }
    for row in entries.values("scope_key", "currency").annotate(total=Sum("amount")):
        by_scope[row["scope_key"]][field[Currency(row["currency"])]] = max(0, row["total"] or 0)
    bests: dict[str, int] = {}
    per_visit = (
        entries.filter(currency=Currency.XP, entry_kind=EntryKind.AWARD, session__isnull=False)
        .values("scope_key", "session")
        .annotate(total=Sum("amount"))
    )
    for row in per_visit:
        bests[row["scope_key"]] = max(bests.get(row["scope_key"], 0), row["total"] or 0)
    return [
        {
            "scopeKey": scope,
            **values,
            "maxStars": rules.MAX_STARS,
            "personalBest": {"xpInOneVisit": bests[scope]} if scope in bests else None,
        }
        for scope, values in sorted(by_scope.items())
    ]


def subjects_body(child) -> list[dict]:
    domains = dict(LearningObjective.objects.values_list("code", "domain"))
    counts: dict[str, dict] = defaultdict(lambda: {"objectives": 0, "proficient": 0, "mastered": 0})
    for progress in SkillProgress.objects.for_child(child):
        subject = domains.get(progress.learning_objective_code) or "other"
        bucket = counts[subject]
        bucket["objectives"] += 1
        if progress.recent_level == SkillStatus.PROFICIENT:
            bucket["proficient"] += 1
        elif progress.recent_level == SkillStatus.MASTERED:
            bucket["mastered"] += 1
    return [{"subject": subject, **values} for subject, values in sorted(counts.items())]


def summary(child) -> dict:
    """GET children/{id}/scoring/. When scoring is off, only `enabled: false` is returned and
    the client shows nothing numeric (achievements still live in the backpack)."""
    policy = policies.awarding_policy()
    if policy is None:
        return {"enabled": False, "contractVersion": CONTRACT_VERSION}
    totals = totals_body(child)
    recent = AwardLedgerEntry.objects.for_child(child).filter(entry_kind=EntryKind.AWARD)
    return {
        "enabled": True,
        "contractVersion": CONTRACT_VERSION,
        "policy": _policy_body(policy),
        "totals": totals,
        "level": level_body(totals["xp"], policy),
        "achievements": achievements_body(child),
        "trophies": trophies_body(child),
        "adventures": adventures_body(child),
        "subjects": subjects_body(child),
        "recentAwards": [
            award_body(e) for e in recent.order_by("-recorded_at", "-id")[:RECENT_LIMIT]
        ],
    }


def award_feed(child, after: AwardLedgerEntry | None) -> dict:
    """Awards recorded after `after`, oldest first, so the client can confirm pending awards."""
    rows = AwardLedgerEntry.objects.for_child(child).order_by("recorded_at", "id")
    if after is not None:
        rows = rows.filter(recorded_at__gte=after.recorded_at).exclude(
            recorded_at=after.recorded_at, id__lte=after.id
        )
    page = list(rows[:FEED_LIMIT])
    return {
        "awards": [award_body(e) for e in page],
        "cursor": str(page[-1].pk) if page else (str(after.pk) if after else None),
        "hasMore": len(page) == FEED_LIMIT,
    }
