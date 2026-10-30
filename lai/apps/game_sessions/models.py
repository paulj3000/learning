"""Adventure sessions, their step attempts, and household co-op sessions (LAI-0305).

Mirrors the Amplify `AdventureSession`, `AdventureAction` and `CoopSession` models so Phase 11
can migrate them, with two changes: the adventure is a foreign key to the catalog row (catalog
rows are never deleted by an import, so the reference survives a content release that drops the
adventure), and co-op participants are rows instead of an id array.

A session is the child's adventure progress: the current step, the status, and the timestamps.
Step progress is derived from the session's actions, one row per attempt; a step is completed
once an attempt has moved the session past it. No separate step-progress table exists because
the canonical model does not need one.

The values written here come from server-side rule code (`apps.game_sessions.services`, then
LAI-0601's Python validators). No endpoint writes them yet, and no client value is trusted.
"""

import uuid

from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.db.models import F, Q
from django.utils.timezone import now

from apps.core.models import ChildOwnedModel
from apps.education.challenges import Correctness as ChallengeCorrectness
from apps.education.challenges import MathChallenge, Operation, ResponseMode
from apps.users.models import AgeBand

MAX_HINT_LEVEL = 5  # react/src/features/adventures/engine/hints.ts: MAX_HINT_LEVEL
# An authored transition may end an adventure without a step of this name (docs/DATA_MODEL.md).
COMPLETE_STEP_ID = "complete"


class SessionKind(models.TextChoices):
    """A step-based adventure, or free play in a seed-authored region (Treasure Rush, TR-D9)."""

    ADVENTURE = "ADVENTURE", "Step-based adventure"
    REGION = "REGION", "Explorable region"


class SessionStatus(models.TextChoices):
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    ABANDONED = "ABANDONED"
    SAFETY_STOPPED = "SAFETY_STOPPED"


# Region sessions can be paused and resumed (TR-5); adventure sessions only use ACTIVE today.
OPEN_STATUSES = (SessionStatus.ACTIVE, SessionStatus.PAUSED)


class Correctness(models.TextChoices):
    CORRECT = "CORRECT"
    INCORRECT = "INCORRECT"
    PARTIAL = "PARTIAL"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class CoopSessionStatus(models.TextChoices):
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    ABANDONED = "ABANDONED"


class AdventureSession(ChildOwnedModel):
    """A child's play session. ADVENTURE: one catalog adventure, step by step (LAI-0601).
    REGION: free play in a seed-authored region such as Treasure Cove (TR-5), identified by
    the region's slug (regions are not catalog rows; see `apps.regions`)."""

    kind = models.CharField(
        max_length=16, choices=SessionKind.choices, default=SessionKind.ADVENTURE
    )
    adventure = models.ForeignKey(
        "catalog.Adventure",
        on_delete=models.PROTECT,
        related_name="sessions",
        null=True,
        blank=True,
    )
    template_version = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="The adventure's version when the session started; it never changes after.",
    )
    region_id = models.SlugField(max_length=80, blank=True)
    location_slug = models.SlugField(max_length=100, blank=True)
    content_release = models.ForeignKey(
        "catalog.ContentRelease",
        on_delete=models.PROTECT,
        related_name="+",
        help_text="The latest content release when the session started.",
    )
    status = models.CharField(max_length=16, choices=SessionStatus.choices)
    current_step_id = models.CharField(max_length=100, blank=True)
    hint_levels = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            "Step id -> the hint level the server has given (LAI-0601); never a client value."
        ),
    )
    coop_session = models.ForeignKey(
        "game_sessions.CoopSession",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="adventure_sessions",
    )
    started_at = models.DateTimeField()
    last_activity_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=SessionStatus.values), name="session_status_valid"
            ),
            models.CheckConstraint(
                condition=(
                    Q(
                        kind=SessionKind.ADVENTURE,
                        adventure__isnull=False,
                        template_version__isnull=False,
                        region_id="",
                    )
                    | (
                        Q(
                            kind=SessionKind.REGION,
                            adventure__isnull=True,
                            template_version__isnull=True,
                        )
                        & ~Q(region_id="")
                    )
                ),
                name="session_target_matches_kind",
            ),
            models.CheckConstraint(
                condition=(Q(status=SessionStatus.COMPLETED) & Q(completed_at__isnull=False))
                | (~Q(status=SessionStatus.COMPLETED) & Q(completed_at__isnull=True)),
                name="session_completed_at_iff_completed",
            ),
            models.CheckConstraint(
                condition=Q(last_activity_at__gte=F("started_at")),
                name="session_activity_after_start",
            ),
            # resumeOrStartSession reuses the active session; the database now guarantees one.
            models.UniqueConstraint(
                fields=["child", "adventure"],
                condition=Q(status=SessionStatus.ACTIVE),
                name="session_one_active_per_child_adventure",
            ),
            models.UniqueConstraint(
                fields=["child", "region_id"],
                condition=Q(kind=SessionKind.REGION, status__in=OPEN_STATUSES),
                name="session_one_open_per_child_region",
            ),
        ]
        indexes = [
            models.Index(fields=["child", "status"], name="session_child_status"),
            models.Index(fields=["child", "-last_activity_at"], name="session_child_recent"),
        ]

    @property
    def is_open(self) -> bool:
        return self.status in OPEN_STATUSES


