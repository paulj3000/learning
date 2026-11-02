"""AI interaction audit and safety events (LAI-0306, extended by LAI-0704).

Same fields as the Amplify `AIInteractionAudit` and `SafetyEvent` models
(amplify/data/resource.ts, docs/DATA_MODEL.md), so imported Amplify rows and new Django rows can
be read side by side. Django adds metadata the server can know and the browser could not:
provider, Guardrail, failure category, token counts, where the context came from, and the
request correlation id.

Privacy (CLAUDE.md section 13, docs/AI_AND_CHILD_SAFETY.md): there is no column for anything a
child typed or said, for the prompt, or for the model's text. Every string column is a closed
vocabulary or an identifier. Rows are written only by `services/auditing.py`, from values the
server computed; no endpoint accepts them from a client.
"""

from django.db import models
from django.db.models import Q
from django.utils.timezone import now

from apps.core.models import ChildOwnedModel


class RouteName(models.TextChoices):
    # The Amplify route names, kept so audit rows from both backends compare directly.
    COMPANION = "generateCompanionTurn"
    TUTOR = "generateTutorTurn"


class ValidationStatus(models.TextChoices):
    # The four Amplify values.
    VALID = "VALID"
    INVALID_SCHEMA = "INVALID_SCHEMA"
    INVALID_CONTENT = "INVALID_CONTENT"
    ERROR = "ERROR"
    # Django only (LAI-0704): the model was not asked, or its answer was withheld.
    BLOCKED_INPUT = "BLOCKED_INPUT"
    BLOCKED_GUARDRAIL = "BLOCKED_GUARDRAIL"
    RATE_LIMITED = "RATE_LIMITED"


class SafetyDisposition(models.TextChoices):
    ALLOW = "ALLOW"
    REDIRECT = "REDIRECT"
    STOP = "STOP"


class Provider(models.TextChoices):
    BEDROCK = "bedrock"
    FAKE = "fake"
    NONE = "none"  # no model call was made


class GuardrailAction(models.TextChoices):
    NONE = "NONE"  # a Guardrail was applied and did not intervene
    INTERVENED = "INTERVENED"
    NOT_APPLIED = "NOT_APPLIED"  # no model call, or the fake provider


class FailureCategory(models.TextChoices):
    NONE = ""
    TIMEOUT = "TIMEOUT"
    THROTTLED = "THROTTLED"
    ACCESS_DENIED = "ACCESS_DENIED"
    UNAVAILABLE = "UNAVAILABLE"
    CONFIGURATION = "CONFIGURATION"
    REQUEST_REJECTED = "REQUEST_REJECTED"
    INVALID_RESPONSE = "INVALID_RESPONSE"
    TRUNCATED = "TRUNCATED"
    RATE_LIMIT_UNAVAILABLE = "RATE_LIMIT_UNAVAILABLE"
    KILL_SWITCH = "KILL_SWITCH"
    UNKNOWN = "UNKNOWN"


class ContextSource(models.TextChoices):
    # The browser assembled the authored context (Amplify-era callers, NPC and story scenes).
    CLIENT_AUTHORED = "CLIENT_AUTHORED"
    # Django derived it from its own session and catalog rows.
    DJANGO_SESSION = "DJANGO_SESSION"


class AIInteractionAudit(ChildOwnedModel):
    """One AI turn request that reached the pipeline. Metadata only, never text."""

    # Opaque correlation ids. A CLIENT_AUTHORED turn may carry an Amplify session id, so these
    # are strings, never foreign keys, and they are never looked up.
    session_id = models.CharField(max_length=100, blank=True)
    step_id = models.CharField(max_length=100, blank=True)
    route_name = models.CharField(max_length=32, choices=RouteName.choices)
    prompt_template_version = models.PositiveIntegerField()
    model_id = models.CharField(max_length=128)
    # Closed vocabulary: the requested intent or `TUTOR_<STRATEGY>`.
    input_category = models.CharField(max_length=48)
    output_schema_version = models.PositiveSmallIntegerField()
    validation_status = models.CharField(max_length=24, choices=ValidationStatus.choices)
    safety_disposition = models.CharField(max_length=16, choices=SafetyDisposition.choices)
    fallback_used = models.BooleanField()
    latency_ms = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(default=now, editable=False)
    # --- Django only (LAI-0704) ---
    provider = models.CharField(max_length=16, choices=Provider.choices)
    context_source = models.CharField(max_length=24, choices=ContextSource.choices)
    guardrail_id = models.CharField(max_length=64, blank=True)
    guardrail_version = models.CharField(max_length=16, blank=True)
    guardrail_action = models.CharField(max_length=16, choices=GuardrailAction.choices)
    failure_category = models.CharField(max_length=24, choices=FailureCategory.choices, blank=True)
    input_tokens = models.PositiveIntegerField(null=True, blank=True)
    output_tokens = models.PositiveIntegerField(null=True, blank=True)
    # An estimate from the configured, versioned price table (`services/costs.py`); null when no
    # price is configured or Bedrock reported no usage. Never a billed amount.
    estimated_cost_microusd = models.PositiveIntegerField(null=True, blank=True)
    # The request correlation id (apps/core/request_context.py): correlation only, not proof.
    request_id = models.CharField(max_length=64, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(route_name__in=RouteName.values), name="ai_audit_route_valid"
            ),
            models.CheckConstraint(
                condition=Q(validation_status__in=ValidationStatus.values),
                name="ai_audit_validation_valid",
            ),
            models.CheckConstraint(
                condition=Q(safety_disposition__in=SafetyDisposition.values),
                name="ai_audit_disposition_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["child", "created_at"], name="ai_audit_child_created"),
            models.Index(fields=["validation_status", "created_at"], name="ai_audit_status"),
            # Retention scans by age alone; support looks a turn up by its request id (LAI-0707).
            models.Index(fields=["created_at"], name="ai_audit_created"),
            models.Index(fields=["request_id"], name="ai_audit_request"),
        ]


