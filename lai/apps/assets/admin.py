"""Asset versions in Django Admin (LAI-2200 AM-5, ADR-035).

Every action is a Django permission (grant them with the groups from `ensure_asset_roles`):

- view: `assets.view_assetversion`
- upload (the add page is an upload form): `assets.add_assetversion`
- edit admin notes: `assets.change_assetversion`
- publish and make default: `assets.publish_assetversion`
- retire: `assets.retire_assetversion`
- delete a never-published version and its file: `assets.delete_assetversion`
- preview a model in 3D (AM-10, read-only): staff with view access (`apps.assets.preview`)

The binary fields are read-only for everyone, always; a published version is never deletable.
All state changes go through `apps.assets.services`.
"""

import hashlib
import json
import logging

from django import forms
from django.contrib import admin, messages
from django.core.exceptions import PermissionDenied
from django.http import HttpResponse, JsonResponse
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html, format_html_join
from django.views.decorators.cache import never_cache

from apps.catalog.models import AssetStatus, ContentAsset
from apps.core.exceptions import error_body

from . import preview, services
from .models import AssetVersion
from .storage import StorageError, get_storage
from .validation import max_upload_bytes

logger = logging.getLogger("lai.assets")


class UploadForm(forms.Form):
    asset = forms.ModelChoiceField(
        queryset=ContentAsset.objects.filter(status=AssetStatus.ACTIVE).order_by("asset_id"),
        help_text="The asset this file is a new version of. Create the asset first if needed.",
    )
    model_file = forms.FileField(
        label="Model file",
        help_text="A glTF 2.0 model: .glb, or a .gltf with every buffer and texture embedded.",
    )
    notes = forms.CharField(
        max_length=500, required=False, widget=forms.Textarea(attrs={"rows": 2})
    )

    def clean_model_file(self):
        upload = self.cleaned_data["model_file"]
        if upload.size > max_upload_bytes():
            raise forms.ValidationError(
                f"The file is {upload.size:,} bytes; the limit is {max_upload_bytes():,} bytes."
            )
        return upload


@admin.register(AssetVersion)
class AssetVersionAdmin(admin.ModelAdmin):
    list_display = (
        "version_label",
        "status",
        "is_default",
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
    actions = ["publish_versions", "make_default", "retire_versions"]
    fields = (
        "asset",
        "preview_link",
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
        return [
            path("upload/", upload, name="assets_assetversion_upload"),
            path("<int:object_id>/preview/", preview_page, name="assets_assetversion_preview"),
            path(
                "<int:object_id>/preview/model/",
                preview_file,
                name="assets_assetversion_preview_file",
            ),
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
                upload = form.cleaned_data["model_file"]
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
            "title": "Upload a model version",
            "form": form,
            "findings": findings,
            "max_upload_bytes": max_upload_bytes(),
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
        if refusal is None:
            token = preview.issue_token(version, request.user)
            context.update(
                preview_token=token.value,
                preview_file_url=reverse(
                    "admin:assets_assetversion_preview_file", args=[version.pk]
                ),
                preview_token_header=preview.TOKEN_HEADER,
                max_bytes=max_upload_bytes(),
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
        try:
            with get_storage().open(version.storage_key) as stream:
                data = stream.read(version.size_bytes + 1)
        except StorageError:
            logger.warning(
                "asset preview unavailable: %s v%s", version.asset.asset_id, version.number
            )
            return _preview_error(
                "content_unavailable", "The stored file could not be read. Try again later.", 503
            )
        if len(data) != version.size_bytes or hashlib.sha256(data).hexdigest() != version.sha256:
            logger.warning(
                "asset preview checksum mismatch: %s v%s", version.asset.asset_id, version.number
            )
            return _preview_error(
                "checksum_mismatch",
                "The stored file does not match its recorded checksum, so it is not shown.",
                409,
            )
        response = HttpResponse(data, content_type=version.content_type)
        response["Content-Length"] = str(version.size_bytes)
        return response

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

    # --- lifecycle actions ---

    def _run(self, request, queryset, action, done: str):
        succeeded = 0
        for version in queryset.select_related("asset"):
            try:
                action(version)
            except services.AssetActionRefused as refused:
                self.message_user(request, f"{version.label}: {refused.message}", messages.ERROR)
            else:
                succeeded += 1
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

    @admin.action(description="Retire selected versions", permissions=["retire"])
    def retire_versions(self, request, queryset):
        self._run(request, queryset, services.retire_version, "Retired")

    # --- display ---

    @admin.display(description="Version", ordering="asset__asset_id")
    def version_label(self, obj) -> str:
        return obj.label

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


def _preview_error(code: str, message: str, status: int) -> JsonResponse:
    return JsonResponse(error_body(code, message), status=status)