class AdventureAction(models.Model):
    """One attempt at one step. Reached only through its session, never by id alone."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(AdventureSession, on_delete=models.CASCADE, related_name="actions")
    step_id = models.CharField(max_length=100)
    action_type = models.CharField(max_length=32)
    normalized_answer = models.CharField(
        max_length=200,
        blank=True,
        help_text="The structured answer (an option id, a number, an order), never free text.",
    )
    correctness = models.CharField(max_length=16, choices=Correctness.choices)
    hint_level = models.PositiveSmallIntegerField(default=0)
    attempt_number = models.PositiveIntegerField()
    next_step_id = models.CharField(
        max_length=100,
        blank=True,
        help_text="Where this attempt moved the session; empty if it stayed.",
    )
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    request_id = models.UUIDField(
        null=True,
        blank=True,
        help_text=(
            "Client-generated id of the submission (ADR-015's requestId); "
            "replays return the stored outcome."
        ),
    )
    created_at = models.DateTimeField()

    class Meta:
        ordering = ["session", "created_at", "attempt_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["session", "request_id"],
                condition=Q(request_id__isnull=False),
                name="action_request_once",
            ),
            models.UniqueConstraint(
                fields=["session", "step_id", "attempt_number"], name="action_unique_attempt"
            ),
            models.CheckConstraint(
                condition=Q(attempt_number__gte=1), name="action_attempt_from_one"
            ),
            models.CheckConstraint(
                condition=Q(hint_level__lte=MAX_HINT_LEVEL), name="action_hint_level_on_ladder"
            ),
            models.CheckConstraint(
                condition=Q(correctness__in=Correctness.values), name="action_correctness_valid"
            ),
        ]

    def __str__(self) -> str:
        return f"action {self.id}"


class CoopSession(models.Model):
    """A household co-presence session (ADR-006): one host parent, that parent's children."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    host_parent = models.ForeignKey(
        "users.ParentAccount", on_delete=models.PROTECT, related_name="+", editable=False
    )
    adventure = models.ForeignKey("catalog.Adventure", on_delete=models.PROTECT, related_name="+")
    template_version = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=CoopSessionStatus.choices)
    shared_state = models.JSONField(
        null=True, blank=True, help_text="Slot claims and presence, as Amplify stores them."
    )
    started_at = models.DateTimeField()
    last_activity_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=CoopSessionStatus.values), name="coop_status_valid"
            ),
        ]

    def __str__(self) -> str:
        return f"coop session {self.id}"


class CoopParticipant(models.Model):
    """One child in a co-op session (Amplify's `participantChildProfileIds`, as rows)."""

    coop_session = models.ForeignKey(
        CoopSession, on_delete=models.CASCADE, related_name="participants"
    )
    child = models.ForeignKey("users.ChildProfile", on_delete=models.CASCADE, related_name="+")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["coop_session", "child"], name="coop_participant_once"),
        ]

    def __str__(self) -> str:
        return f"coop participant {self.pk}"


