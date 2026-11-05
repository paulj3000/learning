"""AI Question Studio in Django Admin (LAI-AQS-015 to 019, ADR-034, ADR-046).

Staff-only and permission-gated, never by `is_staff` alone. Every status change goes through
`workflow`, so the Admin cannot do anything a test of the workflow would not allow, and each is
recorded as a ReviewEvent. Published revisions are read-only; a correction is a new draft.
Admin actions are offered only to users who hold the matching permission.
"""

import logging
from datetime import timedelta

from django.contrib import admin, messages
from django.contrib.admin.options import ActionLocation
from django.core.exceptions import PermissionDenied
from django.http import HttpResponseNotAllowed, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html
from django.utils.timezone import now

from . import contracts, generation, jobs, regeneration, validation, workflow
from .forms import GenerateQuestionsForm
from .models import (
    BatchStatus,
    ChunkStatus,
    GenerationBatch,
    GenerationChunk,
    Question,
    QuestionPool,
    QuestionRevision,
    ReviewEvent,
    ReviewStatus,
    StudioLimits,
    StudioWorker,
    ValidationFinding,
    WorkerState,
)
from .worker import WORKER_ALIVE_SECONDS

audit_logger = logging.getLogger("lai.admin_audit")


def _perm(request, codename: str) -> bool:
    user = request.user
    return bool(user.is_active and user.is_staff and user.has_perm(f"question_studio.{codename}"))


# --- generation batches and the background queue (LAI-AQS-015, LAI-AQS-027) ----------------

WORKER_ALIVE_WINDOW = timedelta(seconds=WORKER_ALIVE_SECONDS)
AUTO_REFRESH_SECONDS = 10
_FIXED_ERROR_MESSAGES = frozenset({*jobs.ERROR_MESSAGES.values(), jobs.error_message("UNKNOWN")})


def _safe_error(stored: str, category: str) -> str:
    """The stored error, but only if it is one of the queue's fixed messages; otherwise the fixed
    message for its category. Provider or model text can never be shown this way."""
    if stored in _FIXED_ERROR_MESSAGES:
        return stored
    return jobs.error_message(category)


def worker_is_alive(worker: StudioWorker, at=None) -> bool:
    at = at or now()
    return worker.state == WorkerState.RUNNING and worker.last_seen_at >= at - WORKER_ALIVE_WINDOW


def any_worker_alive(at=None) -> bool:
    at = at or now()
    return StudioWorker.objects.filter(
        state=WorkerState.RUNNING, last_seen_at__gte=at - WORKER_ALIVE_WINDOW
    ).exists()


def _progress(batch: GenerationBatch) -> str:
    return (
        f"{batch.produced_count} of {batch.requested_count} questions, "
        f"{batch.chunks_done} of {batch.chunks_total} chunks"
    )


class ChunkInline(admin.TabularInline):
    """A batch's chunks, read-only, for anyone who may view the batch."""

    model = GenerationChunk
    extra = 0
    can_delete = False
    fields = (
        "index",
        "size",
        "status",
        "attempts_display",
        "next_attempt_at",
        "produced_count",
        "input_tokens",
        "output_tokens",
        "failure_category",
        "error_display",
        "started_at",
        "finished_at",
    )
    readonly_fields = fields
    verbose_name_plural = "Chunks"

    def has_view_permission(self, request, obj=None):
        return _perm(request, "view_generationbatch")

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.display(description="attempts")
    def attempts_display(self, obj):
        return f"{obj.attempts} of {obj.max_attempts}"

    @admin.display(description="last error")
    def error_display(self, obj):
        return _safe_error(obj.last_error, obj.failure_category)


