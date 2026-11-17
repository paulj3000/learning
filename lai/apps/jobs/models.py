"""Background processing jobs (the native dev environment's Lambda + SQS workers).

A `ProcessingJob` is one unit of work handed to a worker: a Question Studio chunk, a shared
speech clip, or an asset inspection. Django owns the job's state; the worker only reports
results, which `services.apply_result` applies once, in order, under a row lock.

Privacy: `payload` carries server-built or staff-authored data only (a Studio prompt, an authored
NPC line, an object key). Never a child's free text, a child's name or a child id.
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


class JobKind(models.TextChoices):
    STUDIO_GENERATE_CHUNK = envelope.STUDIO_GENERATE_CHUNK, "Question Studio chunk"
    SPEECH_SYNTHESIZE = envelope.SPEECH_SYNTHESIZE, "Shared speech clip"
    ASSET_INSPECT = envelope.ASSET_INSPECT, "Asset inspection"
    ASSET_VALIDATE_MODEL = envelope.ASSET_VALIDATE_MODEL, "Model validation"
    REFERENCE_CHECKSUM = envelope.REFERENCE_CHECKSUM, "Reference checksum"


class JobQueue(models.TextChoices):
    AI = "ai", "AI"
    MEDIA = "media", "Media"


class ProcessingJob(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=40, choices=JobKind.choices)
    queue = models.CharField(max_length=8, choices=JobQueue.choices)
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
    subject_type = models.CharField(max_length=64, blank=True)
    subject_id = models.CharField(max_length=64, blank=True)
    #: Transactional outbox (ADR-064): the committed PENDING row is the durable intent to send.
    #: Set once the work message is accepted by SQS; the relay re-sends rows still unset.
    dispatched_at = models.DateTimeField(null=True, blank=True)
    #: Failed sends so far; the job fails with `submit_failed` at `services.DISPATCH_ATTEMPTS`.
    dispatch_attempts = models.PositiveSmallIntegerField(default=0)
    #: Contract kinds only (core/contract.py): the ADR-061 logical idempotency key of the request
    #: in `payload`. Submitting the same logical work again returns the unfinished or completed
    #: job with this key; a failed one may be submitted again (a new job, a new attempt id).
    idempotency_key = models.CharField(max_length=68, blank=True, db_index=True, db_default="")
    #: Contract kinds only: what the kind's handler did with the result for its subject (a safe
    #: code such as "version_validated" or "identity_mismatch"; blank before a result).
    subject_outcome = models.CharField(max_length=64, blank=True, db_default="")
    worker_function = models.CharField(max_length=140, blank=True)
    worker_request_id = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(default=now, editable=False)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "background job"
        permissions = [("fail_processingjob", "Can mark a stuck background job failed")]
        indexes = [
            models.Index(fields=["status", "created_at"], name="jobs_status_created"),
            models.Index(fields=["subject_type", "subject_id"], name="jobs_subject"),
            models.Index(
                fields=["created_at"],
                name="jobs_undispatched",
                condition=models.Q(status="pending", dispatched_at__isnull=True),
            ),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(status__in=JobStatus.values), name="jobs_status_valid"
            ),
            models.CheckConstraint(
                condition=models.Q(kind__in=JobKind.values), name="jobs_kind_valid"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.kind} {self.pk} ({self.status})"

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL
