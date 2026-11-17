"""Background processing jobs (the native dev environment's Lambda + SQS workers).

A `ProcessingJob` is one unit of work handed to a worker: a Question Studio chunk, a shared
speech clip, or an asset inspection. Django owns the job's state; the worker only reports
results, which `services.apply_result` applies once, in order, under a row lock.

Contract kinds (ADR-062, docs/processing/DJANGO_JOBS.md) share this table: their work and
completion messages are the `lai_processing` contracts, handled by `apps.jobs.processing`, with
attempts, a transactional outbox, a completion ledger and artifact records in the models below.

Privacy: `payload` carries server-built or staff-authored data only (a Studio prompt, an authored
NPC line, an object key, a contract request of ids, keys and checksums). Never a child's free
text, a child's name or a child id.
"""

import uuid

from django.conf import settings
from django.db import models
from django.utils.timezone import now

from .core import envelope


class JobStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    RUNNING = "running", "Running"
    COMPLETED = "completed", "Completed"
    FAILED = "failed", "Failed"


TERMINAL = (JobStatus.COMPLETED, JobStatus.FAILED)

#: Contract kinds: their messages are the `lai_processing` contracts, never the schema-1
#: envelope, so `envelope.KINDS` and `envelope.KIND_QUEUE` deliberately do not contain them.
ASSET_VALIDATE_MODEL = "asset.validate_model"
REFERENCE_CHECKSUM = "reference.checksum"
CONTRACT_KINDS = frozenset({ASSET_VALIDATE_MODEL, REFERENCE_CHECKSUM})


class JobKind(models.TextChoices):
    STUDIO_GENERATE_CHUNK = envelope.STUDIO_GENERATE_CHUNK, "Question Studio chunk"
    SPEECH_SYNTHESIZE = envelope.SPEECH_SYNTHESIZE, "Shared speech clip"
    ASSET_INSPECT = envelope.ASSET_INSPECT, "Asset inspection"
    ASSET_VALIDATE_MODEL = ASSET_VALIDATE_MODEL, "Model validation"
    REFERENCE_CHECKSUM = REFERENCE_CHECKSUM, "Reference checksum"


class JobQueue(models.TextChoices):
    AI = "ai", "AI"
    MEDIA = "media", "Media"
    #: The contract work queue (`LAI_PROCESSING_WORK_QUEUE_URL`).
    PROCESSING = "processing", "Processing"


class JobState(models.TextChoices):
    """A contract kind's application job state: the values of
    `lai_processing.core.lifecycle.JobState` (a test keeps them equal). Blank for legacy kinds.
    Declared here rather than imported so the models load without the processing package."""

    CREATED = "created", "Created"
    UPLOADING = "uploading", "Uploading"
    QUEUED = "queued", "Queued"
    PROCESSING = "processing", "Processing"
    VALIDATED = "validated", "Validated"
    READY_FOR_REVIEW = "ready_for_review", "Ready for review"
    FAILED = "failed", "Failed"
    CANCELLED = "cancelled", "Cancelled"


#: The coarse `status` each contract state maps to (WAVE2_INTERFACES section 6).
STATE_STATUS = {
    JobState.CREATED: JobStatus.PENDING,
    JobState.UPLOADING: JobStatus.PENDING,
    JobState.QUEUED: JobStatus.PENDING,
    JobState.PROCESSING: JobStatus.RUNNING,
    JobState.VALIDATED: JobStatus.COMPLETED,
    JobState.READY_FOR_REVIEW: JobStatus.COMPLETED,
    JobState.FAILED: JobStatus.FAILED,
    JobState.CANCELLED: JobStatus.FAILED,
}

_CONTRACT = models.Q(kind__in=sorted(CONTRACT_KINDS))