@admin.register(GenerationBatch)
class GenerationBatchAdmin(admin.ModelAdmin):
    list_display = (
        "created_at",
        "state",
        "progress",
        "subject",
        "grade",
        "topic",
        "question_type",
        "requested_by",
        "total_tokens",
        "cost_microusd",
        "failure_category",
        "finished_at",
    )
    list_filter = ("status", "subject", "grade")
    list_select_related = ("requested_by",)
    ordering = ("-created_at",)
    list_per_page = 50
    inlines = [ChunkInline]
    fieldsets = (
        (
            "Progress",
            {
                "fields": (
                    "state",
                    "status",
                    "progress",
                    "failure_category",
                    "error_display",
                    "review_link",
                )
            },
        ),
        (
            "Request",
            {
                "fields": (
                    "requested_by",
                    "subject",
                    "grade",
                    "topic",
                    "skill_code",
                    "difficulty",
                    "question_type",
                    "requested_count",
                    "include_hints",
                    "include_explanations",
                    "world",
                    "location",
                    "adventure",
                    "notes",
                )
            },
        ),
        (
            "Queue",
            {
                "fields": (
                    "retry_count",
                    "claim_count",
                    "recovered_count",
                    "lease_owner",
                    "lease_expires_at",
                    "heartbeat_at",
                    "cancel_requested_at",
                    "cancelled_by",
                )
            },
        ),
        (
            "Usage and provenance",
            {
                "fields": (
                    "model_id",
                    "prompt_version",
                    "schema_version",
                    "attempts",
                    "input_tokens",
                    "output_tokens",
                    "cost_microusd",
                    "created_at",
                    "started_at",
                    "finished_at",
                )
            },
        ),
    )

    def has_module_permission(self, request):
        return _perm(request, "view_generationbatch") or _perm(request, "add_generationbatch")

    def has_view_permission(self, request, obj=None):
        return _perm(request, "view_generationbatch")

    def has_add_permission(self, request):
        return _perm(request, "add_generationbatch")

    def has_change_permission(self, request, obj=None):
        return False  # batches are provenance: read-only

    def has_delete_permission(self, request, obj=None):
        return False

    def get_readonly_fields(self, request, obj=None):
        return [field for _name, options in self.fieldsets for field in options["fields"]]

    @admin.display(description="state", ordering="status")
    def state(self, obj):
        return jobs.display_state(obj)

    @admin.display(description="progress")
    def progress(self, obj):
        return _progress(obj)

    @admin.display(description="tokens")
    def total_tokens(self, obj):
        return obj.input_tokens + obj.output_tokens

    @admin.display(description="last error")
    def error_display(self, obj):
        return _safe_error(obj.last_error, obj.failure_category)

    @admin.display(description="Questions")
    def review_link(self, obj):
        return format_html(
            '<a href="{}?batch__id__exact={}">Review the {} questions from this batch</a>',
            reverse("admin:question_studio_question_changelist"),
            obj.pk,
            obj.produced_count,
        )

    # --- the Generate Questions page ---------------------------------------------------------

    def add_view(self, request, form_url="", extra_context=None):
        """The Generate Questions page."""
        if not self.has_add_permission(request):
            raise PermissionDenied
        form = GenerateQuestionsForm(request.POST or None)
        if request.method == "POST" and form.is_valid():
            try:
                batch = generation.create_batch(
                    request.user, form.params(), submission_key=form.cleaned_data["submission_key"]
                )
            except generation.DuplicateSubmission as duplicate:
                messages.info(
                    request, "This request was already submitted; showing the batch it created."
                )
                return HttpResponseRedirect(self._change_url(duplicate.batch.pk))
            except generation.StudioError as error:
                form.add_error(None, str(error) or error.code)
            except contracts.InvalidGenerationRequest as error:
                form.add_error(None, ", ".join(error.codes))
            else:
                generation.start_batch(batch)
                audit_logger.info("studio_generate staff=%s batch=%s", request.user.pk, batch.pk)
                messages.success(
                    request,
                    "Generation queued. Questions appear as drafts as each part finishes. "
                    "You can close this page and come back later.",
                )
                return HttpResponseRedirect(self._change_url(batch.pk))
        context = {
            **self.admin_site.each_context(request),
            "form": form,
            "title": "Generate questions",
            "opts": self.model._meta,
        }
        return TemplateResponse(
            request, "admin/question_studio/generationbatch/generate.html", context
        )

    @staticmethod
    def _change_url(pk) -> str:
        return reverse("admin:question_studio_generationbatch_change", args=[pk])

    # --- the batch page ----------------------------------------------------------------------

    def change_view(self, request, object_id, form_url="", extra_context=None):
        batch = GenerationBatch.objects.filter(pk=object_id).first()
        extra = dict(extra_context or {})
        if batch is not None and self.has_view_permission(request, batch):
            self._status_messages(request, batch)
            active = not batch.is_terminal
            extra.update(
                studio_auto_refresh=active,
                studio_refresh_seconds=AUTO_REFRESH_SECONDS,
                studio_can_cancel=active and _perm(request, "cancel_generationbatch"),
                studio_can_retry=(
                    batch.status in (BatchStatus.FAILED, BatchStatus.PARTIALLY_FAILED)
                    and batch.chunks.filter(status=ChunkStatus.FAILED).exists()
                    and _perm(request, "retry_generationbatch")
                ),
                studio_cancel_url=reverse(
                    "admin:question_studio_generationbatch_cancel", args=[batch.pk]
                ),
                studio_retry_url=reverse(
                    "admin:question_studio_generationbatch_retry", args=[batch.pk]
                ),
            )
        return super().change_view(request, object_id, form_url, extra)

    def _status_messages(self, request, batch: GenerationBatch) -> None:
        state = jobs.display_state(batch)
        if not batch.is_terminal:
            messages.info(
                request,
                f"This batch is {state.lower()} ({_progress(batch)}). This page refreshes "
                f"every {AUTO_REFRESH_SECONDS} seconds until it finishes.",
            )
            if state == "Stalled":
                messages.warning(
                    request,
                    "No worker has renewed this batch's lease; it will be taken over when a "
                    "worker is running.",
                )
            waiting = batch.status == BatchStatus.QUEUED or state == "Waiting for a worker"
            if waiting and not any_worker_alive():
                messages.info(
                    request,
                    "No background worker has checked in recently; queued batches wait until "
                    "one runs.",
                )
        elif batch.status == BatchStatus.PARTIALLY_FAILED:
            messages.warning(
                request,
                (
                    f"Partly completed ({batch.produced_count} of {batch.requested_count}); "
                    f"reason: {batch.failure_category or 'fewer questions returned'}."
                ),
            )
        elif batch.status == BatchStatus.FAILED:
            messages.error(request, f"Generation failed: {batch.failure_category or 'unknown'}.")
        elif batch.status == BatchStatus.CANCELLED:
            messages.info(
                request,
                f"This batch was cancelled ({_progress(batch)}). Questions already stored stay "
                "as drafts.",
            )

    # --- cancel and retry --------------------------------------------------------------------

    def get_urls(self):
        info = f"{self.opts.app_label}_{self.opts.model_name}"
        return [
            path(
                "<uuid:object_id>/cancel/",
                self.admin_site.admin_view(self.cancel_view),
                name=f"{info}_cancel",
            ),
            path(
                "<uuid:object_id>/retry/",
                self.admin_site.admin_view(self.retry_view),
                name=f"{info}_retry",
            ),
            *super().get_urls(),
        ]

    def _queue_view(self, request, object_id, codename: str, verb: str, operation):
        if request.method != "POST":
            return HttpResponseNotAllowed(["POST"])
        if not _perm(request, codename):
            audit_logger.info(
                "studio_%s staff=%s batch=%s outcome=refused:not_permitted",
                verb,
                request.user.pk,
                object_id,
            )
            raise PermissionDenied
        batch = get_object_or_404(GenerationBatch, pk=object_id)
        try:
            outcome, message = operation(request, batch)
        except jobs.QueueError as error:
            messages.error(request, str(error) or error.code)
            outcome = f"refused:{error.code}"
        else:
            messages.success(request, message)
        audit_logger.info(
            "studio_%s staff=%s batch=%s outcome=%s", verb, request.user.pk, batch.pk, outcome
        )
        return HttpResponseRedirect(self._change_url(batch.pk))

    def cancel_view(self, request, object_id):
        return self._queue_view(request, object_id, "cancel_generationbatch", "cancel", _cancel)

    def retry_view(self, request, object_id):
        return self._queue_view(request, object_id, "retry_generationbatch", "retry", _retry)

    # --- bulk actions ------------------------------------------------------------------------

    actions = ("action_cancel", "action_retry")
    ACTION_PERMS = {
        "action_cancel": "cancel_generationbatch",
        "action_retry": "retry_generationbatch",
    }

    def get_actions(self, request, action_location=ActionLocation.CHANGE_LIST):
        actions = super().get_actions(request, action_location)
        return {
            n: a
            for n, a in actions.items()
            if n in self.ACTION_PERMS and _perm(request, self.ACTION_PERMS[n])
        }

    def _bulk(self, request, queryset, verb: str, operation):
        done, refused = 0, []
        for batch in queryset:
            try:
                operation(request, batch)
            except jobs.QueueError as error:
                refused.append((batch, str(error) or error.code))
            else:
                done += 1
        if done:
            self.message_user(request, f"{done} batch(es): {verb}.", messages.SUCCESS)
        for batch, reason in refused[:10]:
            self.message_user(
                request, f"Skipped {batch.topic} grade {batch.grade}: {reason}", messages.WARNING
            )
        if len(refused) > 10:
            self.message_user(request, f"{len(refused) - 10} more skipped.", messages.WARNING)
        audit_logger.info(
            "studio_bulk verb=%s staff=%s done=%s refused=%s",
            verb,
            request.user.pk,
            done,
            len(refused),
        )

    @admin.action(description="Cancel selected batches")
    def action_cancel(self, request, queryset):
        if not _perm(request, "cancel_generationbatch"):
            raise PermissionDenied
        self._bulk(request, queryset, "cancel requested", _cancel)

    @admin.action(description="Retry failed chunks of selected batches")
    def action_retry(self, request, queryset):
        if not _perm(request, "retry_generationbatch"):
            raise PermissionDenied
        self._bulk(request, queryset, "failed chunks queued again", _retry)


