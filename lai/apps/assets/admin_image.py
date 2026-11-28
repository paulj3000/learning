"""Staff image actions on the Asset Library version admin (LAI-LAMBDA-013a, ADR-068).

Mixed into `AssetVersionAdmin`. It adds, for image versions only:

- the actions Convert image, Resize image and Generate thumbnail (permission: staff who may upload
  and view versions, like background validation). Convert and Resize open a small settings page;
  Generate thumbnail submits at once. All three go through `apps.assets.image_conversion.submit`
  and are refused with a safe message unless `LAI_IMAGE_CONVERSION` is on;
- a read-only "Image conversions" section on the version page: original and output dimensions and
  sizes, output format, colour handling, sanitization status, a preview streamed by A's derived
  artifact route (view permission) and a link to the artifact page, where review and promotion
  live (`assets.review_derivedartifact`, `assets.promote_derivedartifact`).

Nothing here changes the version, publishes or promotes.
"""

from django import forms
from django.contrib import admin, messages
from django.contrib.admin.options import ActionLocation
from django.core.exceptions import PermissionDenied
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html, format_html_join
from django.utils.safestring import mark_safe

from . import image_conversion as images
from .models import AssetVersion

IMAGE_FIELDS = ("image_conversions",)
ACTION_NAMES = ("convert_image", "resize_image", "generate_thumbnail")
_FORMATS = [("webp", "WebP"), ("png", "PNG"), ("jpeg", "JPEG")]


class _Settings(forms.Form):
    purpose = forms.ChoiceField(
        choices=[
            ("artwork", "Artwork (colours converted to sRGB)"),
            ("data", "Data texture (normal, roughness, metallic, mask: channel values kept)"),
        ],
        initial="artwork",
    )
    quality = forms.IntegerField(min_value=1, max_value=100, initial=85, label="Quality")
    lossless = forms.BooleanField(required=False, label="Lossless (WebP)")
    power_of_two = forms.BooleanField(required=False, label="Round sides down to a power of two")
    flatten_background = forms.RegexField(
        r"^(#[0-9a-fA-F]{6})?$",
        required=False,
        label="JPEG background for transparency (#rrggbb, empty for white)",
    )


class ConvertForm(_Settings):
    target_format = forms.ChoiceField(choices=_FORMATS, initial="webp", label="Output format")


class ResizeForm(_Settings):
    max_side = forms.IntegerField(
        min_value=16, max_value=4096, initial=1024, label="Longest side in pixels"
    )
    target_format = forms.ChoiceField(
        choices=[("source", "Same as the original"), *_FORMATS], initial="source"
    )


FORMS = {images.CONVERT: ConvertForm, images.RESIZE: ResizeForm}


def _initial_settings(version) -> dict:
    """LAI-ENV-02: a material map (normal, roughness, ORM...) defaults to the data purpose, which
    keeps channel values and is lossless, so it is never colour-managed by mistake."""
    from . import image_profiles

    profile = image_profiles.profile_for(version.asset, version)
    if profile is not None and profile.role == image_profiles.MATERIAL_MAP:
        return {"purpose": "data", "lossless": True}
    return {}


