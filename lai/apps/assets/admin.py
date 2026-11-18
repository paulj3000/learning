"""Asset versions in Django Admin (LAI-2200 AM-5, ADR-035).

Every action is a Django permission (grant them with the groups from `ensure_asset_roles`):

- view: `assets.view_assetversion`
- upload (the add page is an upload form): `assets.add_assetversion`
- edit admin notes: `assets.change_assetversion`
- publish and make default: `assets.publish_assetversion`
- retire: `assets.retire_assetversion`
- delete a never-published version and its file: `assets.delete_assetversion`
- preview a model in 3D (AM-10, read-only): staff with view access (`apps.assets.preview`)
- preview an image or play a sound (AM-13, read-only): the same view access; served through
  Django with `nosniff` and a locked-down Content-Security-Policy, never as a page
- verify the stored file, roll back to an earlier version: publish permission
- validate a model in background (`asset.validate_model`, LAI-LAMBDA-007, ADR-064): staff with
  upload and view permission. It submits a job (or finds the existing one for the same file) and
  never changes the version, whatever `LAI_ASSET_ASYNC_VALIDATION` says: it is the way to
  revalidate an existing or published model without rewriting its metadata. The result is shown
  read-only in the version's "Background validation" section; a stuck job is failed from its
  background job page (`jobs.fail_processingjob`)
Every lifecycle action is recorded in Django Admin's history (`LogEntry`) with who and what,
and so is each background validation job the action submits.

Saving the change page writes only the editable fields (`EDITABLE_FIELDS`, the notes), never the
whole row as it was loaded: a background result applied meanwhile (DRAFT to VALIDATED, its
metadata and report) is never overwritten by a stale form.

The binary fields are read-only for everyone, always; a published version is never deletable.
All state changes go through `apps.assets.services`.
"""

import json
import logging

from django import forms
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.http import FileResponse, JsonResponse
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html, format_html_join
from django.utils.timezone import localtime
from django.views.decorators.cache import never_cache

from apps.catalog.models import AssetStatus, ContentAsset
from apps.core.exceptions import error_body

from . import preview, services
from .admin_image import ImageConversionAdminMixin
from .models import AssetVersion, VersionStatus
from .processing import (
    APPLIED_OUTCOMES,
    ASYNC_FORMATS,
    PROCESSING_SOURCE,
    async_validation_enabled,
    identity_mismatch,
    model_validation_summary,
    processing_findings,
    submit_model_validation,
    validation_jobs,
)
from .storage import StorageError, get_storage, sha256_of
from .validation import largest_upload_bytes, max_bytes_for, max_glb_bytes

logger = logging.getLogger("lai.assets")


class UploadForm(forms.Form):
    asset = forms.ModelChoiceField(
        queryset=ContentAsset.objects.filter(status=AssetStatus.ACTIVE).order_by("asset_id"),
        help_text="The asset this file is a new version of. Create the asset first if needed.",
    )
    file = forms.FileField(
        label="File",
        help_text=(
            "3D model: .glb, or a .gltf with every buffer and texture embedded. "
            "Image: PNG, JPEG or WebP. Audio: MP3, WAV (PCM) or Ogg (Vorbis or Opus). "
            "The file type is read from the file itself and must suit the asset's kind."
        ),
    )
    notes = forms.CharField(
        max_length=500, required=False, widget=forms.Textarea(attrs={"rows": 2})
    )

    def clean_file(self):
        upload = self.cleaned_data["file"]
        if upload.size > largest_upload_bytes():
            raise forms.ValidationError(
                f"The file is {upload.size:,} bytes; the largest limit is "
                f"{largest_upload_bytes():,} bytes."
            )
        return upload