def _cancel(request, batch: GenerationBatch) -> tuple[str, str]:
    """Returns (audit outcome, staff message)."""
    if jobs.request_cancel(batch.pk, request.user) == "cancelled":
        return "cancelled", "Batch cancelled. Questions already stored stay as drafts."
    return "cancelling", "Cancel requested. The worker stops before the next part of this batch."


def _retry(request, batch: GenerationBatch) -> tuple[str, str]:
    """Returns (audit outcome, staff message). Inline and thread modes run the batch now."""
    count = jobs.retry_failed(batch.pk, request.user)
    generation.start_batch(GenerationBatch.objects.get(pk=batch.pk))
    return f"queued:{count}", f"{count} failed chunk(s) queued again."


@admin.register(StudioWorker)
class StudioWorkerAdmin(admin.ModelAdmin):
    """Background worker check-ins, for health diagnostics. Read-only."""

    list_display = (
        "worker_id",
        "hostname",
        "pid",
        "state",
        "alive",
        "concurrency",
        "current_batch",
        "batches_processed",
        "chunks_processed",
        "started_at",
        "last_seen_at",
        "stopped_at",
    )
    list_filter = ("state",)
    ordering = ("-last_seen_at",)
    actions = None

    def has_module_permission(self, request):
        return _perm(request, "view_studioworker")

    def has_view_permission(self, request, obj=None):
        return _perm(request, "view_studioworker")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def get_readonly_fields(self, request, obj=None):
        return [*(f.name for f in self.model._meta.fields), "alive"]

    @admin.display(description="alive", boolean=True)
    def alive(self, obj):
        return worker_is_alive(obj)


