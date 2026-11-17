"""GLB/glTF 2.0 validation and metadata extraction (LAI-LAMBDA-002), standard library only.

- `container`: the GLB header and chunk table.
- `jsonparse`: strict parsing of the JSON chunk.
- `document`: structure, reference, limit and policy checks (`validate_glb`).
- `images`: texture signatures and dimensions from image headers.
- `metadata`: the deterministic metadata object.
- `processor`: the `asset.glb_validator` processor and its `glb-default` profile.

See `docs/processing/GLB_VALIDATION.md`.
"""

from .document import GlbSettings, ValidationOutcome, validate_glb
from .processor import GLB_PROFILE, GLB_REPORT_TYPE, GlbValidatorProcessor

__all__ = [
    "GLB_PROFILE",
    "GLB_REPORT_TYPE",
    "GlbSettings",
    "GlbValidatorProcessor",
    "ValidationOutcome",
    "validate_glb",
]
