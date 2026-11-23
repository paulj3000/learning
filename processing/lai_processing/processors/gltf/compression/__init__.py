"""Compressed glTF support (ADR-070): the support policy table and per-extension validation.

Self-contained and standard library only. Nothing here is wired into `document.py` or Django's
`validation.py` yet: the GLB extension policy belongs to Workstream B, and the principal wires
these functions into B's table at integration (`docs/processing/GLB_OPTIMIZATION.md`).

- `policy`: `compression_support(extension) -> SupportStatus` and the gating controls
  `LAI_GLB_MESHOPT` and `LAI_GLB_KTX2` (default off).
- `meshopt`: `validate_meshopt(document, sink, ...)` for `EXT_meshopt_compression`.
- `ktx2`: `validate_basisu(document, sink, read_image=...)` and `parse_ktx2(data, sink)` for
  `KHR_texture_basisu`.
"""

from .ktx2 import BASISU_EXTENSION, Ktx2Facts, ktx2_image_indices, parse_ktx2, validate_basisu
from .meshopt import MESHOPT_EXTENSION, MeshoptFacts, fallback_buffer_indices, validate_meshopt
from .policy import (
    KTX2_CONTROL,
    MESHOPT_CONTROL,
    CompressionPolicy,
    SupportStatus,
    compression_allowed,
    compression_policy,
    compression_support,
    enabled_controls,
)

__all__ = [
    "BASISU_EXTENSION",
    "Ktx2Facts",
    "ktx2_image_indices",
    "parse_ktx2",
    "validate_basisu",
    "KTX2_CONTROL",
    "MESHOPT_CONTROL",
    "MESHOPT_EXTENSION",
    "CompressionPolicy",
    "MeshoptFacts",
    "SupportStatus",
    "compression_allowed",
    "compression_policy",
    "compression_support",
    "enabled_controls",
    "fallback_buffer_indices",
    "validate_meshopt",
]
