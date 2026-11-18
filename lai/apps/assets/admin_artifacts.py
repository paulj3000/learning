"""Derived artifacts in Django Admin (ADR-066, DERIVED_ARTIFACTS.md section 9). Staff only.

Every field is read only: rows are written by the results consumer and staff capture, and change
only through the actions here, which call `apps.assets.artifacts` and `artifact_promotion`.

- view, list, filter, preview and download: `assets.view_derivedartifact`
- accept, reject, hold, release hold: `assets.review_derivedartifact`
- promote into a new unpublished version: `assets.promote_derivedartifact` (separate from the
  publish permission; promoting never publishes)
- there is no add, change or delete permission in the UI

Previews are streamed through Django (`admin:assets_derivedartifact_media`): GET only, staff
session plus the view permission, checksum re-verified before the first byte, `nosniff`, a CSP
that forbids scripts and framing, never cached. Only image and audio types are shown inline; all
else is an attachment. Every value rendered from the database is escaped. No public API exists.
"""

import json
import logging

from django.contrib import admin, messages
from django.http import FileResponse, JsonResponse
from django.urls import path, reverse
from django.utils.html import format_html, format_html_join
from django.views.decorators.cache import never_cache

from apps.core.exceptions import error_body

from . import artifacts
from .artifact_promotion import promote_artifact
from .artifacts import ArtifactRefused
from .models import DerivedArtifact
from .services import AssetActionRefused

logger = logging.getLogger("lai.assets")

_STATUS = {
    "permission_denied": 403,
    "gone": 404,
    "object_missing": 404,
    "artifact_changed": 409,
    "storage_failed": 503,
}


