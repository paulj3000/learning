"""Staff browser GLB thumbnail capture in Django Admin (ADR-069, GLB_THUMBNAIL_CAPTURE.md).

A mixin for `AssetVersionAdmin`. Three staff-only routes, all under one validated GLB version:

- `<id>/capture/` the page that loads the model in the isolated capture bundle (GET)
- `<id>/capture/upload/` the endpoint the bundle posts the image to (POST, CSRF protected)
- `<id>/capture/review/` accept or reject a capture (POST, CSRF protected)

Who and when: staff who can preview the version (`apps.assets.preview.can_preview`) and hold
`assets.capture_derivedartifact`, with `LAI_THUMBNAIL_CAPTURE` on, for a GLB in a previewable
state. Review also needs `assets.review_derivedartifact`; seeing captures needs
`assets.view_derivedartifact`.

The server never trusts the browser's claim that the image shows this model. It binds the image
to the exact version id and SHA-256 the page was issued for, refuses a stale or mismatched pair,
sniffs and measures the bytes itself, and stores through `artifacts.record_staff_capture`, which
writes a private `pending_review` artifact. Nothing is published, and the GLB is never touched.
"""

import hmac
import logging

from django.contrib import messages
from django.core.exceptions import PermissionDenied
from django.http import HttpResponseRedirect, JsonResponse
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect

from apps.core.exceptions import error_body

from . import artifacts, preview
from .artifacts import ArtifactRefused
from .capture_image import BadCapture, check_dimensions, read_facts
from .models import ArtifactProducer, ArtifactState, AssetVersion, DerivedArtifact
from .validation import max_bytes_for

logger = logging.getLogger("lai.assets")

ROLE = "model.thumbnail"
CAPTURE_FIELDS = ("capture_link", "capture_thumbnail")
#: Slack for the multipart envelope around the image when the body size is checked up front.
ENVELOPE_BYTES = 16 * 1024
_CURRENT_STATES = (ArtifactState.PENDING_REVIEW, ArtifactState.ACCEPTED)
_HISTORY_STATES = (*_CURRENT_STATES, ArtifactState.REJECTED)

_STATUS = {
    "permission_denied": 403,
    "capture_disabled": 403,
    "role_not_allowed": 400,
    "size": 413,
    "bad_image": 415,
    "source_unavailable": 409,
    "storage_failed": 503,
    "wrong_state": 409,
}


def capture_enabled() -> bool:
    from apps.jobs.workloads import thumbnail_capture_enabled

    return thumbnail_capture_enabled()


def can_capture(user) -> bool:
    return bool(preview.can_preview(user) and user.has_perm("assets.capture_derivedartifact"))


def capture_blocker(version: AssetVersion) -> str | None:
    """Why this version cannot be captured at all (a safe message), or None."""
    if version.family != "model" or version.format != "glb":
        return "Only a GLB model can have a thumbnail captured."
    refusal = preview.refusal_for(version)
    return refusal.message if refusal is not None else None


def captures_of(version: AssetVersion, states=_HISTORY_STATES, limit: int = 8):
    return list(
        DerivedArtifact.objects.filter(
            source_version=version,
            role=ROLE,
            producer=ArtifactProducer.STAFF_CAPTURE,
            state__in=states,
        ).order_by("-created_at")[:limit]
    )


def _error(code: str, message: str, status: int) -> JsonResponse:
    return JsonResponse(error_body(code, message), status=status)


