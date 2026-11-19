"""Policy lifecycle and the economy gate (GE-102).

DRAFT -> ACTIVE -> RETIRED. A draft is the only editable state. Activating one freezes it and
retires the key's previous active version in the same transaction (the database allows one
active version per key). A frozen version is changed only by cloning it to a new draft.

Whether anything is awarded at all is `awarding_policy()`, three gates in order:

1. `LAI_SCORING_ENABLED` (default off): the whole engine.
2. An ACTIVE policy for the key.
3. The owner's economy approval on that policy, unless the settings allow unapproved
   (development fixture) policies, which only local development and test settings do.

GE-100 says "values and level thresholds provisional; do not activate unapproved economy".
Gate 3 is how the code keeps that promise: a development fixture can never be approved (a
database constraint), so provisional values can never award in a deployed environment.
"""

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import AwardRule, ScoringPolicy
from .models import PolicyStatus as Status

DEFAULT_KEY = "default"


class PolicyError(ValueError):
    pass


def engine_enabled() -> bool:
    return bool(getattr(settings, "LAI_SCORING_ENABLED", False))


def unapproved_allowed() -> bool:
    return bool(getattr(settings, "LAI_SCORING_ALLOW_UNAPPROVED", False))


def active_policy(key: str = DEFAULT_KEY) -> ScoringPolicy | None:
    return ScoringPolicy.objects.filter(key=key, status=Status.ACTIVE).first()


def awarding_policy(key: str = DEFAULT_KEY) -> ScoringPolicy | None:
    """The policy awards are decided under right now, or None when nothing may be awarded."""
    if not engine_enabled():
        return None
    policy = active_policy(key)
    if policy is None:
        return None
    if policy.economy_approved_at is None and not unapproved_allowed():
        return None
    return policy


@transaction.atomic
def activate(policy: ScoringPolicy) -> ScoringPolicy:
    policy = ScoringPolicy.objects.select_for_update().get(pk=policy.pk)
    if policy.status != Status.DRAFT:
        raise PolicyError("Only a draft can be activated.")
    policy.full_clean()
    for rule in policy.rules.all():
        rule.full_clean()
    at = timezone.now()
    previous = ScoringPolicy.objects.select_for_update().filter(
        key=policy.key, status=Status.ACTIVE
    )
    for old in previous:
        old.status = Status.RETIRED
        old.retired_at = at
        old.save(update_fields=["status", "retired_at"])
    policy.status = Status.ACTIVE
    policy.activated_at = at
    policy.save(update_fields=["status", "activated_at"])
    return policy


@transaction.atomic
def retire(policy: ScoringPolicy) -> ScoringPolicy:
    policy = ScoringPolicy.objects.select_for_update().get(pk=policy.pk)
    if policy.status != Status.ACTIVE:
        raise PolicyError("Only the active version can be retired.")
    policy.status = Status.RETIRED
    policy.retired_at = timezone.now()
    policy.save(update_fields=["status", "retired_at"])
    return policy


@transaction.atomic
def record_economy_approval(policy: ScoringPolicy, user) -> ScoringPolicy:
    """Stamp the owner's approval. Superusers only (the admin checks too); never a fixture."""
    if not (getattr(user, "is_active", False) and getattr(user, "is_superuser", False)):
        raise PolicyError("Only a superuser can record the owner's economy approval.")
    policy = ScoringPolicy.objects.select_for_update().get(pk=policy.pk)
    if policy.is_development_fixture:
        raise PolicyError("Development fixture values can never be approved.")
    if policy.economy_approved_at is not None:
        return policy
    policy.economy_approved_at = timezone.now()
    policy.economy_approved_by = user
    policy.save(update_fields=["economy_approved_at", "economy_approved_by"])
    return policy


@transaction.atomic
def clone_to_draft(policy: ScoringPolicy, *, title: str | None = None) -> ScoringPolicy:
    """A new draft version with the same rules. Approval is not copied: it is per version."""
    latest = (
        ScoringPolicy.objects.select_for_update()
        .filter(key=policy.key)
        .order_by("-version")
        .first()
    )
    draft = ScoringPolicy.objects.create(
        key=policy.key,
        version=latest.version + 1,
        title=title or policy.title,
        notes=f"Cloned from v{policy.version}.",
        level_thresholds=list(policy.level_thresholds),
        is_development_fixture=policy.is_development_fixture,
    )
    for rule in policy.rules.order_by("rule_key"):
        AwardRule.objects.create(
            policy=draft,
            rule_key=rule.rule_key,
            source_kind=rule.source_kind,
            selector=rule.selector,
            attribute_equals=dict(rule.attribute_equals or {}),
            currency=rule.currency,
            amount=rule.amount,
            stacking_group=rule.stacking_group,
            priority=rule.priority,
            minimum_trust=rule.minimum_trust,
            enabled=rule.enabled,
        )
    return draft
