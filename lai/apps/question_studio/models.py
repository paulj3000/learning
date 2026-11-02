"""The question bank (LAI-AQS-003, ADR-046).

A `Question` is a staff-owned draft. It becomes playable only by being published, which writes an
immutable `QuestionRevision`; children are only ever served revisions. Generation, validation,
review and publishing are separate steps, each recorded: `GenerationBatch` (provenance and cost),
`ValidationFinding` (the report), `ReviewEvent` (append-only history).
"""

import uuid

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils.timezone import now

from . import taxonomy
from .normalize import exact_hash, normalized_hash


class ReviewStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    NEEDS_REVIEW = "NEEDS_REVIEW", "Needs review"
    APPROVED = "APPROVED", "Approved"
    REJECTED = "REJECTED", "Rejected"
    PUBLISHED = "PUBLISHED", "Published"


class ValidationStatus(models.TextChoices):
    UNVALIDATED = "UNVALIDATED", "Not validated"
    PASS = "PASS", "Pass"
    WARNING = "WARNING", "Warning"
    FAIL = "FAIL", "Fail"


class Severity(models.TextChoices):
    BLOCKING = "BLOCKING", "Blocking"
    WARNING = "WARNING", "Warning"
    INFO = "INFO", "Info"


class BatchStatus(models.TextChoices):
    QUEUED = "QUEUED", "Queued"
    RUNNING = "RUNNING", "Running"
    COMPLETED = "COMPLETED", "Completed"
    PARTIAL = "PARTIAL", "Partly completed"
    FAILED = "FAILED", "Failed"


class StudioLimits(models.Model):
    """Staff-editable generation limits (LAI-AQS-008). One row (pk 1); defaults are safe."""

    max_questions_per_batch = models.PositiveSmallIntegerField(default=25)
    max_batches_per_user_per_day = models.PositiveSmallIntegerField(default=10)
    max_questions_per_day = models.PositiveIntegerField(default=200)
    max_tokens_per_day = models.PositiveIntegerField(default=200_000)
    generation_enabled = models.BooleanField(default=True)

    class Meta:
        verbose_name_plural = "studio limits"

    def __str__(self) -> str:
        return "Studio limits"

    @classmethod
    def current(cls) -> "StudioLimits":
        row, _ = cls.objects.get_or_create(pk=1)
        return row

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)


