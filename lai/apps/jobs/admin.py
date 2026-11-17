"""Background jobs in Django Admin: a read-only list for staff with `jobs.view_processingjob`.

Nothing is editable or deletable here. "Mark failed" needs `jobs.fail_processingjob`: it fails a
stuck legacy job exactly as a timeout would (the kind's handler runs, so a Studio batch waiting
on it is finished). The payload is shown only to superusers, since a Studio chunk's payload
holds the full prompt.

Contract kinds (`apps.jobs.processing`) also show their state, input identity, verdict,
findings, safe error details, metadata, attempts, artifacts and completion receipts, all read
only. "Cancel" needs `jobs.cancel_processingjob` and "Requeue" `jobs.requeue_processingjob`;
both go through the lifecycle module. There is no publish action: processing never publishes
an asset. The processing package is imported lazily, so legacy jobs work without it.
"""

import json

from django.contrib import admin, messages
from django.utils.html import format_html, format_html_join

from . import services
from .models import (
    CONTRACT_KINDS,
    CompletionReceipt,
    JobArtifact,
    JobAttempt,
    JobState,
    ProcessingJob,
)

#: Fields only contract kinds have; hidden for legacy jobs.
CONTRACT_FIELDS = (
    "state",
    "namespace",
    "idempotency_key",
    "correlation_id",
    "profile_display",
    "processor_display",
    "input_identity",
    "expires_at",
    "cancel_requested_at",
    "cancelled_by",
    "retry_eligibility",
    "verdict_display",
    "findings_display",
    "error_display",
    "metadata_display",
)
_MAX_SHOWN_FINDINGS = 200


def _perm(request, codename: str) -> bool:
    user = request.user
    return bool(user.is_active and user.is_staff and user.has_perm(f"jobs.{codename}"))


def _pretty(value, limit: int = 20000) -> str:
    """Escaped, indented JSON (format_html escapes it)."""
    return format_html("<pre>{}</pre>", json.dumps(value, indent=2, sort_keys=True)[:limit])


class _ReadOnlyInline(admin.TabularInline):
    extra = 0
    can_delete = False
    show_change_link = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_view_permission(self, request, obj=None):
        return _perm(request, "view_processingjob")

    def get_readonly_fields(self, request, obj=None):
        return self.fields


class AttemptInline(_ReadOnlyInline):
    model = JobAttempt
    fk_name = "job"
    fields = (
        "number",
        "attempt_id",
        "outcome",
        "verdict",
        "retry_class",
        "error_code",
        "processor_id",
        "processor_version",
        "duration_ms",
        "dispatched_at",
        "completed_at",
        "applied_at",
    )


class ArtifactInline(_ReadOnlyInline):
    model = JobArtifact
    fields = ("logical_id", "artifact_type", "store", "key", "sha256", "size_bytes", "content_type")


class ReceiptInline(_ReadOnlyInline):
    model = CompletionReceipt
    fields = ("received_at", "event_id", "attempt_id", "action", "reason")


