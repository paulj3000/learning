"""GLB optimization jobs in Django (ADR-070): submission, processor version, promotion gate.

- `submit_optimization(version, variant, user)`: staff-triggered `asset.optimize` through the
  shared `artifact_jobs.submit_derived_job` (variant `meshopt` or `ktx2`), refused unless that
  variant's control is on (`LAI_GLB_MESHOPT`, `LAI_GLB_KTX2`) and the source is a validated or
  published GLB version that does not already use compression. Never changes the version.
- `register()` (from `AssetsConfig.ready`) records the optimizer's processor version for
  `artifact_results`, so a result from an older optimizer build is `processor_outdated`.
- `promotion_refusal(artifact)`: an optimized model is promoted (A's `promote_artifact`) only
  while its variant's control is on, because the promoted GLB must pass the validators, which
  accept the compression only then.
- `facts_rows(artifact)`: the report facts Django Admin shows (sizes, texture formats, GPU memory
  estimate, preservation).

Django never imports native code: the shared constants come from the standard-library
`lai_processing.processors.gltf.compression.optimize_contract`.
"""

import logging

from lai_processing.processors.gltf.compression.optimize_contract import (
    JOB_TYPE,
    OPTIMIZE_LIMITS,
    PROCESSOR_VERSION,
    ROLE_MODEL,
    VARIANTS,
    processor_for,
    variant_for_profile,
)

logger = logging.getLogger("lai.assets")

KIND = JOB_TYPE


class OptimizeRefused(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(code)
        self.code = code
        self.message = message


def register() -> None:
    from . import artifact_results

    artifact_results.PROCESSOR_VERSION_RESOLVERS[JOB_TYPE] = processor_for


def variant_enabled(variant: str) -> bool:
    from apps.jobs.workloads import workload_enabled

    return variant in VARIANTS and workload_enabled(KIND, variant=variant)


def submission_refusal(version, variant: str) -> OptimizeRefused | None:
    """Why `version` may not be optimized with `variant` now, or None."""
    from apps.catalog.models import AssetStatus

    from .models import ModelFormat, VersionStatus
    from .services import compressed_extensions

    if variant not in VARIANTS:
        return OptimizeRefused("unknown_variant", "Unknown optimization.")
    label = VARIANTS[variant].label
    if not variant_enabled(variant):
        return OptimizeRefused(
            "optimization_disabled", f"{label} optimization is switched off on this server."
        )
    if version.asset.status != AssetStatus.ACTIVE:
        return OptimizeRefused("asset_retired", "This asset is retired.")
    if version.format != ModelFormat.GLB:
        return OptimizeRefused("not_glb", "Only GLB models can be optimized.")
    if version.status not in (VersionStatus.VALIDATED, VersionStatus.PUBLISHED):
        return OptimizeRefused(
            "not_validated", "Only a validated or published version can be optimized."
        )
    if compressed_extensions(version) or "KHR_mesh_quantization" in (
        (version.metadata or {}).get("extensionsUsed") or []
    ):
        return OptimizeRefused(
            "already_compressed", "This version is already compressed or quantized."
        )
    return None


def submit_optimization(version, variant: str, *, user=None):
    """Submit (or return) the optimization job. Raises `OptimizeRefused`, or the jobs errors of
    `submit_derived_job` (`WorkloadUnavailable`, `JobsDisabled`, `JobsError`)."""
    from .artifact_jobs import submit_derived_job

    refusal = submission_refusal(version, variant)
    if refusal is not None:
        raise refusal
    job = submit_derived_job(
        version,
        kind=KIND,
        profile=VARIANTS[variant].profile,
        processor_version=PROCESSOR_VERSION,
        limits=OPTIMIZE_LIMITS,
        variant=variant,
        user=user,
    )
    logger.info("optimize job submitted job=%s variant=%s", job.pk, variant)
    return job


def promotion_refusal(artifact):
    """An optimized model may be promoted only while its variant's control is on."""
    from .services import AssetActionRefused

    if artifact.role != ROLE_MODEL:
        return None
    variant = variant_for_profile(artifact.profile_id, artifact.profile_version)
    if variant is None:
        return AssetActionRefused("profile_unknown", "This optimized model has an unknown profile.")
    if not variant_enabled(variant.name):
        return AssetActionRefused(
            "compression_disabled",
            f"{variant.label} is switched off, so the optimized model would not pass validation. "
            "Turn the setting on before promoting it.",
        )
    return None


#: (fact key, label, kind) shown for an optimized model in Django Admin.
_ROWS = (
    ("variant", "Optimization", "text"),
    ("source_bytes", "Original size", "bytes"),
    ("output_bytes", "Optimized size", "bytes"),
    ("size_ratio", "Optimized / original", "ratio"),
    ("texture_formats", "Texture formats", "text"),
    ("gpu_bytes_before", "Texture GPU memory before (calculated)", "bytes"),
    ("gpu_bytes_after", "Texture GPU memory after (calculated)", "bytes"),
    ("triangles", "Triangles", "int"),
    ("animation_clips", "Animation clips", "int"),
    ("preserved", "Hierarchy, materials, skins and clips preserved", "bool"),
    ("extensions", "Required extensions", "text"),
)


def facts_rows(artifact) -> list[tuple[str, str]]:
    """Label and display value for each optimization fact on an artifact row (empty for any
    other artifact). Values are numbers, booleans or short code-like strings."""
    if artifact.role != ROLE_MODEL:
        return []
    facts = artifact.metadata or {}
    rows = []
    for key, label, kind in _ROWS:
        if key not in facts:
            continue
        value = facts[key]
        if kind == "bytes" and isinstance(value, int | float):
            text = f"{int(value):,} bytes ({value / 1048576:.2f} MiB)"
        elif kind == "ratio" and isinstance(value, int | float):
            text = f"{value:.1%}"
        elif kind == "bool":
            text = "Yes" if value is True else "No"
        else:
            text = str(value)
        rows.append((label, text))
    return rows
