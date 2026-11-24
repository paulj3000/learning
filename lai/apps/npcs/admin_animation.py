"""Animation inspection on the NPC model variant admin (LAI-LAMBDA-009). Read only.

`NpcModelVariantAdmin` (admin_characters) uses these helpers for its "Inspect animations in
background" action and its read-only "Animation inspection" section. Every value from a job or a
file is escaped (`format_html`, `format_html_join`). The mapping helper is a suggestion only:
nothing here writes `NpcModelVariant.animation_map`; staff type a mapping into the existing
animation map field and save the form, which checks it against the model's clips as before.
"""

from __future__ import annotations

from django.contrib import messages
from django.urls import reverse
from django.utils.html import format_html, format_html_join
from django.utils.timezone import localtime

from . import animation_inspection as inspection

#: Most variants one action run submits (as Validate in background).
MAX_PER_ACTION = 50

_STATUS = {
    "pending": "Queued",
    "running": "Processing",
    "completed": "Completed",
    "failed": "Failed",
}
_OUTCOMES = {
    "inspection_stored": "Stored on this unpublished version",
    "result_recorded": "Kept on the job (the version is published, so it is never changed)",
    "duplicate_result": "Already stored",
    "stale_result": "Not stored: a later inspection of this version is already stored",
    "processing_failed": "The inspection failed",
    "version_missing": "The version no longer exists",
}
_MATCH = {
    "exact": "Exact name",
    "case_insensitive": "Same name, different capitals",
    "ambiguous": "More than one clip matches; choose yourself",
    "none": "No suggestion",
}


def inspected_version(variant):
    """The version a variant's model resolves to (pinned, else the asset's default)."""
    from .admin_characters import resolved_version

    return resolved_version(variant) if variant is not None and variant.model_asset_id else None


def run_action(model_admin, request, queryset) -> None:
    """Submit an inspection for the version each selected variant resolves to."""
    from apps.jobs.services import JobsDisabled, JobsError

    submitted = 0
    for variant in queryset.select_related("model_asset", "pinned_version")[:MAX_PER_ACTION]:
        version = inspected_version(variant)
        if version is None:
            model_admin.message_user(
                request,
                f"{variant}: The model has no stored version to inspect (bundled with the game).",
                messages.WARNING,
            )
            continue
        known = set(inspection.inspection_jobs(version).values_list("pk", flat=True))
        try:
            job = inspection.submit_animation_inspection(version, user=request.user)
        except inspection.InspectionRefused as refused:
            reason = {
                "unsupported_format": "Only GLB models can be inspected.",
                "asset_retired": "The model asset is retired.",
            }.get(refused.code, refused.code)
            model_admin.message_user(request, f"{variant}: {reason}", messages.ERROR)
            continue
        except JobsDisabled:
            model_admin.message_user(
                request,
                "Background jobs are turned off on this server, so nothing was inspected.",
                messages.ERROR,
            )
            return
        except JobsError as error:
            model_admin.message_user(
                request,
                f"{variant}: The inspection could not start ({error.code}).",
                messages.ERROR,
            )
            continue
        if job.pk in known:
            model_admin.message_user(
                request,
                f"{variant}: This file already has an inspection ({_status(job)}); see the "
                "variant page.",
                messages.INFO,
            )
        else:
            submitted += 1
    if submitted:
        model_admin.message_user(
            request,
            f"Animation inspection submitted for {submitted} variant(s). Results appear on each "
            "variant page; nothing is mapped or published automatically.",
            messages.SUCCESS,
        )


def _status(job) -> str:
    label = _STATUS.get(job.status, job.status)
    if job.status == "failed" and job.error_code == "timeout":
        return "Failed: timed out"
    if job.status == "failed" and job.error_code == "submit_failed":
        return "Could not be sent"
    return label


def _when(value) -> str:
    return localtime(value).strftime("%Y-%m-%d %H:%M:%S %Z") if value else "-"


