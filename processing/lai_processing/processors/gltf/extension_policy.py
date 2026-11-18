"""The glTF extension support policy: ONE table, used by both GLB validators.

`lai/apps/assets/validation.py` (Django's synchronous validator, also used for `.gltf`) and
`lai_processing.processors.gltf.document` (the asynchronous `asset.validate_model` processor)
both import `classify` from here, so the two can never disagree about an extension. Standard
library only.

Reasoning (owner approval 2026-11-18, "reject unsupported compression extensions"): an extension
named in `extensionsUsed` is not harmless merely because it is optional. A model that lists
`EXT_meshopt_compression` as used without requiring it can still carry buffer views that exist
only in compressed form, and a loader that has no decoder renders garbage or nothing. The same
holds for texture sources (`EXT_texture_webp`, `KHR_texture_basisu`, `EXT_texture_avif`) and for
instancing. So every extension the current game loader cannot safely support is an ERROR whether it
is required or only used, and an extension that is not in this table at all is an error too
(deny by default). The loader configures no decoder (`react/src/features/island-map/three/
assets`), so today only extensions GLTFLoader handles by itself are `SUPPORTED`.

Names are exact and case sensitive; similar names are distinct extensions:
- `EXT_meshopt_compression` is the extension three.js `MeshoptDecoder` and `gltfpack` use.
- `KHR_meshopt_compression` is the Khronos-ratified successor name. It is a different extension
  string, and this repository has NOT verified that gltfpack emits it or that the game's loader
  decodes it, so it is rejected as its own entry. Do not alias one to the other.

Workstream F flips a row to `Support.SUPPORTED` here (and only here) when its decoder is wired
into the game loader and verified. Doing so changes the validators' verdicts, so bump
`POLICY_VERSION` in the same change and the processor version in `processor.py`.
"""

from __future__ import annotations

from enum import Enum
from typing import Final


class Support(str, Enum):
    SUPPORTED = "supported"  # GLTFLoader handles it with no extra decoder
    DECODER = "decoder"  # compression: needs a decoder the game does not load
    REJECTED = "rejected"  # known, but the game cannot render it safely


#: Bumped whenever a row changes verdict. The GLB processor version moves with it.
POLICY_VERSION: Final = 2

_SUPPORTED: Final = (
    "KHR_lights_punctual",
    "KHR_materials_clearcoat",
    "KHR_materials_emissive_strength",
    "KHR_materials_ior",
    "KHR_materials_iridescence",
    "KHR_materials_sheen",
    "KHR_materials_specular",
    "KHR_materials_transmission",
    "KHR_materials_unlit",
    "KHR_materials_variants",
    "KHR_materials_volume",
    "KHR_mesh_quantization",
    "KHR_texture_transform",
)

#: Compression extensions (error code `needs_decoder`). Flip a row to SUPPORTED in `TABLE` only
#: after the loader has the matching decoder (Meshopt first, then KTX2: ADR-070).
_DECODER: Final = (
    "KHR_draco_mesh_compression",  # Draco is out of scope (no Draco decoder, ever, by decision)
    "EXT_meshopt_compression",  # three.js / gltfpack name; Workstream F enables this first
    "KHR_meshopt_compression",  # distinct Khronos name; unverified (see module docstring)
    "KHR_texture_basisu",  # KTX2 / Basis; Workstream F enables this second
)

#: Known extensions the game cannot render (error code `unsupported_extension`).
_REJECTED: Final = (
    "EXT_texture_webp",  # textures are PNG or JPEG only (see ALLOWED_IMAGE_TYPES)
    "EXT_texture_avif",
    "EXT_mesh_gpu_instancing",  # the game's scene graph does not create instanced meshes
)

TABLE: Final[dict[str, Support]] = {
    **dict.fromkeys(_SUPPORTED, Support.SUPPORTED),
    **dict.fromkeys(_DECODER, Support.DECODER),
    **dict.fromkeys(_REJECTED, Support.REJECTED),
}

SUPPORTED_EXTENSIONS: Final = frozenset(n for n, s in TABLE.items() if s is Support.SUPPORTED)
NEEDS_DECODER: Final = frozenset(n for n, s in TABLE.items() if s is Support.DECODER)


def classify(name: str) -> Support | None:
    """The policy row for `name`, or None when the extension is not listed (rejected too)."""
    return TABLE.get(name)


def error_code(name: str) -> str | None:
    """The validation error code for `name`, or None when it is supported.

    `needs_decoder` for compression, `unsupported_extension` for everything else, listed or not,
    whether the model requires the extension or only uses it."""
    status = TABLE.get(name)
    if status is Support.SUPPORTED:
        return None
    return "needs_decoder" if status is Support.DECODER else "unsupported_extension"
