"""Play sessions and challenge attempts (LAI-0305 subset, Treasure Rush TR-4).

`AdventureSession` is the Django form of the Amplify `AdventureSession` (docs/DATA_MODEL.md),
with one addition: a session is either a step-based adventure (`ADVENTURE`, a template slug and
version, as in Amplify) or free play in an explorable region (`REGION`, a region id). Treasure
Rush is the first `REGION` session. Coop links and `difficultyState` arrive with the rest of
LAI-0305, when step-based adventures move to Django.

`ChallengeAttempt` is a typed event (ADR-016) for one server-generated challenge: it snapshots
everything needed to interpret the attempt later, so editing or deleting the challenge spec or
the chest never changes what history means. The expected answer is stored for grading and is
never part of any client shape (TR-1 `public_challenge`).

Content is referenced by slug or id string, the same ids the Amplify models store, plus a
nullable foreign key where one helps a lookup. Nothing here holds an asset URL.
"""

import uuid

from django.contrib.postgres.fields import ArrayField
from django.db import models
from django.utils.timezone import now

from apps.core.child_owned import ChildOwnedModel
from apps.education.challenges import Correctness, MathChallenge, Operation, ResponseMode
from apps.users.models import AgeBand


class SessionKind(models.TextChoices):
    ADVENTURE = "ADVENTURE", "Step-based adventure"
    REGION = "REGION", "Explorable region"


class SessionStatus(models.TextChoices):
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    ABANDONED = "ABANDONED"
    SAFETY_STOPPED = "SAFETY_STOPPED"


OPEN_STATUSES = (SessionStatus.ACTIVE, SessionStatus.PAUSED)


class AdventureSession(ChildOwnedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    child = models.ForeignKey(
        "users.ChildProfile", on_delete=models.CASCADE, related_name="adventure_sessions"
    )
    kind = models.CharField(max_length=16, choices=SessionKind.choices)
    template_slug = models.SlugField(max_length=80, blank=True)
    template_version = models.PositiveIntegerField(null=True, blank=True)
    current_step_id = models.CharField(max_length=80, blank=True)
    region_id = models.SlugField(max_length=80, blank=True)
    location_slug = models.SlugField(max_length=80)
    status = models.CharField(
        max_length=16, choices=SessionStatus.choices, default=SessionStatus.ACTIVE
    )
    started_at = models.DateTimeField(default=now)
    last_activity_at = models.DateTimeField(default=now)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(status__in=SessionStatus.values),
                name="game_sessions_session_status_valid",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(
                        kind=SessionKind.ADVENTURE,
                        template_version__isnull=False,
                        region_id="",
                    )
                    & ~models.Q(template_slug="")
                )
                | (models.Q(kind=SessionKind.REGION, template_slug="") & ~models.Q(region_id="")),
                name="game_sessions_session_target_matches_kind",
            ),
            models.CheckConstraint(
                condition=models.Q(status=SessionStatus.COMPLETED, completed_at__isnull=False)
                | (~models.Q(status=SessionStatus.COMPLETED) & models.Q(completed_at__isnull=True)),
                name="game_sessions_session_completed_at_iff_completed",
            ),
            # Start-or-resume is idempotent: at most one open session per child and target.
            models.UniqueConstraint(
                fields=["child", "kind", "template_slug", "region_id"],
                condition=models.Q(status__in=OPEN_STATUSES),
                name="game_sessions_one_open_session_per_target",
            ),
        ]
        indexes = [models.Index(fields=["child", "-started_at"], name="game_sessions_child_started")]

    def __str__(self) -> str:
        return str(self.id)

    @property
    def is_open(self) -> bool:
        return self.status in OPEN_STATUSES


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
    CHILD_LINKS = ("session",)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    child = models.ForeignKey(
        "users.ChildProfile", on_delete=models.CASCADE, related_name="challenge_attempts"
    )
    session = models.ForeignKey(
        AdventureSession, on_delete=models.CASCADE, related_name="challenge_attempts"
    )
    # Where: snapshot ids, plus convenience links that go null if the content is deleted.
    region_id = models.SlugField(max_length=80)
    target_entity_id = models.SlugField(max_length=80, help_text="e.g. the chest's entity id")
    chest = models.ForeignKey(
        "islands.TreasureChest", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
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
        max_length=16, blank=True, choices=[(c.value, c.value) for c in Correctness]
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
                    correctness__in=[c.value for c in Correctness],
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
            models.Index(fields=["child", "skill_id", "issued_at"], name="game_sessions_attempt_skill")
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