class CaptureAdminMixin:
    """Adds the capture routes, the change page section and the list thumbnail."""

    # --- urls ---

    def capture_urls(self):
        page = self.admin_site.admin_view(self.capture_view)
        upload = csrf_protect(never_cache(self.capture_upload_view))  # JSON errors, no redirect
        review = self.admin_site.admin_view(
            self.capture_review_view
        )  # admin_view adds csrf_protect
        return [
            path("<int:object_id>/capture/", page, name="assets_assetversion_capture"),
            path(
                "<int:object_id>/capture/upload/",
                upload,
                name="assets_assetversion_capture_upload",
            ),
            path(
                "<int:object_id>/capture/review/",
                review,
                name="assets_assetversion_capture_review",
            ),
        ]

    # --- the page ---

    def capture_view(self, request, object_id):
        if request.method != "GET":
            return _error("method_not_allowed", "Use GET.", 405)
        if not can_capture(request.user):
            raise PermissionDenied
        version = (
            AssetVersion.objects.select_related("asset", "asset__default_version")
            .filter(pk=object_id)
            .first()
        )
        if version is None:
            return self._get_obj_does_not_exist_redirect(request, self.model._meta, str(object_id))
        refusal = None
        if not capture_enabled():
            refusal = "Thumbnail capture is switched off."
        else:
            refusal = capture_blocker(version)
        can_review = request.user.has_perm("assets.review_derivedartifact")
        can_view = request.user.has_perm("assets.view_derivedartifact")
        context = {
            **self.admin_site.each_context(request),
            "opts": self.model._meta,
            "title": f"Capture thumbnail for {version.label}",
            "version": version,
            "refusal": refusal,
            "summary": preview.summary(version),
            "change_url": reverse("admin:assets_assetversion_change", args=[version.pk]),
            "preview_url": reverse("admin:assets_assetversion_preview", args=[version.pk]),
            "can_review": can_review,
            "captures": self._capture_rows(version) if can_view else [],
            "review_url": reverse("admin:assets_assetversion_capture_review", args=[version.pk]),
        }
        if refusal is None:
            token = preview.issue_token(version, request.user)
            context.update(
                preview_token=token.value,
                preview_file_url=reverse(
                    "admin:assets_assetversion_preview_file", args=[version.pk]
                ),
                preview_token_header=preview.TOKEN_HEADER,
                max_bytes=max_bytes_for(version.family),
                capture_url=reverse("admin:assets_assetversion_capture_upload", args=[version.pk]),
            )
        return TemplateResponse(request, "admin/assets/assetversion/capture.html", context)

    def _capture_rows(self, version):
        rows = []
        for artifact in captures_of(version):
            rows.append(
                {
                    "id": artifact.pk,
                    "short_id": str(artifact.pk)[:8],
                    "state": artifact.get_state_display(),
                    "raw_state": artifact.state,
                    "when": artifact.created_at,
                    "size": artifact.size_bytes,
                    "type": artifact.content_type,
                    "media_url": reverse("admin:assets_derivedartifact_media", args=[artifact.pk]),
                    "detail_url": reverse(
                        "admin:assets_derivedartifact_change", args=[artifact.pk]
                    ),
                }
            )
        return rows

    # --- the upload endpoint ---

    def capture_upload_view(self, request, object_id):
        if request.method != "POST":
            return _error("method_not_allowed", "Use POST.", 405)
        user = request.user
        if not user.is_authenticated or not can_capture(user):
            return _error("forbidden", "You do not have permission to capture thumbnails.", 403)
        if not capture_enabled():
            return _error("capture_disabled", "Thumbnail capture is switched off.", 403)
        limit = self._byte_limit()
        declared = request.META.get("CONTENT_LENGTH") or ""
        if declared.isdigit() and int(declared) > limit + ENVELOPE_BYTES:
            return _error("size", "The capture is too large.", 413)
        version = AssetVersion.objects.select_related("asset").filter(pk=object_id).first()
        if version is None:
            return _error("not_found", "Not found.", 404)
        blocker = capture_blocker(version)
        if blocker is not None:
            return _error("source_unavailable", blocker, 409)
        sent_id = request.POST.get("version_id", "")
        sent_sha = request.POST.get("source_sha256", "")
        if sent_id != str(version.pk) or not hmac.compare_digest(
            sent_sha.lower().encode(), version.sha256.lower().encode()
        ):
            return _error(
                "stale_version",
                "The model changed or does not match this page. Reload the page and capture again.",
                409,
            )
        upload = request.FILES.get("image")
        if upload is None:
            return _error("bad_image", "No image was sent.", 400)
        if upload.size > limit:
            return _error("size", "The capture is too large.", 413)
        data = upload.read(limit + 1)
        if len(data) > limit:
            return _error("size", "The capture is too large.", 413)
        try:
            facts = read_facts(data)
            check_dimensions(facts)
        except BadCapture as bad:
            return _error(bad.code, bad.message, 415 if bad.code == "bad_image" else 422)
        try:
            artifact = artifacts.record_staff_capture(version, user, data, facts.content_type)
        except ArtifactRefused as refused:
            return _error(refused.code, refused.message, _STATUS.get(refused.code, 400))
        self.log_change(request, version, f"Captured thumbnail {artifact.pk}.")
        logger.info("thumbnail captured version=%s artifact=%s", version.pk, artifact.pk)
        return JsonResponse(
            {
                "artifact_id": str(artifact.pk),
                "state": artifact.state,
                "content_type": artifact.content_type,
                "size_bytes": artifact.size_bytes,
                "width": facts.width,
                "height": facts.height,
            },
            status=201,
        )

    @staticmethod
    def _byte_limit() -> int:
        from lai_processing.contracts.job_types import role_spec

        return role_spec(ROLE).max_size_bytes

    # --- review (accept or reject through the artifact services) ---

    def capture_review_view(self, request, object_id):
        if request.method != "POST":
            raise PermissionDenied
        if not request.user.has_perm("assets.review_derivedartifact"):
            raise PermissionDenied
        version = AssetVersion.objects.filter(pk=object_id).first()
        back = HttpResponseRedirect(reverse("admin:assets_assetversion_capture", args=[object_id]))
        if version is None:
            return back
        raw = request.POST.get("artifact", "")
        artifact = (
            DerivedArtifact.objects.filter(
                pk=raw,
                source_version=version,
                role=ROLE,
                producer=ArtifactProducer.STAFF_CAPTURE,
            ).first()
            if _is_uuid(raw)
            else None
        )
        action = request.POST.get("action")
        if artifact is None or action not in ("accept", "reject"):
            self.message_user(request, "That capture was not found.", messages.ERROR)
            return back
        try:
            if action == "accept":
                artifacts.accept_artifact(artifact, request.user)
                done = "Accepted"
            else:
                artifacts.reject_artifact(artifact, request.user)
                done = "Rejected"
        except ArtifactRefused as refused:
            self.message_user(request, refused.message, messages.ERROR)
        else:
            self.log_change(request, version, f"{done} thumbnail capture {artifact.pk}.")
            self.message_user(request, f"{done} the capture.", messages.SUCCESS)
        return back

    # --- change page and list ---

    def capture_fieldset(self, request, obj, fieldsets):
        """The change page's "Thumbnail capture" section, for staff who may see or take one."""
        if obj.format == "glb" and (
            request.user.has_perm("assets.view_derivedartifact") or can_capture(request.user)
        ):
            return [*fieldsets, ("Thumbnail capture", {"fields": CAPTURE_FIELDS})]
        return fieldsets

    def capture_list_display(self, request, columns):
        if request.user.has_perm("assets.view_derivedartifact"):
            return (*columns, "capture_thumb")
        return columns

    @staticmethod
    def _current(version: AssetVersion) -> DerivedArtifact | None:
        found = captures_of(version, _CURRENT_STATES, limit=1)
        return found[0] if found else None

    def _thumb_html(self, artifact, size: int):
        media = reverse("admin:assets_derivedartifact_media", args=[artifact.pk])
        return format_html(
            '<img src="{}" alt="Captured thumbnail" width="{}" height="{}" loading="lazy" '
            'style="background:#eef1f4;object-fit:contain">',
            media,
            size,
            size,
        )

    def capture_thumb(self, obj):
        if obj.format != "glb":
            return "-"
        current = self._current(obj)
        return self._thumb_html(current, 48) if current else "None"

    capture_thumb.short_description = "Thumbnail"

    def capture_thumbnail(self, obj):
        if obj.format != "glb":
            return "Only GLB models have a captured thumbnail."
        current = self._current(obj)
        if current is None:
            return "No capture yet. Captures are staff-only and never published automatically."
        detail = reverse("admin:assets_derivedartifact_change", args=[current.pk])
        return format_html(
            '{}<br>{} capture, {} bytes. <a href="{}">Artifact details</a>',
            self._thumb_html(current, 160),
            current.get_state_display(),
            f"{current.size_bytes:,}",
            detail,
        )

    capture_thumbnail.short_description = "Captured thumbnail"

    def capture_link(self, obj):
        if obj.format != "glb":
            return "-"
        blocker = capture_blocker(obj)
        if blocker is not None:
            return blocker
        if not capture_enabled():
            return "Thumbnail capture is switched off."
        url = reverse("admin:assets_assetversion_capture", args=[obj.pk])
        return format_html('<a href="{}">Capture thumbnail for v{}</a>', url, obj.number)

    capture_link.short_description = "Thumbnail capture"


def _is_uuid(value: str) -> bool:
    import uuid

    try:
        uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return True