@admin.register(AssetVersion)
class AssetVersionAdmin(ImageConversionAdminMixin, admin.ModelAdmin):
    list_display = (
        "version_label",
        "status",
        "is_default",
        "family_label",
        "format",
        "size_bytes",
        "published_at",
        "created_at",
        "preview_link",
    )
    list_filter = ("status", "format", "asset__category", "asset__kind")
    search_fields = ("asset__asset_id", "asset__display_name", "sha256", "original_filename")
    list_select_related = ("asset", "asset__default_version")
    ordering = ("asset__asset_id", "-number")
    actions = [
        "publish_versions",
        "make_default",
        "rollback_to_versions",
        "retire_versions",
        "verify_versions",
        "validate_in_background",
        "inspect_in_background",
    ]
    fields = (
        "asset",
        "preview_link",
        "file_preview",
        "number",
        "version_id",
        "status",
        "is_default",
        "format",
        "content_type",
        "size_bytes",
        "sha256",
        "original_filename",
        "storage_key",
        "clips",
        "dimensions",
        "findings",
        "metadata_summary",
        "notes",
        "uploaded_by",
        "created_at",
        "validated_at",
        "published_by",
        "published_at",
        "retired_at",
    )

    # --- permissions ---

    def _perm(self, request, codename: str) -> bool:
        return request.user.has_perm(f"assets.{codename}_assetversion")

    def has_view_permission(self, request, obj=None):
        return self._perm(request, "view") or self._perm(request, "change")

    def has_add_permission(self, request):
        return self._perm(request, "add")

    def has_change_permission(self, request, obj=None):
        return self._perm(request, "change")

    def has_delete_permission(self, request, obj=None):
        if obj is not None and obj.was_published:
            return False
        return self._perm(request, "delete")

    def has_publish_permission(self, request):
        return self._perm(request, "publish")

    def has_retire_permission(self, request):
        return self._perm(request, "retire")

    def has_validate_permission(self, request):
        """Validate in background: staff who may upload and view versions."""
        return bool(
            request.user.is_staff
            and self._perm(request, "add")
            and self.has_view_permission(request)
        )

    def get_readonly_fields(self, request, obj=None):
        return [name for name in self.fields if name not in EDITABLE_FIELDS] + list(
            BACKGROUND_FIELDS
        )

    def save_model(self, request, obj, form, change):
        """Write only the editable fields of an existing version. The object was loaded when the
        form was shown; saving every field would put back its old status, metadata and report
        over a background result applied since (a lost update). `update_fields` keeps the
        model's own transition and immutability checks."""
        if not change:
            super().save_model(request, obj, form, change)
            return
        obj.save(update_fields=list(EDITABLE_FIELDS))

    def get_fieldsets(self, request, obj=None):
        """The page as before, plus a read-only "Background validation" section when
        asynchronous validation is on or the version has a validation job (flag off and no job:
        the page is unchanged)."""
        fieldsets = list(super().get_fieldsets(request, obj))
        if obj is not None and (async_validation_enabled() or _latest_job(obj) is not None):
            fieldsets.append(("Background validation", {"fields": BACKGROUND_FIELDS}))
        return fieldsets

    # --- upload: the add page ---

    def get_urls(self):
        upload = self.admin_site.admin_view(self.upload_view)
        preview_page = self.admin_site.admin_view(self.preview_view)
        # Not `admin_view`: the viewer fetches this, so a refusal is JSON, never a login redirect.
        preview_file = never_cache(self.preview_file_view)
        media_file = never_cache(self.media_file_view)
        return [
            path("upload/", upload, name="assets_assetversion_upload"),
            path("<int:object_id>/preview/", preview_page, name="assets_assetversion_preview"),
            path(
                "<int:object_id>/preview/model/",
                preview_file,
                name="assets_assetversion_preview_file",
            ),
            path("<int:object_id>/media/", media_file, name="assets_assetversion_media"),
            *super().get_urls(),
        ]

    def add_view(self, request, form_url="", extra_context=None):
        query = request.META.get("QUERY_STRING")
        target = reverse("admin:assets_assetversion_upload")
        return redirect(f"{target}?{query}" if query else target)

    def upload_view(self, request):
        if not self.has_add_permission(request):
            raise PermissionDenied
        findings = []
        if request.method == "POST":
            form = UploadForm(request.POST, request.FILES)
            if form.is_valid():
                upload = form.cleaned_data["file"]
                try:
                    version = services.upload_version(
                        form.cleaned_data["asset"],
                        upload,
                        original_filename=upload.name,
                        user=request.user,
                    )
                except services.AssetActionRefused as refused:
                    form.add_error(None, refused.message)
                    findings = [f.as_dict() for f in refused.findings]
                else:
                    if form.cleaned_data["notes"]:
                        version.notes = form.cleaned_data["notes"]
                        version.save(update_fields=["notes"])
                    self.log_addition(request, version, [{"added": {}}])
                    if version.status == VersionStatus.DRAFT:
                        state = "stored as a draft and is being validated in the background."
                    elif version.status == VersionStatus.REJECTED:
                        state = "rejected by background validation; see its validation report."
                    else:
                        state = "validated and not yet published."
                    self.message_user(
                        request,
                        f"Uploaded {version.asset.asset_id} version {version.number}. It is "
                        + state,
                        messages.SUCCESS,
                    )
                    return redirect(reverse("admin:assets_assetversion_change", args=[version.pk]))
        else:
            form = UploadForm(initial={"asset": request.GET.get("asset")})
        context = {
            **self.admin_site.each_context(request),
            "opts": self.model._meta,
            "title": "Upload a file version",
            "form": form,
            "findings": findings,
            "limits": [
                ("3D models", max_bytes_for("model")),
                ("GLB models", max_glb_bytes()),
                ("Images", max_bytes_for("image")),
                ("Audio", max_bytes_for("audio")),
            ],
        }
        return TemplateResponse(request, "admin/assets/assetversion/upload.html", context)

    # --- preview (AM-10): read-only, staff only, never changes a version ---

    def preview_view(self, request, object_id):
        if not preview.can_preview(request.user):
            raise PermissionDenied
        version = (
            AssetVersion.objects.select_related("asset", "asset__default_version")
            .filter(pk=object_id)
            .first()
        )
        if version is None:
            return self._get_obj_does_not_exist_redirect(request, self.model._meta, str(object_id))
        refusal = preview.refusal_for(version)
        context = {
            **self.admin_site.each_context(request),
            "opts": self.model._meta,
            "title": f"Preview {version.label}",
            "version": version,
            "summary": preview.summary(version),
            "refusal": refusal,
            "change_url": reverse("admin:assets_assetversion_change", args=[version.pk]),
            "asset_url": reverse("admin:catalog_contentasset_change", args=[version.asset_id]),
        }
        if refusal is None and version.family != "model":
            context["media_url"] = reverse("admin:assets_assetversion_media", args=[version.pk])
        elif refusal is None:
            token = preview.issue_token(version, request.user)
            context.update(
                preview_token=token.value,
                preview_file_url=reverse(
                    "admin:assets_assetversion_preview_file", args=[version.pk]
                ),
                preview_token_header=preview.TOKEN_HEADER,
                max_bytes=max_bytes_for(version.family),
            )
        logger.info("asset version previewed: %s v%s", version.asset.asset_id, version.number)
        return TemplateResponse(request, "admin/assets/assetversion/preview.html", context)

    def preview_file_view(self, request, object_id):
        if request.method != "GET":
            return _preview_error("method_not_allowed", "Use GET.", 405)
        if not preview.can_preview(request.user):
            return _preview_error("forbidden", "You do not have access to model previews.", 403)
        version = AssetVersion.objects.select_related("asset").filter(pk=object_id).first()
        if version is None:
            return _preview_error("not_found", "Not found.", 404)
        try:
            token = request.headers.get(preview.TOKEN_HEADER, "")
            preview.check_token(token, version, request.user)
            refusal = preview.refusal_for(version)
            if refusal is not None:
                raise refusal
        except preview.PreviewRefused as refused:
            return _preview_error(refused.code, refused.message, refused.status)
        return _verified_response(version)

    def media_file_view(self, request, object_id):
        """Image and audio bytes for the admin's own <img> and <audio> tags (AM-13).

        These tags cannot send a custom header, so access is the staff session plus the same
        view permission as every other preview, on GET only. The response is data: `nosniff`,
        a content type from our own table (never the client's), and a CSP that forbids scripts
        and framing even if a browser were to open the URL directly.
        """
        if request.method != "GET":
            return _preview_error("method_not_allowed", "Use GET.", 405)
        if not request.user.is_authenticated or not preview.can_preview(request.user):
            return _preview_error("forbidden", "You do not have access to previews.", 403)
        version = AssetVersion.objects.select_related("asset").filter(pk=object_id).first()
        if version is None or version.family == "model":
            return _preview_error("not_found", "Not found.", 404)
        refusal = preview.refusal_for(version)
        if refusal is not None:
            return _preview_error(refusal.code, refusal.message, refusal.status)
        return _verified_response(version)

    # --- deletion goes through the service, so the stored file is removed too ---

    def delete_model(self, request, obj):
        services.delete_unpublished_version(obj)

    def delete_queryset(self, request, queryset):
        for version in queryset:
            services.delete_unpublished_version(version)

    def get_deleted_objects(self, objs, request):
        deleted, model_count, perms_needed, protected = super().get_deleted_objects(objs, request)
        if any(getattr(obj, "was_published", False) for obj in objs):
            protected = [*protected, "Published versions are never deleted; retire them instead."]
        return deleted, model_count, perms_needed, protected

    # --- lifecycle actions (each success is written to the admin history) ---

    def _run(self, request, queryset, action, done: str):
        succeeded = 0
        for version in queryset.select_related("asset"):
            try:
                action(version)
            except services.AssetActionRefused as refused:
                self.message_user(request, f"{version.label}: {refused.message}", messages.ERROR)
            else:
                succeeded += 1
                self.log_change(request, version, done_message(done, version))
        if succeeded:
            self.message_user(request, f"{done} {succeeded} version(s).", messages.SUCCESS)

    @admin.action(description="Publish selected versions", permissions=["publish"])
    def publish_versions(self, request, queryset):
        # Oldest first, so a bulk publish makes the lowest-numbered version the default.
        ordered = queryset.order_by("asset__asset_id", "number")
        self._run(
            request, ordered, lambda v: services.publish_version(v, user=request.user), "Published"
        )

    @admin.action(description="Make the selected version the default", permissions=["publish"])
    def make_default(self, request, queryset):
        if queryset.count() != 1:
            self.message_user(request, "Select exactly one version.", messages.ERROR)
            return
        self._run(request, queryset, services.set_default_version, "Made default:")

    @admin.action(
        description="Roll back: make the selected earlier version the live one",
        permissions=["publish"],
    )
    def rollback_to_versions(self, request, queryset):
        if queryset.count() != 1:
            self.message_user(request, "Select exactly one version.", messages.ERROR)
            return
        self._run(
            request,
            queryset,
            lambda v: services.rollback_to_version(v, user=request.user),
            "Rolled back to",
        )

    @admin.action(description="Retire selected versions", permissions=["retire"])
    def retire_versions(self, request, queryset):
        self._run(request, queryset, services.retire_version, "Retired")

    @admin.action(description="Verify the stored files (checksum and format)", permissions=["view"])
    def verify_versions(self, request, queryset):
        problems = 0
        for version in queryset.select_related("asset"):
            problem = services.verify_version(version)
            if problem:
                problems += 1
                self.message_user(request, f"{version.label}: {problem}", messages.ERROR)
        if problems == 0:
            self.message_user(request, "Every selected file is present and unchanged.")

    @admin.action(
        description="Validate in background (full model check, result for review)",
        permissions=["validate"],
    )
    def validate_in_background(self, request, queryset):
        """Submit each selected GLB version for `asset.validate_model`, or report its existing
        job for the same file. A failed, cancelled, refused or superseded job, a `fail`
        verdict, or a pass whose version is still a draft, is resubmitted as a new job (at most
        `LAI_ASSET_VALIDATION_MAX_ATTEMPTS` per file and processor version). Each new job is
        recorded in the version's admin history. The version is never changed here: the result
        appears in its "Background validation" section, and publishing stays a separate staff
        action. A new result never un-rejects a rejected version or changes a published one."""
        from apps.jobs.services import JobsDisabled, JobsError

        submitted = 0
        for version in self._first_batch(request, queryset):
            if version.asset.status != AssetStatus.ACTIVE:
                self.message_user(
                    request,
                    f"{version.label}: This asset is retired, so it is not validated.",
                    messages.ERROR,
                )
                continue
            if version.format not in ASYNC_FORMATS:
                self.message_user(
                    request,
                    f"{version.label}: Only GLB models can be validated in background.",
                    messages.ERROR,
                )
                continue
            previous = _latest_job(version)
            known = set(validation_jobs(version).values_list("pk", flat=True))
            try:
                job = submit_model_validation(version, user=request.user)
            except JobsDisabled:
                self.message_user(
                    request,
                    "Background jobs are turned off on this server, so nothing was validated.",
                    messages.ERROR,
                )
                return
            except JobsError as error:
                if error.code == "attempts_exhausted":
                    self.message_user(
                        request,
                        f"{version.label}: This file has reached the limit of background "
                        "validation attempts, so no new one was submitted. Delete this "
                        "unpublished version, then upload the file again, or ask an "
                        "administrator.",
                        messages.ERROR,
                    )
                    continue
                if error.code == "resource_limit_exceeded":
                    message = (
                        f"{version.label}: The file is larger than the {max_glb_bytes():,} byte "
                        "limit for GLB models, so it was not validated (resource_limit_exceeded)."
                    )
                else:
                    message = (
                        f"{version.label}: Background validation could not start ({error.code})."
                    )
                self.message_user(request, message, messages.ERROR)
                continue
            if job.pk not in known:
                submitted += 1
                self.log_change(request, version, f"Submitted background validation job {job.pk}.")
                reason = _resubmission_reason(previous, job, version)
                if reason:
                    self.message_user(request, f"{version.label}: {reason}", messages.INFO)
            elif job.is_terminal:
                self.message_user(
                    request,
                    f"{version.label}: The background validator already validated this file "
                    f"({_status_label(job)}). See its Background validation section.",
                    messages.INFO,
                )
            else:
                self.message_user(
                    request,
                    f"{version.label}: Background validation of this file is already queued or "
                    f"running ({_status_label(job)}).",
                    messages.INFO,
                )
        if submitted:
            self.message_user(
                request,
                f"Background validation submitted for {submitted} version(s). The versions are "
                "unchanged; results appear in each version's Background validation section.",
                messages.SUCCESS,
            )

    @admin.action(
        description="Inspect in background (file structure and dimensions)", permissions=["view"]
    )
    def inspect_in_background(self, request, queryset):
        """Read-only: the media worker reads each file and reports its metadata on a background
        job (Background jobs in this admin). Nothing on the version changes."""
        from apps.jobs.services import JobsError

        from . import jobs

        submitted = []
        for version in self._first_batch(request, queryset):
            try:
                job = jobs.submit_inspection(version, request.user)
            except JobsError as error:
                if error.code == "object_too_large":
                    self.message_user(
                        request,
                        f"{version.label}: The file is larger than the {max_glb_bytes():,} byte "
                        "limit for GLB models, so it was not inspected.",
                        messages.ERROR,
                    )
                    continue
                self.message_user(
                    request, f"Background jobs are unavailable ({error.code}).", messages.ERROR
                )
                return
            submitted.append(job)
        finished = sum(1 for job in submitted if job.is_terminal)
        self.message_user(
            request,
            f"Inspection submitted for {len(submitted)} version(s); {finished} already finished. "
            "Results are on the background jobs page.",
            messages.SUCCESS,
        )

    def _first_batch(self, request, queryset) -> list:
        """At most `BULK_LIMIT` of the selected versions; says so when more were selected."""
        batch = list(queryset.select_related("asset")[: BULK_LIMIT + 1])
        if len(batch) > BULK_LIMIT:
            self.message_user(
                request,
                f"More than {BULK_LIMIT} versions were selected: only the first {BULK_LIMIT} "
                "were processed. Run the action again for the rest.",
                messages.WARNING,
            )
        return batch[:BULK_LIMIT]

    # --- display ---

    @admin.display(description="Version", ordering="asset__asset_id")
    def version_label(self, obj) -> str:
        return obj.label

    @admin.display(description="Type", ordering="format")
    def family_label(self, obj) -> str:
        return {"model": "3D model", "image": "Image", "audio": "Audio"}[obj.family]

    @admin.display(description="File preview")
    def file_preview(self, obj):
        """A thumbnail, an audio player, or the 3D preview link, from our own trusted route."""
        return preview.file_preview_html(obj)  # the media route re-checks access on every fetch

    @admin.display(boolean=True, description="Default")
    def is_default(self, obj) -> bool:
        return obj.asset.default_version_id == obj.pk

    @admin.display(description="Preview")
    def preview_link(self, obj):
        return preview.link_for(obj)

    @admin.display(description="Validation findings")
    def findings(self, obj):
        if not obj.validation_report:
            return "No findings."
        report = [f for f in obj.validation_report if isinstance(f, dict)]
        processing = [f for f in report if f.get("source") == PROCESSING_SOURCE]
        if not processing:  # upload findings only: shown exactly as before
            return _finding_list(report)
        upload = [f for f in report if f.get("source") != PROCESSING_SOURCE]
        return format_html(
            "<p><strong>{}</strong></p>{}<p><strong>{}</strong></p>{}",
            "Upload checks",
            _finding_list(upload) if upload else "No findings.",
            "Background validation",
            _finding_list(processing),
        )

    @admin.display(description="Detected metadata")
    def metadata_summary(self, obj):
        return format_html("<pre>{}</pre>", json.dumps(obj.metadata, indent=2, sort_keys=True))

    # --- background validation (read only; every job value escaped) ---

    @admin.display(description="Processing status")
    def background_status(self, obj):
        job = _latest_job(obj)
        publishing = _publishing_notice(obj)
        if job is None:
            return format_html(
                "<p>{}</p><p>{}</p>",
                "No background validation has run for this version.",
                publishing,
            )
        rows = [
            ("Status", _status_label(job)),
            ("Outcome", _outcome_label(job)),
            ("Submitted", _when(job.created_at)),
            ("Started", _when(job.started_at)),
            ("Finished", _when(job.finished_at)),
            ("Worker attempts", job.attempts),
            ("Deliveries", job.deliveries),
            ("Error code", job.error_code or "-"),
        ]
        return format_html(
            '<p>{}</p><p>{}</p><dl>{}</dl><p><a href="{}">{}</a></p>',
            _status_notice(job, obj),
            publishing,
            format_html_join("", "<dt>{}</dt><dd>{}</dd>", rows),
            reverse("admin:jobs_processingjob_change", args=[job.pk]),
            "Open the background job (a stuck job can be marked failed there)",
        )

    @admin.display(description="Validation result")
    def background_result(self, obj):
        job = _latest_job(obj)
        summary = _summary(job)
        if summary is None:
            return "No result yet."
        verdict = {"pass": "Pass", "fail": "Fail"}.get(summary.get("verdict"), "Unknown")
        rows = [
            ("Verdict", verdict),
            ("Processor", _pair(summary.get("processor_id"), summary.get("processor_version"))),
            ("Profile", _pair(summary.get("profile_id"), summary.get("profile_version"))),
            ("Errors", _number(summary.get("error_count"))),
            ("Warnings", _number(summary.get("warning_count"))),
            ("Run warnings", ", ".join(map(str, _items(summary.get("run_warnings")))) or "None"),
        ]
        findings = processing_findings(job)
        table = _titled_table(
            "Findings",
            ("Code", "Severity", "Message", "Path"),
            ((f["code"], f["severity"], f["message"], f["path"]) for f in findings),
        )
        return format_html(
            "<dl>{}</dl>{}", format_html_join("", "<dt>{}</dt><dd>{}</dd>", rows), table
        )

    @admin.display(description="Model information")
    def background_model(self, obj):
        summary = _summary(_latest_job(obj))
        if summary is None:
            return "No result yet."
        return _model_information(summary)


