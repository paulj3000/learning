"""Derived-artifact workloads: the one place that decides whether a kind may be submitted.

ADR-066 and `docs/processing/COMPLETION_INTEGRATION.md` section 3. Three job kinds run on their
own native queues and produce derived artifacts:

| Kind | Queue | Queue URL setting | Feature control (default off) |
|---|---|---|---|
| `asset.transcode_audio` | audio | `LAI_JOBS_AUDIO_QUEUE_URL` | `LAI_AUDIO_TRANSCODING` |
| `asset.convert_image` | image | `LAI_JOBS_IMAGE_QUEUE_URL` | `LAI_IMAGE_CONVERSION` |
| `asset.optimize` | optimize | `LAI_JOBS_OPTIMIZE_QUEUE_URL` | `LAI_GLB_MESHOPT`, `LAI_GLB_KTX2` |

The RELEASE invariant: no message is emitted before producers and consumers both support it. So
a workload kind is submitted only while its control is `on` and, on the `sqs` backend, its queue
URL is configured. Otherwise `submit` raises `WorkloadUnavailable` (a `JobsError` with a stable
code and a safe message): no `ProcessingJob` row, no outbox row and no message exists. The
dispatch path re-checks, so a control switched off after submission fails the queued job
(`workload_disabled`) instead of emitting its message.

Workloads call `submit_workload(...)` (or `apps.jobs.services.submit`, which applies the same
rule); none reinvents the check. `workload_enabled(kind)` is the read-only question for the UI.
"""

from dataclasses import dataclass

from django.conf import settings

from .core import envelope

#: Stable codes (a `JobsError` code, and the failed job's `error_code` at dispatch).
WORKLOAD_DISABLED = "workload_disabled"
WORKLOAD_QUEUE_MISSING = "workload_queue_not_configured"

#: Safe, user-facing refusal text (no em dashes; shown by Django Admin).
MESSAGES = {
    WORKLOAD_DISABLED: "This kind of background processing is switched off.",
    WORKLOAD_QUEUE_MISSING: "This kind of background processing is not set up yet.",
}


@dataclass(frozen=True)
class Workload:
    kind: str
    queue: str
    queue_setting: str
    #: The controls, any one of which enables the kind (`asset.optimize`: Meshopt or KTX2).
    controls: tuple[str, ...]
    #: A short name for each control, for `variant=` (`submit_workload(..., variant="ktx2")`).
    variants: tuple[tuple[str, str], ...] = ()


WORKLOADS: dict[str, Workload] = {
    envelope.ASSET_TRANSCODE_AUDIO: Workload(
        envelope.ASSET_TRANSCODE_AUDIO,
        "audio",
        "LAI_JOBS_AUDIO_QUEUE_URL",
        ("LAI_AUDIO_TRANSCODING",),
    ),
    envelope.ASSET_CONVERT_IMAGE: Workload(
        envelope.ASSET_CONVERT_IMAGE, "image", "LAI_JOBS_IMAGE_QUEUE_URL", ("LAI_IMAGE_CONVERSION",)
    ),
    envelope.ASSET_OPTIMIZE: Workload(
        envelope.ASSET_OPTIMIZE,
        "optimize",
        "LAI_JOBS_OPTIMIZE_QUEUE_URL",
        ("LAI_GLB_MESHOPT", "LAI_GLB_KTX2"),
        variants=(("meshopt", "LAI_GLB_MESHOPT"), ("ktx2", "LAI_GLB_KTX2")),
    ),
}


def is_workload(kind: str) -> bool:
    return kind in WORKLOADS


def _on(name: str) -> bool:
    return getattr(settings, name, "off") == "on"


def refusal_code(
    kind: str, *, variant: str | None = None, backend: str | None = None
) -> str | None:
    """Why `kind` may not be submitted now (a stable code), or None when it may.

    `variant` narrows `asset.optimize` to one control (`meshopt` or `ktx2`). A kind that is not a
    workload is never refused here. On the `inline` backend (development and tests) the queue URL
    is not needed; on `sqs` it must be configured."""
    workload = WORKLOADS.get(kind)
    if workload is None:
        return None
    if variant is None:
        controls = workload.controls
    else:
        names = dict(workload.variants) or {"": workload.controls[0]}
        if variant not in names:
            return WORKLOAD_DISABLED
        controls = (names[variant],)
    if not any(_on(name) for name in controls):
        return WORKLOAD_DISABLED
    mode = backend if backend is not None else settings.LAI_JOBS_BACKEND
    if mode == "sqs" and not getattr(settings, workload.queue_setting, ""):
        return WORKLOAD_QUEUE_MISSING
    return None


def workload_enabled(kind: str, *, variant: str | None = None) -> bool:
    """True when `kind` can be submitted now: not a workload, or its control is on and (sqs)
    its queue URL is configured. The jobs backend must also be on (not `disabled`)."""
    if settings.LAI_JOBS_BACKEND == "disabled" and is_workload(kind):
        return False
    return refusal_code(kind, variant=variant) is None


def queue_url(kind: str) -> str:
    """The configured queue URL of a workload kind ('' when unset)."""
    return getattr(settings, WORKLOADS[kind].queue_setting, "")


def thumbnail_capture_enabled() -> bool:
    """`LAI_THUMBNAIL_CAPTURE == "on"`: the staff browser GLB thumbnail capture (no job)."""
    return _on("LAI_THUMBNAIL_CAPTURE")


def submit_workload(
    kind: str,
    payload: dict,
    *,
    variant: str | None = None,
    user=None,
    subject=None,
    job_id=None,
    idempotency_key: str = "",
):
    """Submit a workload job through the one canonical path, or raise.

    Raises `services.WorkloadUnavailable` (code `workload_disabled` or
    `workload_queue_not_configured`, safe message in `.message`) when the control is off or the
    queue is not configured, `services.JobsDisabled` when the jobs backend is disabled, and
    `JobsError` for a malformed payload. Nothing is recorded or queued when it raises. Call it
    inside the caller's transaction (under the source asset lock); the message is sent after the
    surrounding transaction commits (the outbox)."""
    from . import services

    if kind not in WORKLOADS:
        raise services.JobsError("unknown_kind")
    services.require_workload(kind, variant=variant)
    return services.submit(
        kind,
        payload,
        user=user,
        subject=subject,
        job_id=job_id,
        idempotency_key=idempotency_key,
    )
