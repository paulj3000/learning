"""Scoring policies, the award ledger and the progression projection (GE-102, GE-103).

Three tables, one direction of authority:

    ScoringPolicy + AwardRule  ->  AwardLedgerEntry  ->  ProgressionProjection
    (versioned configuration)      (append-only truth)    (a cache, rebuilt from the ledger)

Existing rewards are not duplicated: items, keepsakes, badges, journal entries and collectible
sets stay `catalog.ItemDefinition` / `catalog.RewardRule` granted once through
`inventory.GrantedRule`. A granted rule is one of the facts the ledger can count
(`SourceKind.REWARD_RULE_GRANTED`); achievements and trophies are projections of inventory
(`projections.py`), not rows here.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils.timezone import now

from apps.core.models import ChildOwnedModel

from . import rules as rule_logic
from .contracts import Currency, EntryKind, SourceKind, Trust


class PolicyStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft (editable, never awards)"
    ACTIVE = "ACTIVE", "Active (frozen)"
    RETIRED = "RETIRED", "Retired (frozen, kept for audit)"


class ImmutablePolicy(ValueError):
    """An active or retired policy, or one of its rules, was about to be edited."""


class AppendOnlyLedger(ValueError):
    """A ledger entry was about to be edited or deleted outside a parent's privacy erasure."""


#: The only fields `policies.py` changes on a frozen policy: its lifecycle and approval stamp.
LIFECYCLE_FIELDS = {
    "status",
    "activated_at",
    "retired_at",
    "economy_approved_at",
    "economy_approved_by",
}

TRUST_CHOICES = [(t.value, t.name) for t in Trust if t >= Trust.SERVER_BOUNDED]