class GenerationBatch(models.Model):
    """One generation request and what it cost. Provenance for every question it produced."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    subject = models.CharField(max_length=16, choices=taxonomy.Subject.choices)
    grade = models.CharField(max_length=2, choices=taxonomy.Grade.choices)
    topic = models.CharField(max_length=40)
    skill_code = models.SlugField(max_length=100, blank=True)
    difficulty = models.CharField(
        max_length=8, choices=[*taxonomy.Difficulty.choices, (taxonomy.MIXED, "Mixed")]
    )
    question_type = models.CharField(max_length=20, choices=taxonomy.QuestionType.choices)
    requested_count = models.PositiveSmallIntegerField()
    include_hints = models.BooleanField(default=True)
    include_explanations = models.BooleanField(default=True)
    world = models.ForeignKey(
        "catalog.World", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    location = models.ForeignKey(
        "catalog.Location", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    adventure = models.ForeignKey(
        "catalog.Adventure", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    notes = models.CharField(
        max_length=200, blank=True, help_text="Staff text. Sent to the model as untrusted input."
    )
    status = models.CharField(
        max_length=12, choices=BatchStatus.choices, default=BatchStatus.QUEUED
    )
    prompt_version = models.CharField(max_length=40)
    schema_version = models.PositiveSmallIntegerField()
    model_id = models.CharField(max_length=200, blank=True)
    chunks_total = models.PositiveSmallIntegerField(default=0)
    chunks_done = models.PositiveSmallIntegerField(default=0)
    produced_count = models.PositiveSmallIntegerField(default=0)
    attempts = models.PositiveSmallIntegerField(default=0)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    cost_microusd = models.PositiveBigIntegerField(null=True, blank=True)
    failure_category = models.CharField(max_length=40, blank=True)
    created_at = models.DateTimeField(default=now)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "generation batches"
        indexes = [models.Index(fields=["requested_by", "created_at"])]
        constraints = [
            models.CheckConstraint(
                condition=Q(requested_count__gte=1), name="studio_batch_count_positive"
            )
        ]

    def __str__(self) -> str:
        return f"{self.topic} grade {self.grade} x{self.requested_count} ({self.status})"


class Question(models.Model):
    """A staff-owned draft question. Never served to a child; see `QuestionRevision`."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(
        GenerationBatch, null=True, blank=True, on_delete=models.SET_NULL, related_name="questions"
    )
    replaces = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="replacements"
    )
    subject = models.CharField(max_length=16, choices=taxonomy.Subject.choices)
    grade = models.CharField(max_length=2, choices=taxonomy.Grade.choices)
    topic = models.CharField(max_length=40)
    skill_code = models.SlugField(max_length=100, blank=True)
    difficulty = models.CharField(max_length=8, choices=taxonomy.Difficulty.choices)
    question_type = models.CharField(max_length=20, choices=taxonomy.QuestionType.choices)
    stem = models.TextField()
    choices = models.JSONField(default=list, blank=True, help_text='[{"id": "A", "text": "12"}]')
    correct_answer = models.CharField(
        max_length=200, help_text="A choice id for multiple choice; the answer otherwise."
    )
    accepted_answers = models.JSONField(default=list, blank=True)
    operation = models.CharField(max_length=10, blank=True, choices=taxonomy.Operation.choices)
    operands = ArrayField(models.IntegerField(), default=list, blank=True)
    hint = models.TextField(blank=True)
    explanation = models.TextField(blank=True)
    world = models.ForeignKey(
        "catalog.World", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    location = models.ForeignKey(
        "catalog.Location", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    adventure = models.ForeignKey(
        "catalog.Adventure", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    validation_status = models.CharField(
        max_length=12, choices=ValidationStatus.choices, default=ValidationStatus.UNVALIDATED
    )
    validation_run = models.PositiveIntegerField(default=0)
    review_status = models.CharField(
        max_length=12, choices=ReviewStatus.choices, default=ReviewStatus.DRAFT
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    source_model = models.CharField(max_length=200, blank=True)
    prompt_version = models.CharField(max_length=40, blank=True)
    generated_at = models.DateTimeField(null=True, blank=True)
    content_hash = models.CharField(max_length=64, editable=False, db_index=True)
    normalized_hash = models.CharField(max_length=64, editable=False, db_index=True)
    created_at = models.DateTimeField(default=now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        permissions = [
            ("approve_question", "Can approve, reject and reopen questions"),
            ("publish_question", "Can publish approved questions"),
            ("retire_revision", "Can retire published revisions"),
        ]
        indexes = [
            models.Index(fields=["review_status", "validation_status"]),
            models.Index(fields=["subject", "grade", "topic"]),
        ]

    def __str__(self) -> str:
        return f"{self.stem[:60]}"

    def clean(self):
        super().clean()
        if not taxonomy.topic_is_valid(self.subject, self.topic):
            raise ValidationError({"topic": f"Unknown topic {self.topic!r} for {self.subject}."})

    def save(self, *args, **kwargs):
        self.content_hash = exact_hash(self.stem, self.choices, self.correct_answer)
        self.normalized_hash = normalized_hash(self.stem, self.choices, self.correct_answer)
        super().save(*args, **kwargs)

    def content(self) -> dict:
        """The question as a publishable snapshot (what a revision freezes)."""
        return {
            "subject": self.subject,
            "grade": self.grade,
            "topic": self.topic,
            "skillCode": self.skill_code,
            "difficulty": self.difficulty,
            "questionType": self.question_type,
            "stem": self.stem,
            "choices": self.choices,
            "correctAnswer": self.correct_answer,
            "acceptedAnswers": self.accepted_answers,
            "operation": self.operation,
            "operands": list(self.operands),
            "hint": self.hint,
            "explanation": self.explanation,
        }


class ValidationFinding(models.Model):
    """One finding from one validation run. The latest run is the question's report."""

    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="findings")
    run = models.PositiveIntegerField()
    code = models.CharField(max_length=60)
    severity = models.CharField(max_length=10, choices=Severity.choices)
    message = models.CharField(max_length=300)

    class Meta:
        ordering = ["question", "-run", "severity", "code"]
        indexes = [models.Index(fields=["question", "run"])]

    def __str__(self) -> str:
        return f"{self.severity} {self.code}"


class ReviewEvent(models.Model):
    """Append-only history of edits, validation and status changes."""

    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name="events")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    action = models.CharField(max_length=30)
    from_status = models.CharField(max_length=12, blank=True)
    to_status = models.CharField(max_length=12, blank=True)
    note = models.CharField(max_length=300, blank=True)
    at = models.DateTimeField(default=now)

    class Meta:
        ordering = ["at", "id"]

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError("Review events cannot change.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Review events cannot be deleted.")


class RevisionStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    SUPERSEDED = "SUPERSEDED", "Superseded"
    RETIRED = "RETIRED", "Retired"


class ImmutableRevision(ValueError):
    pass


class QuestionRevision(models.Model):
    """The published, immutable form of a question: the only thing a child can be served.

    Content never changes after publishing. Only `status` and `retired_at` move, so a correction
    is a new revision and an old one stays intact for the attempts that snapshotted it.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    question = models.ForeignKey(Question, on_delete=models.PROTECT, related_name="revisions")
    number = models.PositiveIntegerField()
    content = models.JSONField()
    content_hash = models.CharField(max_length=64)
    # Denormalised from the content for pool queries; as immutable as the content.
    subject = models.CharField(max_length=16)
    grade = models.CharField(max_length=2)
    topic = models.CharField(max_length=40)
    skill_code = models.CharField(max_length=100, blank=True)
    difficulty = models.CharField(max_length=8)
    question_type = models.CharField(max_length=20)
    adventure = models.ForeignKey(
        "catalog.Adventure", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    status = models.CharField(
        max_length=12, choices=RevisionStatus.choices, default=RevisionStatus.ACTIVE
    )
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    published_at = models.DateTimeField(default=now)
    retired_at = models.DateTimeField(null=True, blank=True)

    FROZEN = (
        "question_id",
        "number",
        "content",
        "content_hash",
        "subject",
        "grade",
        "topic",
        "skill_code",
        "difficulty",
        "question_type",
        "adventure_id",
        "published_at",
    )

    class Meta:
        ordering = ["question", "-number"]
        constraints = [
            models.UniqueConstraint(fields=["question", "number"], name="studio_revision_number"),
            models.UniqueConstraint(
                fields=["question"],
                condition=Q(status="ACTIVE"),
                name="studio_one_active_revision",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "subject", "grade", "topic", "difficulty"]),
            models.Index(fields=["adventure", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.question_id} r{self.number}"

    @classmethod
    def from_db(cls, db, field_names, values, **kwargs):
        instance = super().from_db(db, field_names, values, **kwargs)
        instance._frozen = {n: instance.__dict__[n] for n in cls.FROZEN if n in instance.__dict__}
        return instance

    def save(self, *args, **kwargs):
        frozen = getattr(self, "_frozen", None)
        if frozen is not None and any(getattr(self, n) != v for n, v in frozen.items()):
            raise ImmutableRevision("A published revision's content cannot change.")
        super().save(*args, **kwargs)
        self._frozen = {n: getattr(self, n) for n in self.FROZEN}

    def delete(self, *args, **kwargs):
        raise ImmutableRevision("A published revision cannot be deleted; retire it instead.")


class QuestionPool(models.Model):
    """Which published questions a Treasure Rush chest may draw from (LAI-AQS-020, 021).

    Keyed by the region and chest entity ids the challenge attempt already snapshots, so the
    regions app is untouched. An empty `entity_id` covers every chest in the region; an exact
    entity beats it. No enabled pool, or too few eligible questions, means the chest keeps its
    authored `ChallengeSpec` generator.
    """

    name = models.CharField(max_length=120)
    enabled = models.BooleanField(default=False)
    region_id = models.SlugField(max_length=80)
    entity_id = models.SlugField(max_length=80, blank=True)
    adventure = models.ForeignKey(
        "catalog.Adventure", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    subject = models.CharField(max_length=16, choices=taxonomy.Subject.choices, default="MATH")
    grade = models.CharField(max_length=2, blank=True, choices=taxonomy.Grade.choices)
    topic = models.CharField(max_length=40, blank=True)
    skill_code = models.SlugField(max_length=100, blank=True)
    difficulty = models.CharField(max_length=8, blank=True, choices=taxonomy.Difficulty.choices)
    min_pool_size = models.PositiveSmallIntegerField(
        default=3,
        help_text="Fewer eligible questions than this and the chest uses its authored challenge.",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["region_id", "entity_id"],
                condition=Q(enabled=True),
                name="studio_one_enabled_pool_per_target",
            )
        ]

    def __str__(self) -> str:
        return self.name