class ProcessingJob(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=40, choices=JobKind.choices)
    queue = models.CharField(max_length=16, choices=JobQueue.choices)
    backend = models.CharField(max_length=8)
    status = models.CharField(
        max_length=10, choices=JobStatus.choices, default=JobStatus.PENDING, db_index=True
    )
    payload = models.JSONField(default=dict)
    result = models.JSONField(null=True, blank=True)
    error_code = models.CharField(max_length=64, blank=True)
    #: Times a worker reported starting this job (a `running` result).
    attempts = models.PositiveSmallIntegerField(default=0)
    #: Result messages received for this job, duplicates and late ones included.
    deliveries = models.PositiveSmallIntegerField(default=0)
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    #: The record this job works for, as "<app_label>.<model>" and its primary key (or another
    #: stable id, such as a speech cache key). A plain reference: jobs never cascade-delete.
    #: Contract kinds store the contract subject (e.g. "asset_version" and the version uuid).
    subject_type = models.CharField(max_length=64, blank=True)
    subject_id = models.CharField(max_length=128, blank=True)
    worker_function = models.CharField(max_length=140, blank=True)
    worker_request_id = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(default=now, editable=False)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    # --- contract kinds only (blank or null for legacy kinds) --------------------------------
    # For a contract kind `payload` is the attempt-1 request (`ProcessingJobRequest.to_dict`), the
    # template later attempts are re-encoded from, and `result` is the applied result.
    state = models.CharField(max_length=20, choices=JobState.choices, blank=True, default="")
    namespace = models.CharField(max_length=32, blank=True)
    idempotency_key = models.CharField(max_length=68, blank=True)
    profile_id = models.CharField(max_length=64, blank=True)
    profile_version = models.PositiveIntegerField(null=True, blank=True)
    #: The processor Django expects for the profile (`default_registry()` at submission).
    processor_id = models.CharField(max_length=64, blank=True)
    processor_version = models.CharField(max_length=32, blank=True)
    #: The input's location: {"store", "key", "version_id"}.
    input_ref = models.JSONField(null=True, blank=True)
    input_sha256 = models.CharField(max_length=64, blank=True)
    input_size = models.PositiveBigIntegerField(null=True, blank=True)
    input_content_type = models.CharField(max_length=100, blank=True)
    correlation_id = models.CharField(max_length=64, blank=True)
    current_attempt = models.ForeignKey(
        "JobAttempt", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    expires_at = models.DateTimeField(null=True, blank=True)
    #: What the subject's completion hook did with an applied result (a safe code such as
    #: "version_validated" or "identity_mismatch"; blank when no hook ran). WAVE3_INTERFACES 3.
    subject_outcome = models.CharField(max_length=64, blank=True)
    cancel_requested_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "background job"
        permissions = [
            ("fail_processingjob", "Can mark a stuck background job failed"),
            ("cancel_processingjob", "Can cancel a queued processing job"),
            ("requeue_processingjob", "Can requeue a failed processing job"),
        ]
        indexes = [
            models.Index(fields=["status", "created_at"], name="jobs_status_created"),
            models.Index(fields=["subject_type", "subject_id"], name="jobs_subject"),
            models.Index(fields=["state", "created_at"], name="jobs_state_created"),
            models.Index(fields=["namespace", "state"], name="jobs_namespace_state"),
            models.Index(fields=["expires_at"], name="jobs_expires_at"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(status__in=JobStatus.values), name="jobs_status_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(kind__in=JobKind.values), name="jobs_kind_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(state__in=[*JobState.values, ""]), name="jobs_state_valid"
            ),
            # A contract kind always has a state, a namespace and a key; a legacy kind never has
            # a state, so the legacy sweep and consumer can never mistake one for the other.
            models.CheckConstraint(
                condition=(
                    _CONTRACT
                    & ~models.Q(state="")
                    & ~models.Q(namespace="")
                    & ~models.Q(idempotency_key="")
                )
                | (~_CONTRACT & models.Q(state="")),
                name="jobs_contract_fields",
            ),
            models.UniqueConstraint(
                fields=["namespace", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="jobs_idempotency_key_unique",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.kind} {self.pk} ({self.state or self.status})"

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL

    @property
    def is_contract(self) -> bool:
        return self.kind in CONTRACT_KINDS


class AttemptOutcome(models.TextChoices):
    PENDING = "pending", "Pending"  # waiting for dispatch or a completion
    SUCCEEDED = "succeeded", "Succeeded"
    FAILED = "failed", "Failed"
    CANCELLED = "cancelled", "Cancelled"
    #: The job was cancelled, expired or requeued before this attempt reported.
    ABANDONED = "abandoned", "Abandoned"


class JobAttempt(models.Model):
    """One execution attempt of a contract job. A retry or requeue is a new row with a new
    `attempt_id`. `applied_at` marks attempts whose completion was applied: the ledger that makes
    a redelivered completion a DUPLICATE across restarts."""

    attempt_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    job = models.ForeignKey(ProcessingJob, on_delete=models.CASCADE, related_name="job_attempts")
    number = models.PositiveSmallIntegerField()
    outcome = models.CharField(
        max_length=10, choices=AttemptOutcome.choices, default=AttemptOutcome.PENDING
    )
    created_at = models.DateTimeField(default=now, editable=False)
    dispatched_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    applied_at = models.DateTimeField(null=True, blank=True)
    #: The worker's `ProcessingJobResult.to_dict()`: codes, safe messages, metadata, findings.
    result = models.JSONField(null=True, blank=True)
    verdict = models.CharField(max_length=16, blank=True)
    retry_class = models.CharField(max_length=16, blank=True)
    error_code = models.CharField(max_length=64, blank=True)
    processor_id = models.CharField(max_length=64, blank=True)
    processor_version = models.CharField(max_length=32, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["job", "number"]
        verbose_name = "processing attempt"
        constraints = [
            models.UniqueConstraint(fields=["job", "number"], name="jobs_attempt_number_unique"),
            models.CheckConstraint(
                condition=models.Q(number__gte=1, number__lte=100), name="jobs_attempt_number"
            ),
            models.CheckConstraint(
                condition=models.Q(outcome__in=AttemptOutcome.values),
                name="jobs_attempt_outcome_valid",
            ),
        ]

    def __str__(self) -> str:
        return f"attempt {self.number} {self.attempt_id} ({self.outcome})"


class JobOutbox(models.Model):
    """The transactional outbox: one canonical work message per attempt, written in the same
    transaction as the attempt and sent by `relay_outbox` after commit (at least once)."""

    job = models.ForeignKey(ProcessingJob, on_delete=models.CASCADE, related_name="outbox")
    attempt = models.OneToOneField(JobAttempt, on_delete=models.CASCADE, related_name="outbox")
    #: `encode(ProcessingJobRequest)` as UTF-8 text (canonical JSON).
    body = models.TextField()
    created_at = models.DateTimeField(default=now, editable=False)
    available_at = models.DateTimeField(default=now)
    sent_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    send_attempts = models.PositiveSmallIntegerField(default=0)
    last_error_code = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["available_at"]
        verbose_name = "processing outbox message"
        indexes = [models.Index(fields=["sent_at", "available_at"], name="jobs_outbox_due")]

    def __str__(self) -> str:
        return f"outbox {self.attempt_id} ({'sent' if self.sent_at else 'unsent'})"


class CompletionReceipt(models.Model):
    """Every completion event received for a contract job and what was decided, keyed by the
    worker's `event_id` so the same event seen twice is recognised. `job` is null when the event
    named no known job (a REJECT)."""

    event_id = models.UUIDField(unique=True)
    job = models.ForeignKey(
        ProcessingJob, null=True, blank=True, on_delete=models.CASCADE, related_name="receipts"
    )
    attempt_id = models.UUIDField(null=True, blank=True)
    action = models.CharField(max_length=12)
    reason = models.CharField(max_length=64, blank=True)
    received_at = models.DateTimeField(default=now, editable=False)

    class Meta:
        ordering = ["-received_at"]
        verbose_name = "completion receipt"

    def __str__(self) -> str:
        return f"receipt {self.event_id} {self.action}"


class JobArtifact(models.Model):
    """An artifact an applied attempt produced: a reference only; the bytes stay in storage."""

    job = models.ForeignKey(ProcessingJob, on_delete=models.CASCADE, related_name="artifacts")
    attempt = models.ForeignKey(JobAttempt, on_delete=models.CASCADE, related_name="artifacts")
    logical_id = models.CharField(max_length=64)
    artifact_type = models.CharField(max_length=64)
    store = models.CharField(max_length=16)
    key = models.CharField(max_length=1024)
    version_id = models.CharField(max_length=1024, blank=True)
    sha256 = models.CharField(max_length=64)
    size_bytes = models.PositiveBigIntegerField()
    content_type = models.CharField(max_length=100)
    created_at = models.DateTimeField(default=now, editable=False)

    class Meta:
        ordering = ["job", "logical_id"]
        verbose_name = "processing artifact"
        constraints = [
            models.UniqueConstraint(
                fields=["attempt", "logical_id"], name="jobs_artifact_logical_unique"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.artifact_type} {self.logical_id}"