#: The read-only "Background validation" section of the version change page.
BACKGROUND_FIELDS = ("background_status", "background_result", "background_model")
#: The only fields the change page edits (and the only ones its save writes).
EDITABLE_FIELDS = ("notes",)
#: Most versions one background action processes.
BULK_LIMIT = 50

_OUTCOME_LABELS = {
    "version_validated": "The version was marked validated.",
    "version_rejected": "The version was marked rejected.",
    "result_recorded": "The result was recorded; the version was not changed.",
    "processing_failed": "No result; the version was not changed.",
    "version_missing": "The version no longer exists.",
    "result_superseded": (
        "A newer validation of this version exists, so this result was recorded only."
    ),
}
_MISMATCH_OUTCOME = "The result does not match this version's file; the version was not changed."


def _latest_job(version):
    """The version's newest validation job, read once per page (never locked)."""
    if not hasattr(version, "_lai_validation_job"):
        version._lai_validation_job = validation_jobs(version).first()
    return version._lai_validation_job


def _outcome_is_mismatch(code: str) -> bool:
    return code.endswith("_mismatch") or code == "result_invalid"


def _summary(job) -> dict | None:
    """The result summary of a completed job, or None (no job, unfinished, failed)."""
    if job is None or job.status != "completed":
        return None
    return model_validation_summary(job)