class _ReadOnlyInline(admin.TabularInline):
    """Shown to anyone who may view the parent question; nothing in it can be changed."""

    extra = 0
    can_delete = False

    def has_view_permission(self, request, obj=None):
        return _perm(request, "view_question")

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


class FindingInline(_ReadOnlyInline):
    model = ValidationFinding
    fields = ("run", "severity", "code", "message")
    readonly_fields = fields
    verbose_name_plural = "Validation report (all runs; the latest run decides)"


class EventInline(_ReadOnlyInline):
    model = ReviewEvent
    fields = ("at", "actor", "action", "from_status", "to_status", "note")
    readonly_fields = fields
    verbose_name_plural = "History"


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = (
        "short_stem",
        "subject",
        "grade",
        "topic",
        "difficulty",
        "question_type",
        "validation_status",
        "review_status",
        "adventure",
        "created_at",
    )
    list_filter = (
        "review_status",
        "validation_status",
        "subject",
        "grade",
        "topic",
        "difficulty",
        "question_type",
        "batch__id",
    )
    search_fields = ("stem", "skill_code")
    ordering = ("-created_at",)
    list_per_page = 50
    inlines = [FindingInline, EventInline]
    fieldsets = (
        (
            "Question",
            {
                "fields": (
                    "stem",
                    "question_type",
                    "choices",
                    "correct_answer",
                    "accepted_answers",
                    "operation",
                    "operands",
                    "hint",
                    "explanation",
                )
            },
        ),
        ("Curriculum", {"fields": ("subject", "grade", "topic", "skill_code", "difficulty")}),
        ("Where it is used", {"fields": ("world", "location", "adventure")}),
        (
            "Status",
            {
                "fields": (
                    "review_status",
                    "validation_status",
                    "validation_run",
                    "reviewed_by",
                    "reviewed_at",
                    "replaces",
                )
            },
        ),
        (
            "Provenance",
            {
                "fields": (
                    "batch",
                    "source_model",
                    "prompt_version",
                    "generated_at",
                    "created_at",
                    "updated_at",
                )
            },
        ),
    )
    STATUS_FIELDS = (
        "review_status",
        "validation_status",
        "validation_run",
        "reviewed_by",
        "reviewed_at",
        "replaces",
        "batch",
        "source_model",
        "prompt_version",
        "generated_at",
        "created_at",
        "updated_at",
    )

    def has_module_permission(self, request):
        return _perm(request, "view_question")

    def has_view_permission(self, request, obj=None):
        return _perm(request, "view_question")

    def has_add_permission(self, request):
        return _perm(request, "add_question")

    def has_change_permission(self, request, obj=None):
        # A published question is frozen (its correction is a new draft), so its page is
        # view-only: no Save that would end in "Not saved" beside Django's "changed" message.
        if obj is not None and obj.review_status == ReviewStatus.PUBLISHED:
            return False
        return _perm(request, "change_question")

    def has_delete_permission(self, request, obj=None):
        return False  # drafts are rejected, never deleted: the history stays

    @admin.display(description="question")
    def short_stem(self, obj):
        return obj.stem[:70]

    def get_readonly_fields(self, request, obj=None):
        if obj is not None and obj.review_status == ReviewStatus.PUBLISHED:
            return [f.name for f in self.model._meta.fields]
        fixed = list(self.STATUS_FIELDS)
        if obj is not None:
            fixed += ["subject", "question_type"]  # the type and subject fix the shape
        return fixed

    def save_model(self, request, obj, form, change):
        try:
            if not change:
                obj.review_status = ReviewStatus.DRAFT
                obj.save()
                ReviewEvent.objects.create(
                    question=obj, actor=request.user, action="created", to_status=obj.review_status
                )
                validation.run_validation(obj)
                return
            changes = {
                name: form.cleaned_data[name]
                for name in form.changed_data
                if name in workflow.EDITABLE
            }
            workflow.edit(obj, request.user, changes)
        except workflow.StudioError as error:
            messages.error(request, f"Not saved: {error.code}.")

    # --- actions ----------------------------------------------------------------------------

    actions = (
        "action_revalidate",
        "action_submit",
        "action_approve",
        "action_reject",
        "action_publish",
        "action_correct",
        "action_regenerate",
    )
    ACTION_PERMS = {
        "action_revalidate": "change_question",
        "action_submit": "change_question",
        "action_approve": "approve_question",
        "action_reject": "approve_question",
        "action_publish": "publish_question",
        "action_correct": "change_question",
        "action_regenerate": "add_generationbatch",
    }

    def get_actions(self, request, action_location=ActionLocation.CHANGE_LIST):
        actions = super().get_actions(request, action_location)
        return {
            n: a
            for n, a in actions.items()
            if n not in self.ACTION_PERMS or _perm(request, self.ACTION_PERMS[n])
        }

    def _report(self, request, verb, done, refused):
        if done:
            self.message_user(request, f"{len(done)} question(s) {verb}.", messages.SUCCESS)
        for question, code in refused[:10]:
            self.message_user(request, f"Skipped “{question.stem[:40]}”: {code}.", messages.WARNING)
        if len(refused) > 10:
            self.message_user(request, f"{len(refused) - 10} more skipped.", messages.WARNING)
        audit_logger.info(
            "studio_bulk verb=%s staff=%s done=%s refused=%s",
            verb,
            request.user.pk,
            len(done),
            len(refused),
        )

    @admin.action(description="Revalidate selected questions")
    def action_revalidate(self, request, queryset):
        self._report(
            request,
            "revalidated",
            *workflow.bulk(workflow.revalidate, list(queryset), request.user),
        )

    @admin.action(description="Submit selected drafts for review")
    def action_submit(self, request, queryset):
        self._report(
            request,
            "submitted",
            *workflow.bulk(workflow.submit_for_review, list(queryset), request.user),
        )

    @admin.action(description="Approve selected questions")
    def action_approve(self, request, queryset):
        self._report(
            request, "approved", *workflow.bulk(workflow.approve, list(queryset), request.user)
        )

    @admin.action(description="Reject selected questions")
    def action_reject(self, request, queryset):
        self._report(
            request,
            "rejected",
            *workflow.bulk(workflow.reject, list(queryset), request.user, note="bulk reject"),
        )

    @admin.action(description="Publish selected approved questions")
    def action_publish(self, request, queryset):
        self._report(
            request, "published", *workflow.bulk(workflow.publish, list(queryset), request.user)
        )

    @admin.action(description="Start a correction of selected published questions")
    def action_correct(self, request, queryset):
        """A published question is read-only; its correction is a new draft that, once
        published, supersedes the old revision (`workflow.start_correction`)."""
        self._report(
            request,
            "copied into a correction draft",
            *workflow.bulk(workflow.start_correction, list(queryset), request.user),
        )

    @admin.action(description="Regenerate: reject selected and queue replacements")
    def action_regenerate(self, request, queryset):
        if not _perm(request, "approve_question"):
            self.message_user(
                request, "Regenerating also needs approval permission.", messages.ERROR
            )
            return
        try:
            batch, rejected = regeneration.regenerate(list(queryset), request.user)
        except (generation.StudioError, contracts.InvalidGenerationRequest) as error:
            self.message_user(
                request, f"Not regenerated: {getattr(error, 'code', error)}.", messages.ERROR
            )
            return
        generation.start_batch(batch)
        self.message_user(
            request,
            f"{rejected} rejected; replacement batch {batch.get_status_display().lower()}.",
            messages.SUCCESS,
        )


