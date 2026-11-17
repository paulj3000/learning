"""AI Question Studio in Django Admin (LAI-AQS-015 to 019, ADR-034, ADR-046).

Staff-only and permission-gated, never by `is_staff` alone. Every status change goes through
`workflow`, so the Admin cannot do anything a test of the workflow would not allow, and each is
recorded as a ReviewEvent. Published revisions are read-only; a correction is a new draft.
Admin actions are offered only to users who hold the matching permission.
"""

import logging

from django.contrib import admin, messages
from django.contrib.admin.options import ActionLocation
from django.core.exceptions import PermissionDenied
from django.db.models import Count
from django.http import HttpResponseNotAllowed, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html

from . import contracts, generation, regeneration, validation, workflow
from .forms import GenerateQuestionsForm
from .models import (
    BatchStatus,
    GenerationBatch,
    Question,
    QuestionPool,
    QuestionRevision,
    ReviewEvent,
    ReviewStatus,
    StudioLimits,
    ValidationFinding,
)

audit_logger = logging.getLogger("lai.admin_audit")


def _perm(request, codename: str) -> bool:
    user = request.user
    return bool(user.is_active and user.is_staff and user.has_perm(f"question_studio.{codename}"))


def _progress(batch: GenerationBatch) -> str:
    return (
        f"{batch.produced_count} of {batch.requested_count} questions, "
        f"{batch.chunks_done} of {batch.chunks_total} chunks"
    )


def _state(batch: GenerationBatch) -> str:
    if not batch.is_terminal and batch.cancel_requested_at:
        return "Cancelling"
    return batch.get_status_display()