@admin.register(DerivedArtifact)
class DerivedArtifactAdmin(admin.ModelAdmin):
    list_display = (
        "short_id",
        "role",
        "logical_id",
        "source",
        "state",
        "content_type",
        "size_bytes",
        "processor_id",
        "profile_label",
        "created_at",
        "expires_at",
        "retention_hold",
    )
    list_filter = (
        "state",
        "role",
        "producer",
        "processor_id",
        "profile_id",
        "content_type",
        "retention_hold",
    )
    search_fields = ("asset__asset_id", "sha256", "logical_id")
    date_hierarchy = "created_at"
    list_select_related = ("asset", "source_version")
    actions = [
        "accept_selected",
        "reject_selected",
        "hold_selected",
        "release_selected",
        "promote_selected",
    ]
    ordering = ("-created_at",)

    fieldsets = (
        (
            "Artifact",
            {
                "fields": (
                    "preview",
                    "role",
                    "logical_id",
                    "state",
                    "content_type",
                    "size_bytes",
                    "sha256",
                    "stored_at",
                )
            },
        ),
        (
            "Source",
            {
                "fields": (
                    "asset",
                    "source_version",
                    "source_sha256",
                    "producer",
                    "captured_by",
                    "job_ref",
                )
            },
        ),
        (
            "Processor",
            {
                "fields": (
                    "processor_id",
                    "processor_version",
                    "profile_id",
                    "profile_version",
                    "optimization_view",
                    "metadata_view",
                )
            },
        ),
        (
            "Review and retention",
            {
                "fields": (
                    "reviewed_by",
                    "reviewed_at",
                    "superseded_by",
                    "superseded_at",
                    "expires_at",
                    "retention_hold",
                    "object_deleted_at",
                )
            },
        ),
        ("Promotion", {"fields": ("promoted_version", "promoted_by", "promoted_at")}),
    )

    # --- permissions: view the list, act through actions, never add, change or delete ---

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_review_permission(self, request):
        return request.user.has_perm("assets.review_derivedartifact")

    def has_promote_permission(self, request):
        return request.user.has_perm("assets.promote_derivedartifact")

    def get_readonly_fields(self, request, obj=None):
        names = [f for _title, spec in self.fieldsets for f in spec["fields"]]
        return names

    # --- columns (every value escaped by format_html) ---

    @admin.display(description="ID")
    def short_id(self, obj):
        return str(obj.pk)[:8]

    @admin.display(description="Source")
    def source(self, obj):
        return f"{obj.asset.asset_id}@{obj.source_version.number}"

    @admin.display(description="Profile")
    def profile_label(self, obj):
        return f"{obj.profile_id}/{obj.profile_version}" if obj.profile_id else "-"

    @admin.display(description="Stored object")
    def stored_at(self, obj):
        return format_html("<code>{}</code>", obj.storage_key)

    @admin.display(description="Job")
    def job_ref(self, obj):
        if obj.job_id_text is None:
            return "Staff capture" if obj.producer == "staff_capture" else "-"
        text = f"{obj.job_id_text} (attempt {obj.attempt_id})"
        if obj.job_id:
            url = reverse("admin:jobs_processingjob_change", args=[obj.job_id])
            return format_html('<a href="{}">{}</a>', url, text)
        return text

    @admin.display(description="Optimization report")
    def optimization_view(self, obj):
        from .optimize import facts_rows

        rows = facts_rows(obj)
        if not rows:
            return "-"
        return format_html(
            "<table>{}</table>",
            format_html_join("", "<tr><th>{}</th><td>{}</td></tr>", rows),
        )

    @admin.display(description="Facts")
    def metadata_view(self, obj):
        return format_html("<pre>{}</pre>", json.dumps(obj.metadata, indent=2, sort_keys=True))

    @admin.display(description="Preview")
    def preview(self, obj):
        if obj.state in ("expired", "deleted"):
            return "This artifact has been removed."
        media = reverse("admin:assets_derivedartifact_media", args=[obj.pk])
        if obj.content_type.startswith("image/"):
            return format_html(
                '<img src="{}" alt="Derived artifact preview" '
                'style="max-width:480px;max-height:360px">',
                media,
            )
        if obj.content_type.startswith("audio/"):
            return format_html('<audio controls preload="none" src="{}"></audio>', media)
        return format_html('<a href="{}">Download</a>', media)

    # --- the streamed media route ---

    def get_urls(self):
        media = never_cache(
            self.media_view
        )  # fetched by <img> and <audio>: JSON errors, no login redirect
        return [
            path("<uuid:object_id>/media/", media, name="assets_derivedartifact_media"),
            *super().get_urls(),
        ]

    def media_view(self, request, object_id):
        if request.method != "GET":
            return _error("method_not_allowed", "Use GET.", 405)
        if not request.user.is_authenticated or not self.has_view_permission(request):
            return _error("forbidden", "You do not have access to this file.", 403)
        artifact = DerivedArtifact.objects.filter(pk=object_id).first()
        if artifact is None:
            return _error("not_found", "Not found.", 404)
        try:
            stream = artifacts.open_for_view(artifact, request.user)
        except ArtifactRefused as refused:
            return _error(refused.code, refused.message, _STATUS.get(refused.code, 404))
        inline = artifacts.is_inline(artifact)
        response = FileResponse(
            stream, content_type=artifact.content_type if inline else "application/octet-stream"
        )
        response["Content-Length"] = str(artifact.size_bytes)
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        response["Cache-Control"] = "private, no-store"
        disposition = "inline" if inline else "attachment"
        response["Content-Disposition"] = f'{disposition}; filename="{artifact.pk}"'
        return response

    # --- actions (each success is written to the admin history) ---

    def _each(self, request, queryset, action, done):
        succeeded = 0
        for artifact in queryset.select_related("asset", "source_version"):
            try:
                action(artifact)
            except (ArtifactRefused, AssetActionRefused) as refused:
                self.message_user(
                    request, f"{str(artifact.pk)[:8]}: {refused.message}", messages.ERROR
                )
            else:
                succeeded += 1
                self.log_change(request, artifact, f"{done} derived artifact {artifact.pk}.")
        if succeeded:
            self.message_user(request, f"{done}: {succeeded}.", messages.SUCCESS)

    @admin.action(description="Accept selected artifacts", permissions=["review"])
    def accept_selected(self, request, queryset):
        self._each(
            request, queryset, lambda a: artifacts.accept_artifact(a, request.user), "Accepted"
        )

    @admin.action(description="Reject selected artifacts", permissions=["review"])
    def reject_selected(self, request, queryset):
        self._each(
            request, queryset, lambda a: artifacts.reject_artifact(a, request.user), "Rejected"
        )

    @admin.action(description="Hold selected artifacts (never expire)", permissions=["review"])
    def hold_selected(self, request, queryset):
        self._each(
            request, queryset, lambda a: artifacts.set_hold(a, request.user, hold=True), "Held"
        )

    @admin.action(description="Release the hold on selected artifacts", permissions=["review"])
    def release_selected(self, request, queryset):
        self._each(
            request, queryset, lambda a: artifacts.set_hold(a, request.user, hold=False), "Released"
        )

    @admin.action(description="Promote to a new unpublished version", permissions=["promote"])
    def promote_selected(self, request, queryset):
        def run(artifact):
            promote_artifact(artifact, request.user)

        self._each(request, queryset, run, "Promoted")


def _error(code: str, message: str, status: int) -> JsonResponse:
    return JsonResponse(error_body(code, message), status=status)