class AttemptStatus(models.TextChoices):
    ISSUED = "ISSUED", "Shown, not answered"
    ANSWERED = "ANSWERED"


class ImmutableRecord(ValueError):
    """An answered attempt, or an attempt's snapshot, was about to be changed."""


# What the child was shown and how it was generated. Fixed when the attempt is issued.
SNAPSHOT_FIELDS = (
    "child_id",
    "session_id",
    "region_id",
    "target_entity_id",
    "challenge_spec_slug",
    "age_band",
    "skill_id",
    "min_value",
    "max_value",
    "response_mode",
    "choice_count",
    "seed",
    "operation",
    "operands",
    "choices",
    "answer",
    "attempt_number",
)


class ChallengeAttempt(ChildOwnedModel):
    """One server-generated challenge (Treasure Rush TR-4): a typed event that snapshots what the
    child was shown, so editing or deleting the spec or the chest never changes history. The
    expected answer is stored for grading and never sent to a client."""

    CHILD_LINKS = ("session",)
    session = models.ForeignKey(
        AdventureSession, on_delete=models.CASCADE, related_name="challenge_attempts"
    )
    # Where: snapshot ids, plus convenience links that go null if the content is deleted.
    region_id = models.SlugField(max_length=80)
    target_entity_id = models.SlugField(max_length=80, help_text="e.g. the chest's entity id")
    chest = models.ForeignKey(
        "regions.TreasureChest", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    challenge_spec = models.ForeignKey(
        "education.ChallengeSpec",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="attempts",
    )
    challenge_spec_slug = models.SlugField(max_length=80)
    # Context needed to interpret the attempt: the child's band and the curriculum skill.
    age_band = models.CharField(max_length=16, choices=AgeBand.choices)
    skill_id = models.CharField(max_length=80)
    # The parameters as they were when issued (the spec may be edited later).
    min_value = models.PositiveSmallIntegerField()
    max_value = models.PositiveSmallIntegerField()
    response_mode = models.CharField(
        max_length=16, choices=[(mode.value, mode.value) for mode in ResponseMode]
    )
    choice_count = models.PositiveSmallIntegerField()
    seed = models.BigIntegerField()
    # What was presented, and the server-only answer.
    operation = models.CharField(max_length=16, choices=[(op.value, op.value) for op in Operation])
    operands = ArrayField(models.SmallIntegerField())
    choices = ArrayField(models.SmallIntegerField(), default=list, blank=True)
    answer = models.SmallIntegerField()
    attempt_number = models.PositiveSmallIntegerField()
    # The outcome. Correctness is only ever computed by the server from the snapshot.
    status = models.CharField(
        max_length=16, choices=AttemptStatus.choices, default=AttemptStatus.ISSUED
    )
    submitted_answer = models.SmallIntegerField(null=True, blank=True)
    correctness = models.CharField(
        max_length=16, blank=True, choices=[(c.value, c.value) for c in ChallengeCorrectness]
    )
    hint_level = models.PositiveSmallIntegerField(default=0)
    issued_at = models.DateTimeField(default=now)
    answered_at = models.DateTimeField(null=True, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["issued_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(attempt_number__gte=1),
                name="game_sessions_attempt_number_positive",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    status=AttemptStatus.ISSUED,
                    answered_at__isnull=True,
                    submitted_answer__isnull=True,
                    correctness="",
                )
                | models.Q(
                    status=AttemptStatus.ANSWERED,
                    answered_at__isnull=False,
                    submitted_answer__isnull=False,
                    correctness__in=[c.value for c in ChallengeCorrectness],
                ),
                name="game_sessions_attempt_outcome_matches_status",
            ),
            models.UniqueConstraint(
                fields=["session", "target_entity_id", "attempt_number"],
                name="game_sessions_attempt_number_unique",
            ),
            # One outstanding challenge per target per session: asking again returns it.
            models.UniqueConstraint(
                fields=["session", "target_entity_id"],
                condition=models.Q(status=AttemptStatus.ISSUED),
                name="game_sessions_one_issued_attempt_per_target",
            ),
        ]
        indexes = [
            models.Index(
                fields=["child", "skill_id", "issued_at"], name="game_sessions_attempt_skill"
            )
        ]

    def __str__(self) -> str:
        return str(self.id)

    def _remember_loaded(self) -> None:
        # Only fields actually loaded: reading a deferred field here would query (and recurse).
        loaded = self.__dict__
        self._loaded = {name: loaded[name] for name in SNAPSHOT_FIELDS if name in loaded}
        self._loaded_status = loaded.get("status")

    @classmethod
    def from_db(cls, db, field_names, values, **kwargs):
        instance = super().from_db(db, field_names, values, **kwargs)
        instance._remember_loaded()
        return instance

    def refresh_from_db(self, *args, **kwargs):
        super().refresh_from_db(*args, **kwargs)
        self._remember_loaded()

    def save(self, *args, **kwargs):
        loaded = getattr(self, "_loaded", None)
        if loaded is not None:
            if self._loaded_status == AttemptStatus.ANSWERED:
                raise ImmutableRecord("An answered attempt cannot change.")
            changed = [name for name, value in loaded.items() if getattr(self, name) != value]
            if changed:
                raise ImmutableRecord(f"Snapshot fields cannot change: {', '.join(changed)}")
        super().save(*args, **kwargs)
        self._remember_loaded()

    def challenge(self) -> MathChallenge:
        """The challenge exactly as presented, rebuilt from the snapshot for grading."""
        return MathChallenge(
            skill_id=self.skill_id,
            operation=Operation(self.operation),
            operands=tuple(self.operands),
            answer=self.answer,
            response_mode=ResponseMode(self.response_mode),
            choices=tuple(self.choices),
        )