def _status_label(job) -> str:
    if job.status == "pending":
        return "Queued"
    if job.status == "running":
        return "Processing"
    if job.status == "completed":
        return "Completed"
    if job.error_code == "timeout":
        return "Failed: timed out"
    if job.error_code == "submit_failed":
        return "Could not be sent"
    return "Failed"


def _outcome_label(job) -> str:
    code = job.subject_outcome
    if not code:
        return "None." if job.is_terminal else "Not applied to the version yet."
    if code in _OUTCOME_LABELS:
        return _OUTCOME_LABELS[code]
    if _outcome_is_mismatch(code):
        return _MISMATCH_OUTCOME
    return f"Recorded as {code}."


def _status_notice(job, version) -> str:
    """One explicit sentence for the job's state. Only a passing verdict for exactly this
    version's file is reported as passed."""
    again = "Run Validate in background again to retry."
    if job.status == "pending":
        if job.dispatched_at is None:
            return "Queued: not yet sent to the background validator. There is no result yet."
        return "Queued: waiting for the background validator. There is no result yet."
    if job.status == "running":
        return "Processing: the background validator is reading the file. No result yet."
    if job.status == "failed":
        if job.error_code == "timeout":
            return f"Background validation timed out, so there is no result. {again}"
        if job.error_code == "submit_failed":
            return (
                "The validation request could not be sent to the background validator, so "
                f"there is no result. {again}"
            )
        return f"Background validation failed, so there is no result. {again}"
    summary = _summary(job)
    if summary is None:
        return "No result is available."
    if _outcome_is_mismatch(job.subject_outcome) or identity_mismatch(job, version) is not None:
        return (
            "This result does not match this version's file, so it does not count for this "
            "version. Run Validate in background again."
        )
    if summary.get("verdict") == "pass":
        if identity_mismatch(job, version, require_current_processor=True) == (
            "processor_outdated"
        ):
            return (
                "This file passed with an older validator version. Publishing needs a new "
                "validation: run Validate in background again."
            )
        return "Passed: the background validator found no errors in this file."
    if summary.get("verdict") == "fail":
        return "Rejected: the background validator found errors in this file. See the findings."
    return "The result has no verdict."


