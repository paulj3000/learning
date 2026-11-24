"""The Django side of the processing release check (ADR-071, docs/processing/PROCESSING_RELEASE.md).

`build_report()` is what `manage.py processing_release_check --json` prints: facts only (booleans
for URLs, never a URL, id or secret). `failures(report)` are the safe reasons a control that is
`on` violates the RELEASE invariant: results the consumer cannot apply, no queue URL, a kind the
release manifest does not list, pending migrations, no artifact storage. A control that is off
never fails the check; `scripts/release/processing_release.py check-enable` decides per control
before it is switched on. Changes nothing.
"""

from importlib import import_module

from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from . import workloads
from .core import envelope

SCHEMA_VERSION = 1
CONTROLS = (
    "LAI_AUDIO_TRANSCODING",
    "LAI_IMAGE_CONVERSION",
    "LAI_GLB_MESHOPT",
    "LAI_GLB_KTX2",
    "LAI_THUMBNAIL_CAPTURE",
    "LAI_ASSET_ASYNC_VALIDATION",
)
QUEUE_SETTINGS = (
    "LAI_JOBS_AI_QUEUE_URL",
    "LAI_JOBS_MEDIA_QUEUE_URL",
    *(w.queue_setting for w in workloads.WORKLOADS.values()),
)


def result_kinds() -> list[str]:
    """Kinds whose registered handler module imports and defines `apply`."""
    from .services import HANDLER_MODULES

    found = []
    for kind, module in sorted(HANDLER_MODULES.items()):
        try:
            if callable(getattr(import_module(module), "apply", None)):
                found.append(kind)
        except ImportError:
            continue
    return found


def pending_migrations() -> list[str]:
    executor = MigrationExecutor(connection)
    plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
    return sorted(f"{m.app_label}.{m.name}" for m, _backwards in plan)


def artifact_storage_configured() -> bool:
    """The artifact prefix is usable: a valid namespace, and storage that is not unset. In
    production (`s3`) that means a bucket and region; local and memory stores need nothing."""
    from apps.assets.processing import namespace
    from lai_processing.contracts.identifiers import NAMESPACE

    if not NAMESPACE.fullmatch(namespace()):
        return False
    backend = getattr(settings, "LAI_ASSET_STORAGE", "local")
    if backend == "s3":
        return bool(getattr(settings, "LAI_ASSET_BUCKET", "") and settings.LAI_ASSET_REGION)
    return backend in ("local", "memory")


def build_report() -> dict:
    from apps.assets.processing import namespace

    released = workloads.released_kinds()
    return {
        "schema_version": SCHEMA_VERSION,
        "environment": namespace(),
        "git_sha": getattr(settings, "LAI_RELEASE_SHA", ""),
        "jobs_backend": settings.LAI_JOBS_BACKEND,
        "result_kinds": result_kinds(),
        "submittable_kinds": sorted(envelope.KIND_QUEUE),
        "controls": {name: getattr(settings, name, "off") for name in CONTROLS},
        "queue_urls_configured": {
            name: bool(getattr(settings, name, "")) for name in QUEUE_SETTINGS
        },
        "pending_migrations": pending_migrations(),
        "artifact_storage_configured": artifact_storage_configured(),
        "manifest_configured": released is not None,
        "manifest_kinds": sorted(released) if released is not None else [],
    }


def failures(report: dict) -> list[str]:
    """Safe reasons the current configuration would emit an incompatible message. Empty when
    every control is off and nothing is pending, or when every enabled control is ready."""
    reasons: list[str] = []
    enabled = [name for name, value in report["controls"].items() if value == "on"]
    if not enabled:
        return reasons
    if report["pending_migrations"]:
        reasons.append("migrations are pending")
    if not report["artifact_storage_configured"]:
        reasons.append("the artifact storage prefix is not configured")
    for name in enabled:
        reasons.extend(_control_failures(name, report))
    return reasons


def _control_failures(name: str, report: dict) -> list[str]:
    reasons: list[str] = []
    if name == "LAI_THUMBNAIL_CAPTURE":
        return reasons
    if name == "LAI_ASSET_ASYNC_VALIDATION":
        kind, queue_setting = envelope.ASSET_VALIDATE_MODEL, "LAI_JOBS_MEDIA_QUEUE_URL"
    else:
        workload = next(w for w in workloads.WORKLOADS.values() if name in w.controls)
        kind, queue_setting = workload.kind, workload.queue_setting
    if report["jobs_backend"] != "sqs":
        reasons.append(f"{name}: the jobs backend is not sqs")
    if kind not in report["result_kinds"]:
        reasons.append(f"{name}: Django cannot apply results of {kind}")
    if kind not in report["submittable_kinds"]:
        reasons.append(f"{name}: {kind} is not registered for submission")
    if not report["queue_urls_configured"].get(queue_setting):
        reasons.append(f"{name}: {queue_setting} is not configured")
    if (
        report["manifest_configured"]
        and kind in workloads.WORKLOADS
        and kind not in report["manifest_kinds"]
    ):
        reasons.append(f"{name}: the release manifest does not list {kind}")
    return reasons