class ScoringPolicy(models.Model):
    """One version of the economy's rules. Only DRAFT versions are edited; activating a version
    freezes it and retires the previous active version of the same key.

    `economy_approved_at` is the owner's approval (GE-100: "do not activate unapproved
    economy"). Outside development and test settings (`LAI_SCORING_ALLOW_UNAPPROVED`), a policy
    without it awards nothing, whatever its status.
    """

    key = models.SlugField(max_length=50, default="default")
    version = models.PositiveIntegerField()
    status = models.CharField(
        max_length=8, choices=PolicyStatus.choices, default=PolicyStatus.DRAFT
    )
    title = models.CharField(max_length=120, help_text="Staff label, never shown to a child.")
    notes = models.TextField(blank=True, help_text="Why this version exists. Staff only.")
    level_thresholds = models.JSONField(
        default=list,
        help_text="Total XP at which each level starts, ascending, first 0. [0, 500] = 2 levels.",
    )
    is_development_fixture = models.BooleanField(
        default=False,
        help_text="Provisional development values (GE-100). Never eligible for economy approval.",
    )
    economy_approved_at = models.DateTimeField(null=True, blank=True, editable=False)
    economy_approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
        editable=False,
    )
    created_at = models.DateTimeField(default=now, editable=False)
    activated_at = models.DateTimeField(null=True, blank=True, editable=False)
    retired_at = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        ordering = ["key", "-version"]
        verbose_name_plural = "scoring policies"
        constraints = [
            models.UniqueConstraint(fields=["key", "version"], name="scoring_policy_version_once"),
            models.UniqueConstraint(
                fields=["key"],
                condition=Q(status="ACTIVE"),
                name="scoring_policy_one_active",
            ),
            models.CheckConstraint(
                condition=Q(economy_approved_at__isnull=True) | Q(is_development_fixture=False),
                name="scoring_fixture_never_approved",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.key} v{self.version} ({self.status})"

    @property
    def is_frozen(self) -> bool:
        return self.status != PolicyStatus.DRAFT

    def clean(self):
        problems = rule_logic.threshold_problems(self.level_thresholds or [])
        if problems:
            raise ValidationError({"level_thresholds": problems})

    def save(self, *args, **kwargs):
        if not self._state.adding:
            stored = type(self).objects.filter(pk=self.pk).values("status").first()
            frozen = stored is not None and stored["status"] != PolicyStatus.DRAFT
            lifecycle_only = set(kwargs.get("update_fields") or ()) <= LIFECYCLE_FIELDS
            if frozen and not (kwargs.get("update_fields") and lifecycle_only):
                raise ImmutablePolicy("Clone a frozen policy to a new draft version instead.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.is_frozen:
            raise ImmutablePolicy("Frozen policies are kept for audit.")
        return super().delete(*args, **kwargs)

    def rule_specs(self) -> list[rule_logic.RuleSpec]:
        return [rule.spec() for rule in self.rules.filter(enabled=True).order_by("rule_key")]


class AwardRule(models.Model):
    """One line of a policy: this kind of accomplishment earns this much of this currency."""

    policy = models.ForeignKey(ScoringPolicy, on_delete=models.PROTECT, related_name="rules")
    rule_key = models.SlugField(max_length=80, help_text="Stable within the policy's key.")
    source_kind = models.CharField(max_length=32, choices=[(k.value, k.value) for k in SourceKind])
    selector = models.CharField(
        max_length=150,
        blank=True,
        help_text="Empty: every source. 'id': exactly that source. 'prefix*': every source "
        "whose id starts with prefix (e.g. 'firepeak-*').",
    )
    attribute_equals = models.JSONField(
        default=dict,
        blank=True,
        help_text='Optional fact attributes that must match, e.g. {"itemCategory": "KEEPSAKE"}.',
    )
    currency = models.CharField(max_length=16, choices=[(c.value, c.value) for c in Currency])
    amount = models.PositiveIntegerField()
    stacking_group = models.SlugField(
        max_length=60,
        blank=True,
        help_text="Rules in one group and currency never add up: the most specific wins. "
        "Keep a group's name across policy versions, or earned awards could repeat.",
    )
    priority = models.SmallIntegerField(default=0)
    minimum_trust = models.PositiveSmallIntegerField(
        choices=TRUST_CHOICES, default=int(Trust.SERVER_BOUNDED)
    )
    enabled = models.BooleanField(default=True)

    class Meta:
        ordering = ["policy", "rule_key"]
        constraints = [
            models.UniqueConstraint(fields=["policy", "rule_key"], name="award_rule_key_once"),
            models.CheckConstraint(condition=Q(amount__gte=1), name="award_rule_amount_positive"),
            models.CheckConstraint(
                condition=Q(minimum_trust__gte=int(Trust.SERVER_BOUNDED)),
                name="award_rule_never_client_reported",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.rule_key}: {self.amount} {self.currency}"

    def spec(self) -> rule_logic.RuleSpec:
        return rule_logic.RuleSpec(
            rule_key=self.rule_key,
            source_kind=SourceKind(self.source_kind),
            currency=Currency(self.currency),
            amount=self.amount,
            selector=self.selector,
            stacking_group=self.stacking_group,
            priority=self.priority,
            minimum_trust=Trust(self.minimum_trust),
            attribute_equals=dict(self.attribute_equals or {}),
        )

    def clean(self):
        if not isinstance(self.attribute_equals, dict):
            raise ValidationError({"attribute_equals": "Must be a JSON object."})
        try:
            problems = rule_logic.rule_problems(self.spec())
        except ValueError as error:
            raise ValidationError(str(error)) from None
        if problems:
            raise ValidationError(problems)

    def _check_policy_editable(self):
        policy_id = self.policy_id
        status = ScoringPolicy.objects.filter(pk=policy_id).values_list("status", flat=True).first()
        if status is not None and status != PolicyStatus.DRAFT:
            raise ImmutablePolicy("Rules of an active or retired policy are frozen.")

    def save(self, *args, **kwargs):
        self._check_policy_editable()
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        self._check_policy_editable()
        return super().delete(*args, **kwargs)


class LedgerQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise AppendOnlyLedger("Ledger entries are never edited.")

    def erase_for_child(self, child) -> int:
        """A parent's privacy erasure (and child deletion): the one way entries leave.
        Not a correction: nothing is recomputed, the record is simply gone."""
        deleted, _ = models.QuerySet.delete(self.filter(child=child))
        return deleted

    def delete(self):
        raise AppendOnlyLedger("Use a CORRECTION entry, or a parent's erasure.")

    def for_child(self, child):
        return self.filter(child=child)


class AwardLedgerEntry(ChildOwnedModel):
    """One award (or one staff correction), recorded once. Append-only (GE-103)."""

    CHILD_LINKS = ("session",)

    idempotency_key = models.CharField(max_length=220)
    entry_kind = models.CharField(
        max_length=12,
        choices=[(k.value, k.value) for k in EntryKind],
        default=EntryKind.AWARD.value,
    )
    currency = models.CharField(max_length=16, choices=[(c.value, c.value) for c in Currency])
    amount = models.IntegerField()
    source_kind = models.CharField(max_length=32, choices=[(k.value, k.value) for k in SourceKind])
    source_ref = models.CharField(max_length=200)
    scope_key = models.CharField(max_length=120, blank=True)
    trust = models.PositiveSmallIntegerField(choices=[(t.value, t.name) for t in Trust])
    policy = models.ForeignKey(
        ScoringPolicy, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    policy_version = models.PositiveIntegerField(null=True, blank=True)
    rule = models.ForeignKey(
        AwardRule, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    session = models.ForeignKey(
        "game_sessions.AdventureSession",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    corrects = models.ForeignKey(
        # RESTRICT, not PROTECT: a child's deletion or erasure removes an entry and its
        # corrections together, which PROTECT would refuse.
        "self",
        on_delete=models.RESTRICT,
        null=True,
        blank=True,
        related_name="corrections",
    )
    reason = models.CharField(
        max_length=300, blank=True, help_text="Corrections only. Staff text, no child data."
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    occurred_at = models.DateTimeField()
    recorded_at = models.DateTimeField(default=now)

    objects = LedgerQuerySet.as_manager()

    class Meta:
        ordering = ["recorded_at", "id"]
        verbose_name_plural = "award ledger entries"
        constraints = [
            models.UniqueConstraint(fields=["child", "idempotency_key"], name="ledger_award_once"),
            models.CheckConstraint(
                condition=Q(entry_kind="AWARD", amount__gt=0, corrects__isnull=True)
                | Q(entry_kind="CORRECTION", corrects__isnull=False) & ~Q(amount=0) & ~Q(reason=""),
                name="ledger_entry_shape",
            ),
            models.CheckConstraint(condition=~Q(source_ref=""), name="ledger_source_ref_set"),
        ]
        indexes = [
            models.Index(fields=["child", "recorded_at"], name="ledger_child_recorded"),
            models.Index(fields=["child", "scope_key"], name="ledger_child_scope"),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise AppendOnlyLedger("Ledger entries are never edited.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise AppendOnlyLedger("Use a CORRECTION entry, or a parent's erasure.")


class ProgressionProjection(ChildOwnedModel):
    """Per-child totals, kept in step with the ledger in the same transaction. Disposable:
    `ledger.rebuild_projection` recomputes it exactly from the ledger at any time."""

    xp = models.PositiveIntegerField(default=0)
    learning_points = models.PositiveIntegerField(default=0)
    coins = models.PositiveIntegerField(default=0)
    stars = models.PositiveIntegerField(default=0)
    entry_count = models.PositiveIntegerField(default=0)
    last_entry_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["child"], name="progression_projection_one")]