def _resubmission_reason(previous, job, version) -> str:
    """Why a new validation job was made for `version` when `previous` (its newest job before the
    action) existed, in words chosen from the actual reason. Empty for a first validation."""
    if previous is None:
        return ""
    if previous.status == "failed":
        return "The earlier background validation failed, so a new one was submitted."
    if previous.status != "completed":
        return ""
    # A new job's result decides a draft's status; any other version keeps its status.
    tail = (
        ""
        if version.status == VersionStatus.DRAFT
        else " The version's status is not changed by it."
    )
    if previous.subject_outcome not in APPLIED_OUTCOMES:
        return (
            "The earlier background validation result was not applied to this version (it was "
            "refused or superseded), so a new one was submitted." + tail
        )
    if previous.idempotency_key != job.idempotency_key:
        return (
            "The validator version has changed since the earlier background validation, so a "
            "new one was submitted with the current validator." + tail
        )
    if (previous.result or {}).get("verdict") != "pass":
        return (
            "The earlier background validation did not pass this file, so a new one was "
            "submitted." + tail
        )
    return (
        "The earlier background validation passed, but this version is still a draft, so a new "
        "one was submitted to apply its result."
    )


def _publishing_notice(version) -> str:
    """One sentence: may this version be published now? From the publication gate itself
    (`services.publish_refusal`); the stored file is still re-verified when publishing."""
    if version.status == VersionStatus.PUBLISHED:
        return "Publishing: this version is published."
    refusal = services.publish_refusal(version)
    if refusal is None:
        return "Publishing: allowed now. The stored file is checked again when it is published."
    return f"Publishing: not allowed now ({refusal.code}). {refusal.message}"


