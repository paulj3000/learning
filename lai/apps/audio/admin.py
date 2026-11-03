"""Sound cues, assignments and releases in Django Admin (SM-P2-03, SM-P2-04, SM-P2-08).

Staff configure sound here and nowhere else (ADR-045): there is no React screen and no write API.
Audio files are uploaded, versioned and published in the Asset Library; this is the configuration
layer over those published assets.

Access is by Django permission, like the Asset Library, with two groups made by
`manage.py ensure_sound_roles`. Editing a cue or an assignment never changes what children hear:
only publishing a release does, and only a user with `publish_soundrelease` can publish. Releases
cannot be added, changed or deleted by hand.
"""

from django import forms
from django.contrib import admin, messages
from django.contrib.admin import ActionLocation
from django.contrib.admin.models import ADDITION, CHANGE, LogEntry
from django.core.exceptions import PermissionDenied
from django.http import HttpResponseRedirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html, format_html_join

from apps.assets import preview
from apps.catalog.models import ContentAsset

from . import reporting, services
from .models import SoundAssignment, SoundCue, SoundLibraryReport, SoundRelease
from .vocabulary import AUDIO_KIND


def _log(request, obj, flag, message: str) -> None:
    LogEntry.objects.log_actions(
        request.user.pk,
        [obj],
        flag,
        message,
        single_object=True,
    )


class CueForm(forms.ModelForm):
    class Meta:
        model = SoundCue
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["asset"].queryset = ContentAsset.objects.filter(
            kind=AUDIO_KIND, status="ACTIVE"
        ).order_by("asset_id")
        if "pinned_version" in self.fields:
            asset_id = self.instance.asset_id
            self.fields["pinned_version"].queryset = (
                self.fields["pinned_version"].queryset.filter(asset_id=asset_id, status="PUBLISHED")
                if asset_id
                else self.fields["pinned_version"].queryset.none()
            )


@admin.register(SoundCue)
class SoundCueAdmin(admin.ModelAdmin):
    form = CueForm
    list_display = ("cue_id", "name", "channel", "asset", "publishing", "enabled", "shared")
    list_filter = ("channel", "enabled", "shared")
    search_fields = ("cue_id", "name", "description", "asset__asset_id")
    list_select_related = ("asset", "asset__default_version", "pinned_version")
    actions = ["enable_cues", "disable_cues"]
    readonly_fields = ("audio_preview", "publishing", "created_at", "updated_at")
    fieldsets = (
        (None, {"fields": ("cue_id", "name", "description", "channel", "enabled", "shared")}),
        ("Audio", {"fields": ("asset", "pinned_version", "audio_preview", "publishing")}),
        (
            "Playback",
            {
                "fields": (
                    "volume",
                    "loop",
                    "stream",
                    "priority",
                    "max_concurrent",
                    "cooldown_ms",
                    "fade_in_ms",
                    "fade_out_ms",
                )
            },
        ),
        ("History", {"fields": ("created_at", "updated_at")}),
    )

    def get_readonly_fields(self, request, obj=None):
        fixed = list(super().get_readonly_fields(request, obj))
        # An id and its channel, once chosen, are a promise to games and published releases.
        return [*fixed, "cue_id", "channel"] if obj is not None else fixed

    def _live(self, request):
        if not hasattr(request, "_live_release"):
            request._live_release = services.live_release()
        return request._live_release

    @admin.display(description="Publishing status")
    def publishing(self, obj):
        if obj is None or obj.pk is None:
            return "-"
        request = getattr(self, "_request", None)
        live = self._live(request) if request else services.live_release()
        status = services.cue_status(obj, live)
        version = services.version_for(obj)
        problem = services._version_problem(obj, version)
        if problem and obj.enabled:
            return format_html(
                "{} <strong>(blocked: {})</strong>", status, problem.split(": ", 1)[1]
            )
        return status

    @admin.display(description="Audio preview")
    def audio_preview(self, obj):
        if obj is None or obj.pk is None:
            return "Save the cue to preview its audio."
        version = services.version_for(obj)
        if version is None:
            return "The asset has no published version yet. Publish one in the Asset Library."
        return preview.file_preview_html(version)

    def changelist_view(self, request, extra_context=None):
        self._request = request
        return super().changelist_view(request, extra_context)

    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        self._request = request
        return super().changeform_view(request, object_id, form_url, extra_context)

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)

    @admin.action(description="Enable selected cues (takes effect at the next release)")
    def enable_cues(self, request, queryset):
        count = queryset.update(enabled=True)
        self.message_user(request, f"Enabled {count} cue(s).")

    @admin.action(description="Disable selected cues (left out of the next release)")
    def disable_cues(self, request, queryset):
        count = queryset.update(enabled=False)
        self.message_user(request, f"Disabled {count} cue(s).")


