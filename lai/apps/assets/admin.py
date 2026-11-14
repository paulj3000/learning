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
Every lifecycle action is recorded in Django Admin's history (`LogEntry`) with who and what.

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
from django.views.decorators.cache import never_cache

from apps.catalog.models import AssetStatus, ContentAsset
from apps.core.exceptions import error_body

from . import collision, preview, services
from .models import AssetVersion, CollisionProfile, VersionStatus
from .storage import StorageError, get_storage, sha256_of
from .validation import largest_upload_bytes, max_bytes_for

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
class AssetVersionAdmin(admin.ModelAdmin):
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

    def get_readonly_fields(self, request, obj=None):
        return [name for name in self.fields if name != "notes"]

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
                    self.message_user(
                        request,
                        f"Uploaded {version.asset.asset_id} version {version.number}. It is "
                        "validated and not yet published.",
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
                # The boxes the game would use for this version (`collision.py`), drawn over it.
                collision_json=json.dumps(
                    collision.runtime_collision(
                        collision.profile_for(version.asset, version), version
                    )
                ),
                collision_url=reverse("admin:assets_collisionprofile_changelist")
                + f"?asset__id__exact={version.asset_id}",
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
        return format_html(
            "<ul>{}</ul>",
            format_html_join(
                "",
                "<li><strong>{}</strong> {}: {} <code>{}</code></li>",
                (
                    (f["severity"], f["code"], f["message"], f.get("path", ""))
                    for f in obj.validation_report
                ),
            ),
        )

    @admin.display(description="Detected metadata")
    def metadata_summary(self, obj):
        return format_html("<pre>{}</pre>", json.dumps(obj.metadata, indent=2, sort_keys=True))


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


# --- collision profiles (`docs/ASSET_COLLISION_PROFILES.md`) ------------------------------------


class CollisionProfileForm(forms.ModelForm):
    class Meta:
        model = CollisionProfile
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if "version" in self.fields:
            self.fields["version"].queryset = AssetVersion.objects.filter(
                status__in=[VersionStatus.VALIDATED, VersionStatus.PUBLISHED]
            ).select_related("asset")

    def clean(self):
        cleaned = super().clean()
        if self.errors:
            return cleaned
        candidate = self.instance
        for name, value in cleaned.items():
            setattr(candidate, name, value)
        collision.clean_profile(candidate)
        return cleaned


@admin.register(CollisionProfile)
class CollisionProfileAdmin(admin.ModelAdmin):
    """Staff configure how an asset blocks movement wherever it is placed. Changes reach children
    on their next visit, through the asset resolver; no release or rebuild is needed."""

    form = CollisionProfileForm
    list_display = ("asset", "scope", "shape", "behavior", "box_count", "updated_at")
    list_filter = ("shape", "behavior", "asset__category")
    search_fields = ("asset__asset_id", "asset__display_name", "notes")
    list_select_related = ("asset", "version", "asset__default_version")
    autocomplete_fields = ("asset",)
    readonly_fields = ("measured_bounds", "runtime_preview", "preview_links", "updated_by", "updated_at")
    fieldsets = (
        (None, {"fields": ("asset", "version", "shape", "behavior", "axis")}),
        (
            "Size and offset (empty: from the model's measured bounds)",
            {"fields": (("width", "height", "depth"), "radius", ("offset_x", "offset_y", "offset_z"))},
        ),
        ("Compound boxes", {"fields": ("boxes",)}),
        (
            "What the game uses",
            {"fields": ("measured_bounds", "runtime_preview", "preview_links")},
        ),
        (None, {"fields": ("notes", "updated_by", "updated_at")}),
    )

    def _perm(self, request, codename: str) -> bool:
        return request.user.has_perm(f"assets.{codename}_collisionprofile")

    def has_view_permission(self, request, obj=None):
        return self._perm(request, "view") or self._perm(request, "change")

    def has_add_permission(self, request):
        return self._perm(request, "add")

    def has_change_permission(self, request, obj=None):
        return self._perm(request, "change")

    def has_delete_permission(self, request, obj=None):
        return self._perm(request, "delete")

    def save_model(self, request, obj, form, change):
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)
        logger.info("collision profile saved: %s", obj)

    def _version(self, obj):
        if obj is None or obj.pk is None and not obj.asset_id:
            return None
        return obj.version if obj.version_id else obj.asset.default_version

    @admin.display(description="Scope")
    def scope(self, obj):
        return f"v{obj.version.number} only" if obj.version_id else "Asset default"

    @admin.display(description="Boxes")
    def box_count(self, obj):
        result = collision.runtime_collision(obj, self._version(obj))
        return "defaults" if result is None else len(result["boxes"])

    @admin.display(description="Measured bounds")
    def measured_bounds(self, obj):
        bounds = collision.version_bounds(self._version(obj))
        if bounds is None:
            return "Not measured: publish a validated version, or enter the sizes by hand."
        low = ", ".join(f"{v:.2f}" for v in bounds.low)
        high = ", ".join(f"{v:.2f}" for v in bounds.high)
        size = " x ".join(f"{v:.2f}" for v in bounds.size)
        return f"min ({low}) max ({high}); {size} m ({bounds.source})"

    @admin.display(description="Runtime collision")
    def runtime_preview(self, obj):
        if obj is None or obj.pk is None:
            return "Saved profiles show the boxes the game receives here."
        result = collision.runtime_collision(obj, self._version(obj))
        if result is None:
            return "Cannot be sized yet: the game keeps its built-in default for this asset."
        if not result["boxes"]:
            return f"{result['behavior'].title()}: no collider (never blocks)."
        return format_html(
            "<p>{} {} box(es), model space, metres:</p><pre>{}</pre>",
            result["behavior"].title(),
            len(result["boxes"]),
            json.dumps(result["boxes"], indent=1),
        )

    @admin.display(description="Preview")
    def preview_links(self, obj):
        version = self._version(obj)
        if version is None or version.family != "model":
            return "No model version to preview."
        return preview.link_for(version)
