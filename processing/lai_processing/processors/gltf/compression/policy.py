"""Compression extension support policy (ADR-070), the table both GLB validators consult.

`compression_support(extension)` says how a glTF compression extension is treated:

- `SUPPORTED`: accepted with no decoder (today only `KHR_mesh_quantization`).
- `SUPPORTED_WHEN_ENABLED`: accepted only while its feature control is `on`
  (`LAI_GLB_MESHOPT` for `EXT_meshopt_compression`, `LAI_GLB_KTX2` for `KHR_texture_basisu`).
  Both controls default to `off`, so with no configuration these are still rejected.
- `REJECTED`: refused whatever the configuration (Draco, `KHR_meshopt_compression`, WebP and
  AVIF textures).
- `NOT_COMPRESSION`: not a compression extension; the validators' general extension table
  decides (for example `KHR_texture_transform`).

This module is a pure table. It never reads the environment: Django reads the two settings and
passes the enabled set (the processor receives it in the job's validation profile), so the
validator, the publication gate and the game see the same switch. Wiring into the validators'
extension policy is done at integration (Workstream B owns that table).
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Final

__all__ = [
    "COMPRESSION_POLICY",
    "KTX2_CONTROL",
    "MESHOPT_CONTROL",
    "CompressionPolicy",
    "SupportStatus",
    "compression_allowed",
    "compression_policy",
    "compression_support",
    "enabled_controls",
]

MESHOPT_CONTROL: Final = "LAI_GLB_MESHOPT"
KTX2_CONTROL: Final = "LAI_GLB_KTX2"
_CONTROLS: Final = (MESHOPT_CONTROL, KTX2_CONTROL)


class SupportStatus(StrEnum):
    SUPPORTED = "supported"
    SUPPORTED_WHEN_ENABLED = "supported_when_enabled"
    REJECTED = "rejected"
    NOT_COMPRESSION = "not_compression"


@dataclass(frozen=True, slots=True)
class CompressionPolicy:
    extension: str
    status: SupportStatus
    #: The feature control that enables a `SUPPORTED_WHEN_ENABLED` extension.
    control: str | None
    #: What the browser needs to load it (documentation; the loader is configured in react/src).
    decoder: str | None
    #: Why, for staff-facing documentation. Code-authored, never shown with file content.
    reason: str


_POLICIES: Final = (
    CompressionPolicy(
        "KHR_mesh_quantization",
        SupportStatus.SUPPORTED,
        None,
        None,
        "Quantized attributes load in three.js GLTFLoader with no decoder.",
    ),
    CompressionPolicy(
        "EXT_meshopt_compression",
        SupportStatus.SUPPORTED_WHEN_ENABLED,
        MESHOPT_CONTROL,
        "MeshoptDecoder (bundled three/examples/jsm/libs/meshopt_decoder.module.js)",
        "Ratified Khronos extension; owner approved Meshopt first (2026-11-18).",
    ),
    CompressionPolicy(
        "KHR_texture_basisu",
        SupportStatus.SUPPORTED_WHEN_ENABLED,
        KTX2_CONTROL,
        "KTX2Loader with the self-hosted Basis transcoder",
        "KTX2 with Basis Universal (ETC1S or UASTC); owner approved after Meshopt (2026-11-18).",
    ),
    CompressionPolicy(
        "KHR_meshopt_compression",
        SupportStatus.REJECTED,
        None,
        None,
        "Khronos status is Release Candidate (read 2026-11-18); its v1 bitstream and COLOR "
        "filter are not covered by the validators. Use EXT_meshopt_compression.",
    ),
    CompressionPolicy(
        "KHR_draco_mesh_compression",
        SupportStatus.REJECTED,
        None,
        None,
        "Draco is not approved (ADR-070); Meshopt covers geometry compression.",
    ),
    CompressionPolicy(
        "EXT_texture_webp",
        SupportStatus.REJECTED,
        None,
        None,
        "Texture formats other than PNG, JPEG and (when enabled) KTX2 are not approved.",
    ),
    CompressionPolicy(
        "EXT_texture_avif",
        SupportStatus.REJECTED,
        None,
        None,
        "Texture formats other than PNG, JPEG and (when enabled) KTX2 are not approved.",
    ),
)

COMPRESSION_POLICY: Final[Mapping[str, CompressionPolicy]] = MappingProxyType(
    {policy.extension: policy for policy in _POLICIES}
)


def compression_policy(extension: object) -> CompressionPolicy | None:
    """The policy row for a compression extension, or None for any other extension."""
    if not isinstance(extension, str):
        return None
    return COMPRESSION_POLICY.get(extension)


def compression_support(extension: object) -> SupportStatus:
    policy = compression_policy(extension)
    return SupportStatus.NOT_COMPRESSION if policy is None else policy.status


def compression_allowed(extension: object, enabled: Collection[str]) -> bool:
    """True when a compression extension may be accepted with the given enabled controls.

    Only meaningful for compression extensions; returns False for `NOT_COMPRESSION` so a caller
    cannot accidentally accept an unknown extension through this function.
    """
    policy = compression_policy(extension)
    if policy is None:
        return False
    if policy.status is SupportStatus.SUPPORTED:
        return True
    if policy.status is SupportStatus.SUPPORTED_WHEN_ENABLED:
        return policy.control in enabled
    return False


def enabled_controls(values: Mapping[str, object]) -> frozenset[str]:
    """The controls that are `on` in a settings-like mapping (`"on"`, `True`; anything else is
    off). Lets Django and tests build the enabled set the same way."""
    enabled: set[str] = set()
    for control in _CONTROLS:
        value = values.get(control)
        if value is True or (isinstance(value, str) and value.strip().lower() == "on"):
            enabled.add(control)
    return frozenset(enabled)
