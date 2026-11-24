"""The `asset.optimize` contract constants Django and the worker share (ADR-070).

Standard library only, so Django (submission, the processor-version resolver, the Admin
actions) and the native worker (`lai_native.optimize.engine`) read the same processor identity,
profiles and limits without Django importing native code.
"""

from __future__ import annotations

from types import MappingProxyType
from typing import Final

from ....core.limits import MIB, ResourceLimits
from ..extension_policy import KTX2_CONTROL, MESHOPT_CONTROL

__all__ = [
    "JOB_TYPE",
    "OPTIMIZE_LIMITS",
    "PROCESSOR_ID",
    "PROCESSOR_VERSION",
    "VARIANTS",
    "Variant",
    "processor_for",
    "variant_for_profile",
]

JOB_TYPE: Final = "asset.optimize"
PROCESSOR_ID: Final = "asset.glb_optimizer"
#: Bump when the optimizer's behaviour changes (a profile flag, the preservation rules): earlier
#: results become `processor_outdated` when Django records them.
PROCESSOR_VERSION: Final = "1.0.0"

#: Roles the optimizer writes (declared in `contracts.job_types`, `_OPTIMIZE_ROLES`).
ROLE_MODEL: Final = "model.optimized"
ROLE_REPORT: Final = "model.optimize_report"

#: One budget for both profiles. The GLB ceiling is 50 MiB; the `model.optimized` role bound is
#: 32 MiB; the report role is 64 KiB. 840 s is the platform ceiling (Lambda 900 s less margin).
OPTIMIZE_LIMITS: Final = ResourceLimits(
    max_input_bytes=50 * MIB,
    max_output_bytes=32 * MIB + 64 * 1024,
    max_execution_seconds=840,
    max_temp_bytes=600 * MIB,
    max_artifact_count=2,
    max_metadata_bytes=48 * 1024,
    max_message_bytes=64 * 1024,
)


class Variant:
    __slots__ = ("control", "label", "name", "profile")

    def __init__(self, name: str, profile: tuple[str, int], control: str, label: str) -> None:
        self.name = name
        self.profile = profile
        self.control = control
        self.label = label


#: `variant` (the `submit_workload(variant=...)` name) -> profile and control.
VARIANTS: Final = MappingProxyType(
    {
        "meshopt": Variant("meshopt", ("meshopt-conservative", 1), MESHOPT_CONTROL, "Meshopt"),
        "ktx2": Variant("ktx2", ("ktx2-basisu", 1), KTX2_CONTROL, "KTX2"),
    }
)


def variant_for_profile(profile_id: str, profile_version: int) -> Variant | None:
    for variant in VARIANTS.values():
        if variant.profile == (profile_id, profile_version):
            return variant
    return None


def processor_for(profile_id: str, profile_version: int) -> tuple[str, str] | None:
    """`artifact_results.PROCESSOR_VERSION_RESOLVERS["asset.optimize"]`."""
    if variant_for_profile(profile_id, profile_version) is None:
        return None
    return PROCESSOR_ID, PROCESSOR_VERSION
