"""Sound cues, assignments and releases in Django Admin (SM-P2-03, SM-P2-04, SM-P2-08).

Staff configure sound here and nowhere else (ADR-045): there is no React screen and no write API.
Audio files are uploaded, versioned and published in the Asset Library; this is the configuration
layer over those published assets.

Access is by Django permission, like the Asset Library, with two groups made by
`manage.py ensure_sound_roles`. Editing a cue or an assignment never changes what children hear:
only publishing a release does, and only a user with `publish_soundrelease` can publish. Releases
cannot be added, changed or deleted by hand.

Audio inspection (`asset.process_audio`, LAI-LAMBDA-008 phase 1): "Inspect audio in background"
on Audio files and on Sound cues submits a header inspection of the exact stored version (staff
with `audio.inspect_audiofile`). The result is shown read-only and escaped, with a link to the
background job; it never changes the version, the cue or a release, and publishes nothing. A
failed or refused inspection may be submitted again.
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
from django.utils.timezone import localtime

from apps.assets import preview
from apps.catalog.models import ContentAsset

from . import inspection, reporting, services, transcoding
from .models import AudioFile, SoundAssignment, SoundCue, SoundLibraryReport, SoundRelease
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
    actions = [
        "enable_cues",
        "disable_cues",
        "inspect_audio",
        "transcode_audio",
        "normalize_audio",
    ]
    readonly_fields = (
        "audio_preview",
        "publishing",
        "audio_inspection",
        "audio_transcoding",
        "created_at",
        "updated_at",
    )
    fieldsets = (
        (None, {"fields": ("cue_id", "name", "description", "channel", "enabled", "shared")}),
        (
            "Audio",
            {
                "fields": (
                    "asset",
                    "pinned_version",
                    "audio_preview",
                    "publishing",
                    "audio_inspection",
                    "audio_transcoding",
                )
            },
        ),
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
        (
            "Positional audio (3D scenes)",
            {
                "description": "Leave on 'Game decides' for flat sound. Choose 'Positional' to set "
                "how far the sound carries; the game still supplies where it is.",
                "fields": (
                    "spatial_mode",
                    "spatial_ref_distance",
                    "spatial_max_distance",
                    "spatial_rolloff",
                    "spatial_distance_model",
                    "spatial_cone_inner",
                    "spatial_cone_outer",
                    "spatial_cone_outer_gain",
                ),
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

    @admin.display(description="Audio inspection")
    def audio_inspection(self, obj):
        if obj is None or obj.pk is None:
            return "Save the cue to inspect its audio."
        version = services.version_for(obj)
        if version is None:
            return "The cue has no audio version to inspect yet."
        return format_html(
            "<p>{}</p>{}{}",
            f"Version {version.label}",
            inspection_status_html(version),
            inspection_result_html(version),
        )

    @admin.display(description="Transcoding and normalising")
    def audio_transcoding(self, obj):
        if obj is None or obj.pk is None:
            return "Save the cue to transcode its audio."
        version = services.version_for(obj)
        if version is None:
            return "The cue has no audio version to transcode yet."
        return transcoding_html(version)

    def has_inspect_permission(self, request):
        return can_inspect(request)

    def has_transcode_permission(self, request):
        return can_transcode(request)

    def _transcode(self, request, queryset, normalize):
        pairs, missing = [], 0
        for cue in queryset.select_related("asset", "asset__default_version", "pinned_version")[
            :50
        ]:
            version = services.version_for(cue)
            if version is None:
                missing += 1
            else:
                pairs.append((version, cue.channel))
        if missing:
            self.message_user(
                request, f"{missing} cue(s) have no audio version to transcode.", messages.WARNING
            )
        submit_transcodes(self, request, pairs, normalize=normalize)

    @admin.action(
        description="Transcode to Opus and MP3 in background (keeps the level; outputs are "
        "previews for review)",
        permissions=["transcode"],
    )
    def transcode_audio(self, request, queryset):
        self._transcode(request, queryset, False)

    @admin.action(
        description="Normalise loudness and transcode in background (to the channel target; "
        "outputs are previews for review)",
        permissions=["transcode"],
    )
    def normalize_audio(self, request, queryset):
        self._transcode(request, queryset, True)

    @admin.action(
        description="Inspect audio in background (header facts, result for review)",
        permissions=["inspect"],
    )
    def inspect_audio(self, request, queryset):
        """Inspect each selected cue's audio version (pinned, else the asset's default)."""
        versions, missing = [], 0
        for cue in queryset.select_related("asset", "asset__default_version", "pinned_version")[
            :50
        ]:
            version = services.version_for(cue)
            if version is None:
                missing += 1
            else:
                versions.append(version)
        if missing:
            self.message_user(
                request,
                f"{missing} cue(s) have no audio version to inspect.",
                messages.WARNING,
            )
        submit_inspections(self, request, versions)

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
        "priority",
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


# --- audio inspection (LAI-LAMBDA-008 phase 1; read only, every job value escaped) ----------------


def can_inspect(request) -> bool:
    user = request.user
    return bool(user.is_active and user.is_staff and user.has_perm("audio.inspect_audiofile"))


def submit_inspections(modeladmin, request, versions) -> None:
    """Submit `asset.process_audio` for each version, or report its existing job. Changes no
    version, cue or release."""
    from apps.jobs.services import JobsDisabled, JobsError

    submitted, seen = 0, set()
    for version in versions:
        if version.pk in seen:
            continue
        seen.add(version.pk)
        previous = inspection.latest_job(version)
        known = set(inspection.inspection_jobs(version).values_list("pk", flat=True))
        try:
            job = inspection.submit_audio_inspection(version, user=request.user)
        except JobsDisabled:
            modeladmin.message_user(
                request,
                "Background jobs are turned off on this server, so nothing was inspected.",
                messages.ERROR,
            )
            return
        except JobsError as error:
            modeladmin.message_user(
                request,
                f"{version.label}: Audio inspection could not start ({error.code}).",
                messages.ERROR,
            )
            continue
        if job.pk not in known:
            submitted += 1
            if previous is not None and (
                previous.status == "failed" or inspection.is_mismatch(previous.subject_outcome)
            ):
                modeladmin.message_user(
                    request,
                    f"{version.label}: The earlier inspection failed or was refused, so a new "
                    "one was submitted.",
                    messages.INFO,
                )
        elif job.is_terminal:
            modeladmin.message_user(
                request,
                f"{version.label}: This file was already inspected ({_job_status(job)}).",
                messages.INFO,
            )
        else:
            modeladmin.message_user(
                request,
                f"{version.label}: An inspection of this file is already queued or running.",
                messages.INFO,
            )
    if submitted:
        modeladmin.message_user(
            request,
            f"Audio inspection submitted for {submitted} file(s). Nothing was changed or "
            "published; results appear on each file's page.",
            messages.SUCCESS,
        )


def _job_status(job) -> str:
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


def _notice(job, version) -> str:
    again = "Run Inspect audio in background again to retry."
    if job.status == "pending":
        return "Queued: waiting for the background inspector. There is no result yet."
    if job.status == "running":
        return "Processing: the background inspector is reading the file. No result yet."
    if job.status == "failed":
        return f"The inspection failed, so there is no result. {again}"
    code = job.subject_outcome
    if inspection.is_mismatch(code) or (
        code == inspection.RECORDED and inspection.identity_mismatch(job, version) is not None
    ):
        return (
            f"This result does not match this version's stored file, so it does not count. {again}"
        )
    if code != inspection.RECORDED:
        return f"No usable result ({code or 'not applied'}). {again}"
    if inspection.identity_mismatch(job, version, require_current_processor=True):
        return "Inspected by an older inspector version. Run the inspection again to refresh it."
    verdict = (job.result or {}).get("verdict")
    if verdict == "pass":
        return "Inspected: the headers are consistent. This does not prove the file plays."
    return "Inspected: the inspector found problems in this file. See the findings."


def inspection_status_html(version):
    job = inspection.latest_job(version)
    if job is None:
        return format_html("<p>{}</p>", "This file has not been inspected in the background.")
    rows = [
        ("Status", _job_status(job)),
        ("Outcome", job.subject_outcome or "-"),
        ("Submitted", _when(job.created_at)),
        ("Finished", _when(job.finished_at)),
        ("Error code", job.error_code or "-"),
    ]
    return format_html(
        '<p>{}</p><dl>{}</dl><p><a href="{}">{}</a></p>',
        _notice(job, version),
        format_html_join("", "<dt>{}</dt><dd>{}</dd>", rows),
        reverse("admin:jobs_processingjob_change", args=[job.pk]),
        "Open the background job",
    )


def inspection_result_html(version):
    job = inspection.latest_job(version)
    summary = inspection.inspection_summary(job)
    if summary is None or inspection.identity_mismatch(job, version) is not None:
        return format_html("<p>{}</p>", "No inspection result for this file.")
    verdict = {"pass": "Pass", "fail": "Problems found"}.get(summary.get("verdict"), "Unknown")
    duration = summary.get("duration_seconds")
    rows = [
        ("Verdict", verdict),
        ("Detected format", _text(summary.get("detected_format"))),
        ("Container", _text(summary.get("container"))),
        ("Codec", _text(summary.get("codec"))),
        ("Declared type", _text(summary.get("declared_content_type"))),
        ("Declared type matches", _text(summary.get("declared_type_matches"))),
        (
            "Duration",
            f"{_text(duration)} s ({_text(summary.get('duration_kind'))})"
            if duration is not None
            else f"- ({_text(summary.get('duration_kind'))})",
        ),
        ("Sample rate", _text(summary.get("sample_rate_hz"))),
        ("Channels", _text(summary.get("channels"))),
        ("Sample width (bits)", _text(summary.get("sample_width_bits"))),
        ("Bit rate", f"{_text(summary.get('bitrate_bps'))} ({_text(summary.get('bitrate_mode'))})"),
        ("File size (bytes)", _text(summary.get("file_size_bytes"))),
        (
            "Inspector",
            f"{_text(summary.get('processor_id'))} {_text(summary.get('processor_version'))}",
        ),
        ("Run warnings", ", ".join(summary.get("run_warnings") or []) or "None"),
    ]
    findings = summary.get("findings") or []
    table = (
        format_html(
            "<table><thead><tr><th>{}</th><th>{}</th><th>{}</th><th>{}</th></tr></thead>"
            "<tbody>{}</tbody></table>",
            "Severity",
            "Code",
            "Message",
            "Where",
            format_html_join(
                "",
                "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",
                ((f["severity"], f["code"], f["message"], f["path"]) for f in findings),
            ),
        )
        if findings
        else format_html("<p>{}</p>", "No findings.")
    )
    limitations = format_html(
        "<p><strong>{}</strong></p><ul>{}</ul>",
        "Limitations",
        format_html_join("", "<li>{}</li>", ((text,) for text in summary.get("limitations") or [])),
    )
    return format_html(
        "<dl>{}</dl><p><strong>{}</strong></p>{}{}",
        format_html_join("", "<dt>{}</dt><dd>{}</dd>", rows),
        "Findings",
        table,
        limitations,
    )


def _when(value) -> str:
    return localtime(value).strftime("%Y-%m-%d %H:%M:%S %Z") if value else "-"


def _text(value) -> str:
    if value is None:
        return "-"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return str(value)[:200]


@admin.register(AudioFile)
class AudioFileAdmin(admin.ModelAdmin):
    """Audio versions from the Asset Library, for background inspection only. Read-only: upload,
    publish and retire stay in the Asset Library."""

    list_display = ("file_label", "format", "status", "inspection_state")
    list_filter = ("format", "status")
    search_fields = ("asset__asset_id",)
    list_select_related = ("asset",)
    actions = ["inspect_audio", "transcode_audio", "normalize_audio"]
    fields = (
        "file_label",
        "format",
        "status",
        "content_type",
        "size_bytes",
        "sha256",
        "inspection_status",
        "inspection_result",
        "transcoding",
    )
    readonly_fields = fields

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .filter(format__in=sorted(inspection.AUDIO_FORMATS))
            .select_related("asset")
        )

    def has_view_permission(self, request, obj=None):
        user = request.user
        return bool(
            user.is_active
            and user.is_staff
            and (
                user.has_perm("audio.view_audiofile")
                or user.has_perm("audio.inspect_audiofile")
                or user.has_perm("audio.transcode_audiofile")
            )
        )

    def has_module_permission(self, request):
        return self.has_view_permission(request)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_inspect_permission(self, request):
        return can_inspect(request)

    def has_transcode_permission(self, request):
        return can_transcode(request)

    @admin.display(description="Transcoding and normalising")
    def transcoding(self, obj):
        return transcoding_html(obj)

    @admin.action(
        description="Transcode to Opus and MP3 in background (keeps the level; outputs are "
        "previews for review)",
        permissions=["transcode"],
    )
    def transcode_audio(self, request, queryset):
        submit_transcodes(
            self,
            request,
            [(v, None) for v in queryset.select_related("asset")[:50]],
            normalize=False,
        )

    @admin.action(
        description="Normalise loudness and transcode in background (to the channel target; "
        "outputs are previews for review)",
        permissions=["transcode"],
    )
    def normalize_audio(self, request, queryset):
        submit_transcodes(
            self,
            request,
            [(v, None) for v in queryset.select_related("asset")[:50]],
            normalize=True,
        )

    @admin.display(description="File", ordering="asset__asset_id")
    def file_label(self, obj):
        return obj.label

    @admin.display(description="Inspection")
    def inspection_state(self, obj):
        job = inspection.latest_job(obj)
        return _job_status(job) if job is not None else "Not inspected"

    @admin.display(description="Inspection status")
    def inspection_status(self, obj):
        return inspection_status_html(obj)

    @admin.display(description="Inspection result")
    def inspection_result(self, obj):
        return inspection_result_html(obj)

    @admin.action(
        description="Inspect audio in background (header facts, result for review)",
        permissions=["inspect"],
    )
    def inspect_audio(self, request, queryset):
        submit_inspections(self, request, list(queryset.select_related("asset")[:50]))


# --- transcoding and normalising (ADR-067; every value escaped; nothing is published) ------------


def can_transcode(request) -> bool:
    user = request.user
    return bool(user.is_active and user.is_staff and user.has_perm("audio.transcode_audiofile"))


def submit_transcodes(modeladmin, request, pairs, *, normalize: bool) -> None:
    """Submit `asset.transcode_audio` for each (version, channel or None), or report its existing
    job. Refused with a safe message while the control is off. Changes no version, cue or
    release; outputs are private previews that staff review and may promote elsewhere."""
    from apps.jobs.services import JobsDisabled, JobsError, WorkloadUnavailable

    what = "Normalising" if normalize else "Transcoding"
    submitted, seen = 0, set()
    for version, channel in pairs:
        if (version.pk, channel) in seen:
            continue
        seen.add((version.pk, channel))
        known = set(transcoding.transcode_jobs(version).values_list("pk", flat=True))
        try:
            job = transcoding.submit_transcode(
                version, normalize=normalize, user=request.user, channel=channel
            )
        except WorkloadUnavailable as error:
            modeladmin.message_user(
                request, f"{what} is not available: {error.message}", messages.ERROR
            )
            return
        except JobsDisabled:
            modeladmin.message_user(
                request,
                "Background jobs are turned off on this server, so nothing was sent.",
                messages.ERROR,
            )
            return
        except transcoding.TranscodeRefused as error:
            modeladmin.message_user(request, f"{version.label}: {error.message}", messages.ERROR)
            continue
        except JobsError as error:
            modeladmin.message_user(
                request,
                f"{version.label}: {what} could not start ({error.code}).",
                messages.ERROR,
            )
            continue
        if job.pk not in known:
            submitted += 1
        elif job.is_terminal:
            modeladmin.message_user(
                request,
                f"{version.label}: This file was already processed this way ({_job_status(job)}).",
                messages.INFO,
            )
        else:
            modeladmin.message_user(
                request,
                f"{version.label}: This request is already queued or running.",
                messages.INFO,
            )
    if submitted:
        modeladmin.message_user(
            request,
            f"{what} submitted for {submitted} file(s). Nothing was changed or published; the "
            "outputs appear as previews on each file's page for you to review and promote.",
            messages.SUCCESS,
        )


def _fmt(value, unit: str = "") -> str:
    if value is None:
        return "-"
    return f"{value:g}{unit}" if isinstance(value, int | float) else str(value)[:64]


def transcoding_html(version):
    job = transcoding.latest_job(version)
    if job is None:
        return format_html("<p>{}</p>", "This file has not been transcoded in the background.")
    rows = [
        ("Status", _job_status(job)),
        ("Outcome", job.subject_outcome or "-"),
        ("Submitted", _when(job.created_at)),
        ("Finished", _when(job.finished_at)),
        ("Error code", job.error_code or "-"),
    ]
    head = format_html(
        '<dl>{}</dl><p><a href="{}">{}</a></p>',
        format_html_join("", "<dt>{}</dt><dd>{}</dd>", rows),
        reverse("admin:jobs_processingjob_change", args=[job.pk]),
        "Open the background job",
    )
    data = transcoding.summary(job)
    if data is None:
        if job.status in ("pending", "running"):
            note = "In progress: no result yet."
        elif job.status == "failed":
            note = "The job failed, so there is no result. Run the action again to retry."
        else:
            note = "No usable result for this file."
        return format_html("{}<p>{}</p>", head, note)
    kind = "Normalised to the channel target" if data["normalize"] else "Converted, level kept"
    source = (
        f"{data['source_format']} {data['source_codec']}, "
        f"{_fmt(data['source_duration_seconds'], ' s')}, "
        f"{_fmt(data['source_sample_rate_hz'], ' Hz')}, "
        f"{_fmt(data['source_channels'], ' ch')}"
    )
    out_rows = []
    for o in data["outputs"]:
        link = "-"
        if o.artifact_id:
            link = format_html(
                '<a href="{}">{}</a> | <a href="{}">{}</a> ({})',
                reverse("admin:assets_derivedartifact_change", args=[o.artifact_id]),
                "Review and promote",
                reverse("admin:assets_derivedartifact_media", args=[o.artifact_id]),
                "Play",
                o.artifact_state,
            )
        out_rows.append(
            (
                o.label,
                o.content_type,
                _fmt(o.duration_seconds, " s"),
                _fmt(o.bitrate_kbps, " kbit/s"),
                _fmt(o.size_bytes, " bytes"),
                f"{_fmt(o.before.get('integrated_lufs'))} to "
                f"{_fmt(o.after.get('integrated_lufs'), ' LUFS')}",
                f"{_fmt(o.before.get('true_peak_dbtp'))} to "
                f"{_fmt(o.after.get('true_peak_dbtp'), ' dBTP')}",
                _fmt(o.gain_db, " dB"),
                link,
            )
        )
    outputs = format_html(
        "<table><thead><tr>{}</tr></thead><tbody>{}</tbody></table>",
        format_html_join(
            "",
            "<th>{}</th>",
            (
                (h,)
                for h in (
                    "Output",
                    "Type",
                    "Duration",
                    "Bit rate",
                    "Size",
                    "Loudness before to after",
                    "True peak before to after",
                    "Gain",
                    "Preview",
                )
            ),
        ),
        format_html_join(
            "",
            "<tr>{}</tr>",
            ((format_html_join("", "<td>{}</td>", ((c,) for c in row)),) for row in out_rows),
        ),
    )
    findings = data["findings"]
    table = (
        format_html(
            "<table><thead><tr><th>{}</th><th>{}</th><th>{}</th><th>{}</th></tr></thead>"
            "<tbody>{}</tbody></table>",
            "Severity",
            "Code",
            "Message",
            "Output",
            format_html_join(
                "",
                "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",
                ((f["severity"], f["code"], f["message"], f["path"]) for f in findings),
            ),
        )
        if findings
        else format_html("<p>{}</p>", "No findings.")
    )
    return format_html(
        "{}<p><strong>{}</strong> {} | {} | {}</p><p>{}</p>{}<p><strong>{}</strong></p>{}<p>{}</p>",
        head,
        kind,
        data["profile"],
        data["tool"],
        source,
        "Outputs are private previews. Nothing is published or replaced until a staff member "
        "promotes one and publishes it.",
        outputs,
        "Findings",
        table,
        "Loudness is measured by FFmpeg (EBU R128). Listen before you promote.",
    )