class ImageConversionAdminMixin:
    # --- permission and actions ---

    def has_convert_image_permission(self, request) -> bool:
        return bool(
            request.user.is_staff
            and request.user.has_perm("assets.add_assetversion")
            and self.has_view_permission(request)
        )

    def get_actions(self, request, action_location=ActionLocation.CHANGE_LIST):
        actions = super().get_actions(request, action_location)
        if self.has_convert_image_permission(request):
            for name in ACTION_NAMES:
                action = self.get_action(name, action_location)
                if action is not None:
                    actions[action.name] = action
        return actions

    def _single_image(self, request, queryset):
        versions = list(queryset.select_related("asset")[:2])
        if len(versions) != 1:
            self.message_user(
                request, "Select exactly one image version for this action.", messages.ERROR
            )
            return None
        problem = images.eligibility(versions[0])
        if problem:
            self.message_user(request, images.MESSAGES[problem], messages.ERROR)
            return None
        return versions[0]

    def _open_settings(self, request, queryset, action):
        version = self._single_image(request, queryset)
        if version is None:
            return None
        if not images.enabled():
            self.message_user(request, images.MESSAGES["workload_disabled"], messages.ERROR)
            return None
        return redirect(reverse("admin:assets_assetversion_image_job", args=[version.pk, action]))

    @admin.action(description="Convert image (format, quality, metadata removed)")
    def convert_image(self, request, queryset):
        return self._open_settings(request, queryset, images.CONVERT)

    @admin.action(description="Resize image (fit within a side length, metadata removed)")
    def resize_image(self, request, queryset):
        return self._open_settings(request, queryset, images.RESIZE)

    @admin.action(description="Generate thumbnail (128, 256 and 512 pixel WebP)")
    def generate_thumbnail(self, request, queryset):
        version = self._single_image(request, queryset)
        if version is not None:
            self._submit(request, version, images.THUMBNAIL, {})

    def _submit(self, request, version, action, options) -> bool:
        try:
            job = images.submit(version, action, options, user=request.user)
        except images.ImageConversionRefused as refused:
            self.message_user(request, f"{version.label}: {refused.message}", messages.ERROR)
            return False
        self.log_change(
            request, version, f"Submitted {images.ACTION_LABELS[action].lower()} job {job.pk}."
        )
        self.message_user(
            request,
            f"{images.ACTION_LABELS[action]} submitted for {version.label}. The result appears "
            "under Image conversions on the version page; nothing is published.",
            messages.SUCCESS,
        )
        return True

    # --- the settings page ---

    def get_urls(self):
        view = self.admin_site.admin_view(self.image_job_view)
        return [
            path(
                "<int:object_id>/image/<str:action>/",
                view,
                name="assets_assetversion_image_job",
            ),
            *super().get_urls(),
        ]

    def image_job_view(self, request, object_id, action):
        if not self.has_convert_image_permission(request):
            raise PermissionDenied
        form_class = FORMS.get(action)
        version = AssetVersion.objects.filter(pk=object_id).select_related("asset").first()
        if form_class is None or version is None:
            raise PermissionDenied
        back = redirect(reverse("admin:assets_assetversion_change", args=[version.pk]))
        problem = images.eligibility(version)
        if problem:
            self.message_user(request, images.MESSAGES[problem], messages.ERROR)
            return back
        if not images.enabled():
            self.message_user(request, images.MESSAGES["workload_disabled"], messages.ERROR)
            return back
        form = form_class(request.POST or None, initial=_initial_settings(version))
        if request.method == "POST" and form.is_valid():
            options = {k: v for k, v in form.cleaned_data.items() if v not in (None, "")}
            if self._submit(request, version, action, options):
                return back
        context = {
            **self.admin_site.each_context(request),
            "title": images.ACTION_LABELS[action],
            "version": version,
            "form": form,
            "opts": self.model._meta,
        }
        return TemplateResponse(request, "admin/assets/assetversion/image_job.html", context)

    # --- the read-only section ---

    def get_fieldsets(self, request, obj=None):
        fieldsets = list(super().get_fieldsets(request, obj))
        if (
            obj is not None
            and obj.format in images.IMAGE_FORMATS
            and request.user.has_perm("assets.view_derivedartifact")
        ):
            fieldsets.append(("Image conversions", {"fields": ("image_conversions",)}))
        return fieldsets

    @admin.display(description="Conversions")
    def image_conversions(self, obj):
        rows = images.output_rows(obj)
        job = images.latest_job(obj)
        status = (
            format_html(
                "<p>Latest job: {} ({}).</p>", job.status, job.subject_outcome or "no outcome yet"
            )
            if job is not None
            else mark_safe("<p>No conversion has been requested.</p>")  # noqa: S308 - literal
        )
        if not rows:
            return status
        body = format_html_join(
            "",
            "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td>"
            "<td>{}</td></tr>",
            (
                (
                    self._artifact_link(row),
                    row.state,
                    _size(row.source_width, row.source_height, row.source_size_bytes),
                    _size(row.width, row.height, row.size_bytes),
                    row.format,
                    row.colour,
                    {True: "metadata removed", False: "NOT verified", None: "not recorded"}[
                        row.sanitized
                    ],
                    self._preview(row),
                )
                for row in rows
            ),
        )
        return format_html(
            "{}<table><thead><tr><th>Output</th><th>State</th><th>Original</th><th>Output</th>"
            "<th>Format</th><th>Colour</th><th>Sanitization</th><th>Preview</th></tr>"
            "</thead><tbody>{}</tbody></table>"
            "<p>Review, accept and promote an output on its artifact page. Promotion creates a "
            "new unpublished version; nothing is published automatically.</p>",
            status,
            body,
        )

    def _artifact_link(self, row):
        url = reverse("admin:assets_derivedartifact_change", args=[row.artifact_id])
        return format_html('<a href="{}">{}</a>', url, row.logical_id)

    def _preview(self, row):
        if not row.previewable:
            return "removed"
        media = reverse("admin:assets_derivedartifact_media", args=[row.artifact_id])
        return format_html(
            '<img src="{}" alt="Converted image preview" style="max-width:96px;max-height:96px">',
            media,
        )


def _size(width, height, size_bytes) -> str:
    dims = f"{width} x {height}" if width and height else "size not recorded"
    return f"{dims}, {size_bytes:,} bytes"