@admin.register(SoundAssignment)
class SoundAssignmentAdmin(admin.ModelAdmin):
    list_display = ("describe", "scope_label", "cue", "enabled")
    list_filter = ("target_type", "event", "enabled")
    search_fields = ("target_id", "cue__cue_id", "note")
    list_select_related = ("cue", "world", "location", "region")
    autocomplete_fields = ()
    fields = (
        "world",
        "location",
        "region",
        "target_type",
        "target_id",
        "event",
        "cue",
        "enabled",
        "note",
    )

    @admin.display(description="Sound")
    def describe(self, obj):
        return f"{obj.target_type} {obj.target_id or '(scope)'} {obj.event}"

    @admin.display(description="Where")
    def scope_label(self, obj):
        return f"{obj.scope_type}: {obj.scope_id or 'everywhere'}"

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(SoundRelease)
class SoundReleaseAdmin(admin.ModelAdmin):
    list_display = (
        "number",
        "status",
        "cue_count",
        "assignment_count",
        "published_by",
        "published_at",
        "note",
    )
    list_filter = ("status",)
    change_list_template = "admin/audio/soundrelease/change_list.html"
    actions = ["roll_back"]
    readonly_fields = (
        "number",
        "status",
        "revision",
        "note",
        "rolled_back_from",
        "published_by",
        "published_at",
        "snapshot_summary",
    )
    fields = readonly_fields

    # --- permissions: releases are made by the publish page and the rollback action only ---

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_view_permission(self, request, obj=None):
        return request.user.has_perm("audio.view_soundrelease")

    def has_publish_permission(self, request):
        return request.user.has_perm("audio.publish_soundrelease")

    def has_rollback_permission(self, request):
        return request.user.has_perm("audio.rollback_soundrelease")

    @admin.display(description="Cues")
    def cue_count(self, obj):
        return len(obj.snapshot["cues"])

    @admin.display(description="Assignments")
    def assignment_count(self, obj):
        return len(obj.snapshot["assignments"])

    @admin.display(description="Contents")
    def snapshot_summary(self, obj):
        items = format_html_join(
            "",
            "<li>{} &rarr; {}@{}</li>",
            ((cue["id"], cue["asset"], cue["version"]) for cue in obj.snapshot["cues"]),
        )
        return format_html("<ul>{}</ul>", items)

    def changelist_view(self, request, extra_context=None):
        extra_context = {
            **(extra_context or {}),
            "can_publish": self.has_publish_permission(request),
        }
        return super().changelist_view(request, extra_context)

    def get_urls(self):
        return [
            path(
                "publish/",
                self.admin_site.admin_view(self.publish_view),
                name="audio_soundrelease_publish",
            ),
            *super().get_urls(),
        ]

    def publish_view(self, request):
        if not self.has_publish_permission(request):
            raise PermissionDenied
        report = services.library_report()
        latest = SoundRelease.objects.order_by("-number").first()
        if request.method == "POST":
            try:
                release = services.publish(request.user, request.POST.get("note", ""))
            except services.PublishRefused as refused:
                for problem in refused.problems:
                    self.message_user(request, problem, messages.ERROR)
            else:
                _log(request, release, ADDITION, f"Published sound release {release.number}.")
                self.message_user(request, f"Published sound release {release.number}.")
                return HttpResponseRedirect(reverse("admin:audio_soundrelease_changelist"))
        snapshot = (
            services.build_snapshot() if not report.problems else {"cues": [], "assignments": []}
        )
        context = {
            **self.admin_site.each_context(request),
            "title": "Publish the sound library",
            "problems": report.problems,
            "warnings": report.warnings,
            "cue_count": len(snapshot["cues"]),
            "assignment_count": len(snapshot["assignments"]),
            "next_number": (latest.number + 1) if latest else 1,
            "opts": self.model._meta,
        }
        return TemplateResponse(request, "admin/audio/soundrelease/publish.html", context)

    @admin.action(
        description="Roll back to the selected release (publishes it again as a new release)"
    )
    def roll_back(self, request, queryset):
        if not self.has_rollback_permission(request):
            self.message_user(request, "You may not roll the sound library back.", messages.ERROR)
            return
        if queryset.count() != 1:
            self.message_user(request, "Select exactly one release.", messages.ERROR)
            return
        target = queryset.first()
        try:
            release = services.rollback_to(target, request.user)
        except services.PublishRefused as refused:
            for problem in refused.problems:
                self.message_user(request, problem, messages.ERROR)
            return
        _log(request, release, CHANGE, f"Rolled back to release {target.number}.")
        self.message_user(
            request, f"Release {target.number} is live again as release {release.number}."
        )

    def get_actions(self, request, action_location=ActionLocation.CHANGE_LIST):
        actions = super().get_actions(request, action_location)
        if not self.has_rollback_permission(request):
            actions.pop("roll_back", None)
        return actions