class SafetyEventSeverity(models.TextChoices):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class SafetyEventSource(models.TextChoices):
    INPUT = "INPUT"
    OUTPUT = "OUTPUT"
    SYSTEM = "SYSTEM"


class SafetyEventReviewStatus(models.TextChoices):
    OPEN = "OPEN"
    REVIEWED = "REVIEWED"
    DISMISSED = "DISMISSED"


class SafetyAction(models.TextChoices):
    # Amplify wrote this sentence as free text; Django keeps it as a fixed code.
    REPLACED_WITH_FALLBACK = "REPLACED_WITH_FALLBACK", "Replaced with authored fallback content."
    BLOCKED_BEFORE_MODEL = "BLOCKED_BEFORE_MODEL", "Not sent to the model; authored content shown."


class SafetyEvent(ChildOwnedModel):
    """A turn whose input or output tripped a safety rule. Review scaffolding, never text."""

    session_id = models.CharField(max_length=100, blank=True)
    # Closed vocabulary built by the server, e.g. `companion-turn-hint`, `tutor-input-pii`.
    category = models.CharField(max_length=64)
    severity = models.CharField(max_length=8, choices=SafetyEventSeverity.choices)
    source = models.CharField(max_length=8, choices=SafetyEventSource.choices)
    action_taken = models.CharField(max_length=32, choices=SafetyAction.choices)
    review_status = models.CharField(
        max_length=16,
        choices=SafetyEventReviewStatus.choices,
        default=SafetyEventReviewStatus.OPEN,
    )
    created_at = models.DateTimeField(default=now, editable=False)
    # --- Django only ---
    route_name = models.CharField(max_length=32, choices=RouteName.choices)
    audit = models.ForeignKey(
        AIInteractionAudit,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="safety_events",
    )
    request_id = models.CharField(max_length=64, blank=True)

    CHILD_LINKS = ("audit",)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(severity__in=SafetyEventSeverity.values),
                name="safety_event_severity_valid",
            ),
            models.CheckConstraint(
                condition=Q(source__in=SafetyEventSource.values), name="safety_event_source_valid"
            ),
            models.CheckConstraint(
                condition=Q(review_status__in=SafetyEventReviewStatus.values),
                name="safety_event_review_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["review_status", "created_at"], name="safety_event_review"),
            models.Index(fields=["child", "created_at"], name="safety_event_child_created"),
            models.Index(fields=["request_id"], name="safety_event_request"),
        ]


class UsageScope(models.TextChoices):
    CHILD_MINUTE = "child-minute"
    CHILD_DAY = "child-day"
    FAMILY_DAY = "family-day"
    SESSION_DAY = "session-day"
    GLOBAL_DAY = "global-day"
    CHILD_INFLIGHT = "child-inflight"


class AIUsageCounter(models.Model):
    """One fixed-window request counter, shared by every Django process (LAI-0708).

    Incremented with one atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`
    (`services/usage.py`), so concurrent workers and instances never lose a count. `subject` is
    an opaque key (`child:<uuid>`, `family:<uuid>`, `session:<child>:<id>`, `global`); the
    foreign keys exist only so deleting a child or parent deletes its counters. Rows older than
    two days are pruned as new windows are written.
    """

    scope = models.CharField(max_length=16, choices=UsageScope.choices)
    subject = models.CharField(max_length=160)
    window_start = models.DateTimeField()
    count = models.IntegerField(default=0)
    child = models.ForeignKey(
        "users.ChildProfile", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    parent = models.ForeignKey(
        "users.ParentAccount", on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["scope", "subject", "window_start"], name="ai_usage_counter_window"
            ),
        ]
        indexes = [models.Index(fields=["window_start"], name="ai_usage_window")]


class AIServiceControl(models.Model):
    """The runtime AI kill switch (LAI-0708): one row, changed by a superuser in Django Admin.

    When `model_calls_enabled` is false, no turn reaches a model; every child gets authored
    content, gameplay continues. Takes effect within `CONTROL_CACHE_SECONDS` on every process,
    without a deploy. `LAI_AI_PROVIDER=disabled` remains the deploy-time switch.
    """

    model_calls_enabled = models.BooleanField(default=True)
    reason = models.CharField(
        max_length=200, blank=True, help_text="Operational note, never child data."
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "AI service control"
        verbose_name_plural = "AI service control"
        constraints = [
            models.CheckConstraint(condition=Q(pk=1), name="ai_service_control_singleton"),
        ]