@admin.register(GenerationBatch)
class GenerationBatchAdmin(admin.ModelAdmin):
    list_display = (
        "created_at",
        "state",
        "subject",
        "grade",
        "topic",
        "question_type",
        "progress",
        "total_tokens",
        "cost_microusd",
        "failure_category",
    )
    list_filter = ("status", "subject", "grade")
    ordering = ("-created_at",)
    list_per_page = 50

    def has_module_permission(self, request):
        return _perm(request, "view_generationbatch") or _perm(request, "add_generationbatch")

    def has_add_permission(self, request):
        return _perm(request, "add_generationbatch")

    def has_change_permission(self, request, obj=None):
        return False  # batches are provenance: read-only

    def has_delete_permission(self, request, obj=None):
        return False

    def has_cancel_permission(self, request, obj=None):
        return _perm(request, "cancel_generationbatch")

    def has_retry_permission(self, request, obj=None):
        return _perm(request, "retry_generationbatch") and _perm(request, "add_generationbatch")

    @admin.display(description="tokens")
    def total_tokens(self, obj):
        return obj.input_tokens + obj.output_tokens

    @admin.display(description="state", ordering="status")
    def state(self, obj):
        return _state(obj)

    @admin.display(description="progress")
    def progress(self, obj):
        return _progress(obj)

    @admin.display(description="failure detail")
    def failure_detail(self, obj):
        """A fixed message per failure category: never provider, worker or model text."""
        return generation.failure_message(obj) or "-"

    def get_readonly_fields(self, request, obj=None):
        return [
            "state",
            "progress",
            "failure_detail",
            *(f.name for f in self.model._meta.fields),
            "review_link",
            "job_status",
        ]

    @admin.display(description="Background jobs")
    def job_status(self, obj):
        """The chunk jobs of a batch run with LAI_STUDIO_RUN_MODE=jobs (counts and codes only)."""
        from apps.jobs.models import ProcessingJob

        jobs = ProcessingJob.objects.filter(
            subject_type="question_studio.generationbatch", subject_id=str(obj.pk)
        )
        total = jobs.count()
        if not total:
            return "No background jobs (this batch ran in process)."
        latest = jobs.order_by("-created_at").first()
        counts = ", ".join(
            f"{row['status']} {row['n']}"
            for row in jobs.values("status").annotate(n=Count("pk")).order_by("status")
        )
        code = f", error {latest.error_code}" if latest.error_code else ""
        return f"{total} chunk job(s): {counts}. Latest: {latest.status}{code}."

    @admin.display(description="Questions")
    def review_link(self, obj):
        return format_html(
            '<a href="{}?batch__id__exact={}">Review the {} questions from this batch</a>',
            reverse("admin:question_studio_question_changelist"),
            obj.pk,
            obj.produced_count,
        )

    def add_view(self, request, form_url="", extra_context=None):
        """The Generate Questions page."""
        if not self.has_add_permission(request):
            from django.core.exceptions import PermissionDenied

            raise PermissionDenied
        form = GenerateQuestionsForm(request.POST or None)
        if request.method == "POST" and form.is_valid():
            try:
                batch = generation.create_batch(
                    request.user,
                    form.params(),
                    submission_key=form.cleaned_data.get("submission_key"),
                )
            except generation.DuplicateSubmission as duplicate:
                messages.info(
                    request, "This request was already submitted; showing the batch it created."
                )
                return HttpResponseRedirect(
                    reverse(
                        "admin:question_studio_generationbatch_change", args=[duplicate.batch.pk]
                    )
                )
            except generation.StudioError as error:
                form.add_error(None, str(error) or error.code)
            except contracts.InvalidGenerationRequest as error:
                form.add_error(None, ", ".join(error.codes))
            else:
                generation.start_batch(batch)
                audit_logger.info("studio_generate staff=%s batch=%s", request.user.pk, batch.pk)
                messages.success(
                    request,
                    f"Generation {batch.get_status_display().lower()}. Questions appear as drafts "
                    "when it finishes; refresh this page to follow progress.",
                )
                return HttpResponseRedirect(
                    reverse("admin:question_studio_generationbatch_change", args=[batch.pk])
                )
        context = {
            **self.admin_site.each_context(request),
            "form": form,
            "title": "Generate questions",
            "opts": self.model._meta,
        }
        return TemplateResponse(
            request, "admin/question_studio/generationbatch/generate.html", context
        )

    def change_view(self, request, object_id, form_url="", extra_context=None):
        batch = GenerationBatch.objects.filter(pk=object_id).first()
        extra = dict(extra_context or {})
        if batch is not None:
            extra.update(
                studio_can_cancel=not batch.is_terminal
                and self.has_cancel_permission(request, batch),
                studio_can_retry=batch.status in (BatchStatus.FAILED, BatchStatus.PARTIAL)
                and self.has_retry_permission(request, batch),
                studio_cancel_url=reverse(
                    "admin:question_studio_generationbatch_cancel", args=[batch.pk]
                ),
                studio_retry_url=reverse(
                    "admin:question_studio_generationbatch_retry", args=[batch.pk]
                ),
            )
            if batch.status in (BatchStatus.QUEUED, BatchStatus.RUNNING):
                messages.info(
                    request,
                    f"This batch is {_state(batch).lower()} ({_progress(batch)}); "
                    "refresh to update.",
                )
            elif batch.status == BatchStatus.PARTIAL:
                messages.warning(
                    request,
                    (
                        f"Partly completed ({batch.produced_count} of {batch.requested_count}); "
                        f"reason: {batch.failure_category or 'fewer questions returned'}."
                    ),
                )
            elif batch.status == BatchStatus.FAILED:
                messages.error(
                    request, f"Generation failed: {batch.failure_category or 'unknown'}."
                )
            elif batch.status == BatchStatus.CANCELLED:
                messages.info(
                    request,
                    f"This batch was cancelled ({_progress(batch)}). Questions already stored "
                    "stay as drafts.",
                )
        return super().change_view(request, object_id, form_url, extra)

    # --- cancel and retry (LAI-AQS-027 functionality on the jobs path) ------------------------

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

    def _cancel(self, request, batch) -> str:
        outcome = generation.request_cancel(batch.pk, request.user)
        if outcome == "cancelled":
            return "Batch cancelled. Questions already stored stay as drafts."
        return "Cancel requested: the batch stops before its next chunk."

    def _retry(self, request, batch) -> str:
        batch, missing = generation.retry_batch(batch.pk, request.user)
        generation.start_batch(batch)
        return f"Retrying {missing} missing question(s); stored drafts are kept."

    def _batch_view(self, request, object_id, allowed: bool, verb: str, operation):
        if request.method != "POST":
            return HttpResponseNotAllowed(["POST"])
        if not allowed:
            raise PermissionDenied
        batch = get_object_or_404(GenerationBatch, pk=object_id)
        try:
            message = operation(request, batch)
        except generation.StudioError as error:
            messages.error(request, f"Not {verb}: {error}.")
            outcome = getattr(error, "code", "refused")
        else:
            messages.success(request, message)
            outcome = "ok"
        audit_logger.info(
            "studio_%s staff=%s batch=%s outcome=%s", verb, request.user.pk, batch.pk, outcome
        )
        return HttpResponseRedirect(
            reverse("admin:question_studio_generationbatch_change", args=[batch.pk])
        )

    def cancel_view(self, request, object_id):
        return self._batch_view(
            request, object_id, self.has_cancel_permission(request), "cancelled", self._cancel
        )

    def retry_view(self, request, object_id):
        return self._batch_view(
            request, object_id, self.has_retry_permission(request), "retried", self._retry
        )

    actions = ("action_cancel", "action_retry")

    @admin.action(description="Cancel selected batches", permissions=["cancel"])
    def action_cancel(self, request, queryset):
        self._bulk(request, queryset, "cancelled", self._cancel)

    @admin.action(description="Retry missing questions of selected batches", permissions=["retry"])
    def action_retry(self, request, queryset):
        self._bulk(request, queryset, "retried", self._retry)

    def _bulk(self, request, queryset, verb, operation):
        done, refused = 0, []
        for batch in queryset:
            try:
                operation(request, batch)
            except generation.StudioError as error:
                refused.append(getattr(error, "code", "refused"))
            else:
                done += 1
        if done:
            self.message_user(request, f"{done} batch(es) {verb}.", messages.SUCCESS)
        if refused:
            reasons = ", ".join(sorted(set(refused)))
            self.message_user(request, f"{len(refused)} skipped ({reasons}).", messages.WARNING)
        audit_logger.info(
            "studio_bulk_batch verb=%s staff=%s done=%s refused=%s",
            verb,
            request.user.pk,
            done,
            len(refused),
        )


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

    @staticmethod
    def _frozen(obj) -> bool:
        """Published, or withdrawn after publishing (retired or superseded): never editable."""
        if obj is None:
            return False
        if obj.review_status == ReviewStatus.PUBLISHED:
            return True
        return obj.review_status == ReviewStatus.REJECTED and obj.revisions.exists()

    def has_change_permission(self, request, obj=None):
        # A published question is frozen (its correction is a new draft), so its page is
        # view-only: no Save that would end in "Not saved" beside Django's "changed" message.
        # The same holds once it is retired or superseded (QA-AQS-D1).
        if self._frozen(obj):
            return False
        return _perm(request, "change_question")

    def has_delete_permission(self, request, obj=None):
        return False  # drafts are rejected, never deleted: the history stays

    @admin.display(description="question")
    def short_stem(self, obj):
        return obj.stem[:70]

    def get_readonly_fields(self, request, obj=None):
        if self._frozen(obj):
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