def _number(value) -> str:
    return str(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else "-"


def _items(value) -> list:
    return value if isinstance(value, list) else []


def _table(title: str, headings, rows):
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


def _yes(value) -> str:
    return "Yes" if value is True else "No" if value is False else "-"


def _node_names(nodes) -> str:
    names = []
    for node in _items(nodes):
        if isinstance(node, dict):
            name, index = node.get("name"), _number(node.get("index"))
            names.append(f"{name} (#{index})" if name else f"#{index}")
    return ", ".join(names) or "-"


def _job_section(job, version):
    if job is None:
        return format_html(
            "<p>{}</p>",
            "No animation inspection has run for this file. Select this variant in the list and "
            'choose "Inspect animations in background".',
        )
    outcome = _OUTCOMES.get(job.subject_outcome, job.subject_outcome or "-")
    if job.subject_outcome in inspection.MISMATCH_OUTCOMES:
        outcome = f"Refused: the result does not match this file ({job.subject_outcome})"
    notice = ""
    if job.status == "failed" or job.subject_outcome in inspection.MISMATCH_OUTCOMES:
        notice = "This inspection has no usable result. You can run the inspection again."
    rows = [
        (
            "Inspected file",
            f"{version.asset.asset_id} v{version.number} ({version.get_status_display()})",
        ),
        ("Status", _status(job)),
        ("Outcome", outcome),
        ("Submitted", _when(job.created_at)),
        ("Finished", _when(job.finished_at)),
        ("Error code", job.error_code or "-"),
    ]
    return format_html(
        '<dl>{}</dl><p>{}</p><p><a href="{}">{}</a></p>',
        format_html_join("", "<dt>{}</dt><dd>{}</dd>", rows),
        notice,
        reverse("admin:jobs_processingjob_change", args=[job.pk]),
        "Open the background job",
    )


def _summary_section(summary):
    counts = summary.get("counts") if isinstance(summary.get("counts"), dict) else {}
    verdict = {"pass": "Readable", "fail": "Problems found (see findings)"}.get(
        summary.get("verdict"), "Unknown"
    )
    rows = [
        ("Animation data", verdict),
        (
            "Processor",
            f"{summary.get('processor_id') or '-'} {summary.get('processor_version') or ''}",
        ),
        ("Clips", _number(summary.get("clip_count"))),
        ("Exporter take names", _number(summary.get("generic_clip_count"))),
        ("Channels", _number(counts.get("channels"))),
        ("Samplers", _number(counts.get("samplers"))),
        ("Keyframes", _number(counts.get("keyframes"))),
        ("Skins", _number(counts.get("skins"))),
        ("Joints", _number(counts.get("joints"))),
        ("Completed", summary.get("completed_at") or "-"),
    ]
    if summary.get("lists_truncated"):
        rows.append(("Lists", "Shortened by the inspector to fit its size limit."))
    clips = [c for c in _items(summary.get("clips")) if isinstance(c, dict)]
    skins = [s for s in _items(summary.get("skins")) if isinstance(s, dict)]
    findings = [f for f in _items(summary.get("findings")) if isinstance(f, dict)]
    parts = [
        format_html("<dl>{}</dl>", format_html_join("", "<dt>{}</dt><dd>{}</dd>", rows)),
        _table(
            "Clips (names exactly as in the file)",
            (
                "#",
                "Name",
                "Exact",
                "Exporter take name",
                "Duration (s)",
                "Channels",
                "Samplers",
                "Keyframes",
                "Interpolation",
                "Targets",
                "Target nodes",
                "Not joints",
            ),
            (
                (
                    _number(c.get("index")),
                    c.get("name") if c.get("name") is not None else "(no name)",
                    _yes(c.get("name_exact")),
                    _yes(c.get("generic_name")),
                    _number(c.get("duration_seconds")),
                    _number(c.get("channel_count")),
                    _number(c.get("sampler_count")),
                    _number(c.get("keyframe_count")),
                    ", ".join(map(str, _items(c.get("interpolations")))) or "-",
                    ", ".join(map(str, _items(c.get("target_paths")))) or "-",
                    f"{_number(c.get('target_node_count'))}: {_node_names(c.get('target_nodes'))}",
                    _number(c.get("targets_outside_skins")),
                )
                for c in clips
            ),
        ),
        _table(
            "Skins",
            ("#", "Name", "Joints", "Root joints", "Depth", "Skeleton", "Used by nodes"),
            (
                (
                    _number(s.get("index")),
                    s.get("name") or "-",
                    _number(s.get("joint_count")),
                    _node_names(s.get("root_joints")),
                    _number(s.get("hierarchy_depth")),
                    _node_names([s["skeleton"]]) if isinstance(s.get("skeleton"), dict) else "-",
                    _number(s.get("used_by_node_count")),
                )
                for s in skins
            ),
        ),
        _table(
            "Warnings and findings",
            ("Severity", "Code", "Message", "Where"),
            (
                (f.get("severity", ""), f.get("code", ""), f.get("message", ""), f.get("path", ""))
                for f in findings
            ),
        ),
    ]
    return format_html_join("", "{}", ((part,) for part in parts))


def _suggestions_section(summary, variant):
    rows = inspection.suggest_mapping(summary, variant.animation_map)
    table = _table(
        "Mapping helper (suggestion only)",
        ("State", "Current clip", "In this file", "Suggested clip", "Why"),
        (
            (
                r["state"],
                r["current"] or "-",
                _yes(r["current_in_model"]),
                r["suggestion"] or "-",
                _MATCH.get(r["match"], r["match"]),
            )
            for r in rows
        ),
    )
    return format_html(
        "<p><strong>{}</strong> {}</p>{}",
        "Suggestion only.",
        "Nothing here changes the animation map. A clip is suggested only when its name equals "
        "a state, ignoring capitals; exporter take names (such as Mixamo's) are never "
        "suggested, because their names do not say what the motion is. To use a clip, type it "
        "into the animation map field and save.",
        table,
    )


def render(variant):
    """The read-only "Animation inspection" section of a variant's change page."""
    version = inspected_version(variant)
    if version is None:
        return "The model has no stored version to inspect (bundled with the game)."
    job, summary = inspection.latest_inspection(version)
    parts = [_job_section(job, version)]
    if summary is not None:
        parts += [_summary_section(summary), _suggestions_section(summary, variant)]
    return format_html_join("", "{}", ((part,) for part in parts))