@admin.register(SoundLibraryReport)
class SoundLibraryReportAdmin(admin.ModelAdmin):
    """The sound library's readiness report (SM-P3). Read-only: it changes and publishes nothing.

    Allowed for anyone who may view sound cues (Sound editors and publishers, superusers). The
    page is a plain, filterable HTML report over `reporting.py`; the same functions back
    `manage.py audio_library_report`.
    """

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_view_permission(self, request, obj=None):
        return request.user.has_perm("audio.view_soundcue")

    def has_module_permission(self, request):
        return self.has_view_permission(request)

    def changelist_view(self, request, extra_context=None):
        if not self.has_view_permission(request):
            raise PermissionDenied
        game = request.GET.get("game", "treasure-rush")
        if game not in reporting.GAMES:
            game = "treasure-rush"
        show = request.GET.get("show", "all")
        severity = request.GET.get("severity", "all")
        query = request.GET.get("q", "").strip().lower()

        coverage = reporting.game_coverage(game)
        checks = [
            check
            for check in coverage.checks
            if (show != "blocked" or not check.ready)
            and (not query or query in check.cue_id or query in check.asset_id)
        ]
        issues = [
            issue
            for issue in reporting.diagnostics(game).issues
            if (severity == "all" or issue.severity == severity)
            and (not query or query in issue.subject.lower() or query in issue.message.lower())
        ]
        context = {
            **self.admin_site.each_context(request),
            "title": "Sound library report",
            "opts": self.model._meta,
            "inventory": reporting.inventory(),
            "coverage": coverage,
            "checks": checks,
            "optional": coverage.optional,
            "scopes": reporting.scope_coverage(),
            "issues": issues,
            "games": reporting.GAMES.values(),
            "game": game,
            "show": show,
            "severity": severity,
            "q": request.GET.get("q", ""),
            **(extra_context or {}),
        }
        return TemplateResponse(request, "admin/audio/soundlibraryreport/report.html", context)