@admin.register(ProcessingJob)
class ProcessingJobAdmin(admin.ModelAdmin):
    list_display = (
        "created_at",
        "kind",
        "status",
        "state",
        "error_code",
        "attempts",
        "deliveries",
        "subject_type",
        "subject_id",
        "finished_at",
    )
    list_filter = ("status", "kind", "state", "namespace", "queue", "backend")
    search_fields = ("id", "subject_id", "idempotency_key", "correlation_id")
    ordering = ("-created_at",)
    list_per_page = 50
    actions = ["mark_failed", "cancel_processing_job", "requeue_processing_job"]
    inlines = [AttemptInline, ArtifactInline, ReceiptInline]
    fields = (
        "id",
        "kind",
        "queue",
        "backend",
        "status",
        "error_code",
        "attempts",
        "deliveries",
        "subject_type",
        "subject_id",
        "submitted_by",
        "worker_function",
        "worker_request_id",
        "created_at",
        "started_at",
        "finished_at",
        *CONTRACT_FIELDS,
        "result_summary",
        "payload_view",
    )

    def has_module_permission(self, request):
        return _perm(request, "view_processingjob")

    def has_view_permission(self, request, obj=None):
        return _perm(request, "view_processingjob")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_fail_permission(self, request):
        return _perm(request, "fail_processingjob")

    def has_cancel_permission(self, request):
        return _perm(request, "view_processingjob") and _perm(request, "cancel_processingjob")

    def has_requeue_permission(self, request):
        return _perm(request, "view_processingjob") and _perm(request, "requeue_processingjob")

    def get_readonly_fields(self, request, obj=None):
        return self.get_fields(request, obj)

    def get_fields(self, request, obj=None):
        names = self.fields
        if obj is None or not obj.is_contract:
            names = tuple(name for name in names if name not in CONTRACT_FIELDS)
        else:  # the applied result is shown field by field instead
            names = tuple(name for name in names if name != "result_summary")
        if not request.user.is_superuser:
            names = tuple(name for name in names if name != "payload_view")
        return names

    def get_inline_instances(self, request, obj=None):
        if obj is None or not obj.is_contract:
            return []
        return super().get_inline_instances(request, obj)

    # --- legacy displays ------------------------------------------------------------------

    @admin.display(description="Result")
    def result_summary(self, obj):
        if obj.result is None:
            return "-"
        shown = dict(obj.result)
        if isinstance(shown.get("items"), list):  # model output stays in the Studio's drafts
            shown["items"] = f"{len(shown['items'])} item(s)"
        return _pretty(shown)

    @admin.display(description="Payload")
    def payload_view(self, obj):
        return format_html("<pre>{}</pre>", json.dumps(obj.payload, indent=2, sort_keys=True))

    # --- contract displays ----------------------------------------------------------------

    @staticmethod
    def _result(obj) -> dict:
        if isinstance(obj.result, dict):
            return obj.result
        attempt = obj.current_attempt
        return attempt.result if attempt is not None and isinstance(attempt.result, dict) else {}

    @admin.display(description="Profile")
    def profile_display(self, obj):
        return f"{obj.profile_id} v{obj.profile_version}" if obj.profile_id else "-"

    @admin.display(description="Expected processor")
    def processor_display(self, obj):
        return f"{obj.processor_id} {obj.processor_version}" if obj.processor_id else "-"

    @admin.display(description="Input")
    def input_identity(self, obj):
        ref = obj.input_ref or {}
        rows = [
            ("Store", ref.get("store") or "-"),
            ("Key", ref.get("key") or "-"),
            ("Object version", ref.get("version_id") or "-"),
            ("SHA-256", obj.input_sha256 or "-"),
            ("Size (bytes)", obj.input_size if obj.input_size is not None else "-"),
            ("Content type", obj.input_content_type or "-"),
        ]
        return format_html("<dl>{}</dl>", format_html_join("", "<dt>{}</dt><dd>{}</dd>", rows))

    @admin.display(description="Requeue allowed")
    def retry_eligibility(self, obj):
        if obj.state == JobState.FAILED:
            return "Yes: a staff requeue starts a new attempt."
        return "No"

    @admin.display(description="Verdict")
    def verdict_display(self, obj):
        return self._result(obj).get("verdict") or "-"

    @admin.display(description="Findings")
    def findings_display(self, obj):
        findings = self._result(obj).get("findings") or []
        if not findings:
            return "-"
        rows = [
            (
                item.get("severity", ""),
                item.get("code", ""),
                item.get("message", ""),
                item.get("path") or "",
            )
            for item in findings[:_MAX_SHOWN_FINDINGS]
            if isinstance(item, dict)
        ]
        return format_html(
            "<table><tr><th>Severity</th><th>Code</th><th>Message</th><th>Path</th></tr>{}</table>",
            format_html_join("", "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>", rows),
        )

    @admin.display(description="Errors")
    def error_display(self, obj):
        errors = self._result(obj).get("errors") or []
        if not errors:
            return obj.error_code or "-"
        # Codes, retry classes, fixed safe messages and scalar details only (contract rule).
        shown = [
            {k: item.get(k) for k in ("code", "retry_class", "message", "details")}
            for item in errors
            if isinstance(item, dict)
        ]
        return _pretty(shown)

    @admin.display(description="Metadata")
    def metadata_display(self, obj):
        metadata = self._result(obj).get("metadata")
        return _pretty(metadata) if metadata else "-"

    # --- actions --------------------------------------------------------------------------

    @admin.action(description="Mark selected unfinished jobs failed", permissions=["fail"])
    def mark_failed(self, request, queryset):
        failed = sum(
            1
            for job_id in queryset.values_list("pk", flat=True)
            if services.fail_job(job_id, "marked_failed")
        )
        self.message_user(request, f"Marked {failed} job(s) failed.", messages.SUCCESS)

    @admin.action(description="Cancel selected processing jobs", permissions=["cancel"])
    def cancel_processing_job(self, request, queryset):
        from . import processing

        done = skipped = 0
        for job in queryset.filter(kind__in=sorted(CONTRACT_KINDS)):
            if processing.cancel_job(job, user=request.user):
                done += 1
            else:
                skipped += 1
        skipped += queryset.exclude(kind__in=sorted(CONTRACT_KINDS)).count()
        self.message_user(
            request, f"Cancelled {done} job(s); {skipped} could not be cancelled.", messages.INFO
        )

    @admin.action(description="Requeue selected failed processing jobs", permissions=["requeue"])
    def requeue_processing_job(self, request, queryset):
        from . import processing

        done = skipped = 0
        for job in queryset.filter(kind__in=sorted(CONTRACT_KINDS)):
            if processing.requeue_job(job, user=request.user):
                done += 1
            else:
                skipped += 1
        skipped += queryset.exclude(kind__in=sorted(CONTRACT_KINDS)).count()
        self.message_user(
            request, f"Requeued {done} job(s); {skipped} could not be requeued.", messages.INFO
        )