@admin.register(QuestionRevision)
class QuestionRevisionAdmin(admin.ModelAdmin):
    list_display = (
        "question",
        "number",
        "status",
        "subject",
        "grade",
        "topic",
        "difficulty",
        "adventure",
        "published_by",
        "published_at",
    )
    list_filter = ("status", "subject", "grade", "topic")
    actions = ("action_retire",)

    def has_module_permission(self, request):
        return _perm(request, "view_questionrevision")

    def has_view_permission(self, request, obj=None):
        return _perm(request, "view_questionrevision")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def get_readonly_fields(self, request, obj=None):
        return [f.name for f in self.model._meta.fields]

    def get_actions(self, request, action_location=ActionLocation.CHANGE_LIST):
        actions = super().get_actions(request, action_location)
        return actions if _perm(request, "retire_revision") else {}

    @admin.action(description="Retire selected revisions (withdraw from play)")
    def action_retire(self, request, queryset):
        done, refused = workflow.bulk(
            workflow.retire, list(queryset), request.user, note="retired in admin"
        )
        self.message_user(
            request,
            f"{len(done)} retired, {len(refused)} skipped.",
            messages.SUCCESS if done else messages.WARNING,
        )
        audit_logger.info("studio_retire staff=%s done=%s", request.user.pk, len(done))


@admin.register(QuestionPool)
class QuestionPoolAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "enabled",
        "region_id",
        "entity_id",
        "adventure",
        "subject",
        "grade",
        "topic",
        "difficulty",
        "min_pool_size",
    )
    list_filter = ("enabled", "subject")

    def has_module_permission(self, request):
        return _perm(request, "view_questionpool")

    def has_view_permission(self, request, obj=None):
        return _perm(request, "view_questionpool")

    def has_add_permission(self, request):
        return _perm(request, "add_questionpool")

    def has_change_permission(self, request, obj=None):
        return _perm(request, "change_questionpool")

    def has_delete_permission(self, request, obj=None):
        return _perm(request, "delete_questionpool")


@admin.register(StudioLimits)
class StudioLimitsAdmin(admin.ModelAdmin):
    def has_module_permission(self, request):
        return _perm(request, "view_studiolimits")

    def has_view_permission(self, request, obj=None):
        return _perm(request, "view_studiolimits")

    def has_add_permission(self, request):
        return _perm(request, "add_studiolimits") and not StudioLimits.objects.exists()

    def has_change_permission(self, request, obj=None):
        return _perm(request, "change_studiolimits")

    def has_delete_permission(self, request, obj=None):
        return False