def _when(value) -> str:
    return localtime(value).strftime("%Y-%m-%d %H:%M:%S %Z") if value else "-"


def _pair(name, version) -> str:
    return f"{name} {version}" if name else "-"


def _items(value) -> list:
    return value if isinstance(value, list) else []


def _number(value) -> str:
    return str(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else "-"


def _vector(value) -> str:
    return "(" + ", ".join(_number(v) for v in _items(value)) + ")"


def _finding_list(findings):
    return format_html(
        "<ul>{}</ul>",
        format_html_join(
            "",
            "<li><strong>{}</strong> {}: {} <code>{}</code></li>",
            (
                (f.get("severity", ""), f.get("code", ""), f.get("message", ""), f.get("path", ""))
                for f in findings
            ),
        ),
    )


def _model_information(summary: dict):
    counts = summary.get("counts") if isinstance(summary.get("counts"), dict) else {}
    bounds = summary.get("bounds") if isinstance(summary.get("bounds"), dict) else None
    images = [i for i in _items(summary.get("images")) if isinstance(i, dict)]
    skins = [s for s in _items(summary.get("skins")) if isinstance(s, dict)]
    clips = [a for a in _items(summary.get("animations")) if isinstance(a, dict)]
    rows = [
        ("Meshes", _number(counts.get("meshes"))),
        ("Primitives", _number(counts.get("primitives"))),
        ("Triangles", _number(summary.get("triangle_count"))),
        ("Vertices", _number(summary.get("vertex_count"))),
        (
            "Bounds",
            f"min {_vector(bounds.get('min'))}, max {_vector(bounds.get('max'))}"
            if bounds
            else "-",
        ),
        ("Generator", summary.get("generator") or "-"),
        ("Extensions used", ", ".join(map(str, _items(summary.get("extensions_used")))) or "None"),
        (
            "Extensions required",
            ", ".join(map(str, _items(summary.get("extensions_required")))) or "None",
        ),
        (
            "Unsupported extensions",
            ", ".join(map(str, _items(summary.get("unsupported_extensions")))) or "None",
        ),
    ]
    if summary.get("lists_truncated"):
        rows.append(("Lists", "Shortened by the validator to fit its size limit."))
    materials = [str(name) for name in _items(summary.get("material_names"))]
    parts = [
        format_html("<dl>{}</dl>", format_html_join("", "<dt>{}</dt><dd>{}</dd>", rows)),
        _titled_list("Materials", materials),
        _titled_table(
            "Textures",
            ("Index", "Type", "Size (pixels)"),
            (
                (
                    _number(i.get("index")),
                    i.get("mime_type") or "unknown",
                    f"{_number(i.get('width'))} x {_number(i.get('height'))}",
                )
                for i in images
            ),
        ),
        _titled_table(
            "Skins",
            ("Name", "Joints"),
            ((s.get("name") or "-", _number(s.get("joint_count"))) for s in skins),
        ),
        _titled_table(
            "Animation clips",
            ("Name (exact)", "Duration (seconds)"),
            ((_clip_name(a.get("name")), _number(a.get("duration_seconds"))) for a in clips),
        ),
    ]
    return format_html_join("", "{}", ((part,) for part in parts))


def _clip_name(name):
    """A clip name exactly as stored: in `<code>` with `white-space: pre`, so outer spaces show,
    and an empty or missing name said explicitly. Always escaped."""
    if name is None:
        return format_html("<em>{}</em>", "(no name)")
    if name == "":
        return format_html("<em>{}</em>", "(empty name)")
    return format_html('<code style="white-space: pre">{}</code>', str(name))


def _titled_list(title: str, items: list[str]):
    if not items:
        return format_html("<p><strong>{}</strong>: {}</p>", title, "None")
    return format_html(
        "<p><strong>{}</strong></p><ul>{}</ul>",
        title,
        format_html_join("", "<li>{}</li>", ((item,) for item in items)),
    )


def _titled_table(title: str, headings, rows):
    rows = list(rows)
    if not rows:
        return format_html("<p><strong>{}</strong>: {}</p>", title, "None")
    head = format_html_join("", "<th>{}</th>", ((h,) for h in headings))
    cells = "".join("<td>{}</td>" for _ in headings)
    return format_html(
        "<p><strong>{}</strong></p><table><tr>{}</tr>{}</table>",
        title,
        head,
        format_html_join("", f"<tr>{cells}</tr>", rows),
    )


def _verified_response(version) -> FileResponse | JsonResponse:
    """Stream a stored file after proving it still matches its recorded checksum.

    Checksum the stream in chunks, then rewind and stream the same handle: memory stays at one
    chunk whatever the file size, and the bytes sent are the bytes that were verified (every
    backend's `open` is seekable; S3 spools the object to a local temporary file).
    """
    try:
        stream = get_storage().open(version.storage_key)
    except StorageError:
        return _preview_unavailable(version)
    try:
        sha256, size = sha256_of(stream)
    except OSError:
        stream.close()
        return _preview_unavailable(version)
    if size != version.size_bytes or sha256 != version.sha256:
        stream.close()
        logger.warning(
            "asset preview checksum mismatch: %s v%s", version.asset.asset_id, version.number
        )
        return _preview_error(
            "checksum_mismatch",
            "The stored file does not match its recorded checksum, so it is not shown.",
            409,
        )
    response = FileResponse(stream, content_type=version.content_type)
    response["Content-Length"] = str(version.size_bytes)
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    response["Content-Disposition"] = f'inline; filename="{version.file_name}"'
    return response


def _preview_error(code: str, message: str, status: int) -> JsonResponse:
    return JsonResponse(error_body(code, message), status=status)


def _preview_unavailable(version) -> JsonResponse:
    logger.warning("asset preview unavailable: %s v%s", version.asset.asset_id, version.number)
    return _preview_error(
        "content_unavailable", "The stored file could not be read. Try again later.", 503
    )


def done_message(done: str, version) -> str:
    """The text recorded in the admin history for a lifecycle action."""
    return f"{done} {version.label} ({version.get_status_display()})."


from . import admin_artifacts  # noqa: E402,F401 - registers the derived artifact admin