# --- Game-only WebView launches (LAI-ANDROID-API-001, ADR-036) -------------------------------


class GameLaunchTicket(ChildOwnedModel):
    """A short-lived, single-use grant to open one region's game for one child.

    Created by the native app's bearer-authenticated launch request and redeemed once, by the
    same parent, for a `GameBrowserSession`. Only the SHA-256 of the opaque ticket is stored;
    the ticket itself exists only in the launch response. Consumption is one conditional UPDATE
    (`consumed_at IS NULL AND expires_at > now`), so two concurrent redemptions cannot both win.
    """

    parent = models.ForeignKey(
        "users.ParentAccount", on_delete=models.CASCADE, related_name="+", editable=False
    )
    region_id = models.SlugField(max_length=80)
    ticket_hash = models.CharField(max_length=64, unique=True, editable=False)
    created_at = models.DateTimeField(default=now, editable=False)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(expires_at__gt=F("created_at")), name="launch_ticket_expires_later"
            ),
        ]
        indexes = [models.Index(fields=["parent", "expires_at"], name="launch_ticket_parent")]


class GameBrowserSession(ChildOwnedModel):
    """The game runtime's credential inside the WebView: one parent, one child, one region.

    Carried by an HttpOnly, Secure, SameSite=Strict cookie scoped to `/api/v1/`; only the
    SHA-256 of the cookie value is stored. It authenticates nothing but the game runtime routes
    that opt in (`apps.game_sessions.runtime_auth`), and only for its own child and region. It
    can never reach account, child-management or launch routes. Ends at `expires_at`, on
    `revoked_at`, or when the parent or child is deactivated.
    """

    CHILD_LINKS = ("ticket",)

    parent = models.ForeignKey(
        "users.ParentAccount", on_delete=models.CASCADE, related_name="+", editable=False
    )
    region_id = models.SlugField(max_length=80)
    token_hash = models.CharField(max_length=64, unique=True, editable=False)
    ticket = models.OneToOneField(
        GameLaunchTicket, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(default=now, editable=False)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(expires_at__gt=F("created_at")), name="game_session_expires_later"
            ),
        ]
        indexes = [models.Index(fields=["parent", "revoked_at"], name="game_session_parent")]
