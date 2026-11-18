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
- `KHR_meshopt_compression` is the Khronos successor name. Its specification is a **Release
  Candidate**, not ratified (read 2026-11-18); gltfpack 1.3 emits it with `-ce khr` or `-cz`,
  and three 0.185.1 would decode it, but its v1 bitstream and `COLOR` filter are not covered by
  the validators, so it is rejected as its own entry. Do not alias one to the other.

Compression the game can decode (ADR-070) is `Support.WHEN_ENABLED`: accepted only while its
feature control is `on` (`CONTROLS`), otherwise refused exactly like `DECODER` (`needs_decoder`).
The controls are Django settings (`LAI_GLB_MESHOPT`, `LAI_GLB_KTX2`, default off). Django passes
the enabled set to its own validator and, in the `asset.validate_model` request options
(`allow_meshopt`, `allow_ktx2`), to the processor, which never reads the environment. When a
row changes verdict, bump `POLICY_VERSION` and the processor version in `processor.py` together.
"""

from __future__ import annotations

from collections.abc import Collection
from enum import StrEnum
from typing import Final


class Support(StrEnum):
    SUPPORTED = "supported"  # GLTFLoader handles it with no extra decoder
    DECODER = "decoder"  # compression: needs a decoder the game does not load
    REJECTED = "rejected"  # known, but the game cannot render it safely
    WHEN_ENABLED = (
        "supported_when_enabled"  # decoder shipped; accepted only while its control is on
    )


#: Bumped whenever a row changes verdict. The GLB processor version moves with it. Version 3
#: (unreleased until this branch ships, so it carries all ADR-070 changes together): the
#: compression rows below and the three material extensions three 0.185.1 renders.
POLICY_VERSION: Final = 3

#: Error codes that come only from this table (a policy decision, not the file's integrity).
#: A version whose stored bytes are unchanged but which fails only with these is REFUSED for
#: publication, never rejected (`apps.assets.services`).
POLICY_ERROR_CODES: Final = frozenset({"needs_decoder", "unsupported_extension"})

#: The feature control (a Django setting, `on`/`off`) of each `WHEN_ENABLED` extension.
MESHOPT_CONTROL: Final = "LAI_GLB_MESHOPT"
KTX2_CONTROL: Final = "LAI_GLB_KTX2"
CONTROLS: Final[dict[str, str]] = {
    "EXT_meshopt_compression": MESHOPT_CONTROL,
    "KHR_texture_basisu": KTX2_CONTROL,
}

#: Every row here is implemented by three 0.185.1 `GLTFLoader` (its `EXTENSIONS` table and
#: registered plugins) and needs no decoder; `KHR_materials_variants` is accepted and ignored by
#: the loader (the default material renders).
_SUPPORTED: Final = (
    "EXT_materials_bump",
    "KHR_lights_punctual",
    "KHR_materials_anisotropy",
    "KHR_materials_clearcoat",
    "KHR_materials_dispersion",
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

#: Compression extensions the game cannot decode (error code `needs_decoder`, always).
_DECODER: Final = (
    "KHR_draco_mesh_compression",  # Draco is out of scope (no Draco decoder, ever, by decision)
    "KHR_meshopt_compression",  # Release Candidate; not validated (see module docstring)
)

#: Compression the loader decodes (ADR-070): accepted only while its control is on.
_WHEN_ENABLED: Final = (
    "EXT_meshopt_compression",  # three.js MeshoptDecoder, bundled; LAI_GLB_MESHOPT
    "KHR_texture_basisu",  # KTX2Loader with the bundled Basis transcoder; LAI_GLB_KTX2
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
    **dict.fromkeys(_WHEN_ENABLED, Support.WHEN_ENABLED),
    **dict.fromkeys(_REJECTED, Support.REJECTED),
}

SUPPORTED_EXTENSIONS: Final = frozenset(n for n, s in TABLE.items() if s is Support.SUPPORTED)
#: Every compression extension that needs a decoder (refused unless enabled, or always).
NEEDS_DECODER: Final = frozenset(
    n for n, s in TABLE.items() if s in (Support.DECODER, Support.WHEN_ENABLED)
)


def classify(name: str) -> Support | None:
    """The policy row for `name`, or None when the extension is not listed (rejected too)."""
    return TABLE.get(name)


def enabled_extensions(enabled: Collection[str]) -> frozenset[str]:
    """The `WHEN_ENABLED` extensions whose control is in `enabled` (control names)."""
    return frozenset(name for name, control in CONTROLS.items() if control in enabled)


def error_code(name: str, enabled: Collection[str] = frozenset()) -> str | None:
    """The validation error code for `name`, or None when it is supported.

    `enabled` holds the feature controls that are on (`LAI_GLB_MESHOPT`, `LAI_GLB_KTX2`). A
    `WHEN_ENABLED` extension is supported only while its control is in it. Otherwise
    `needs_decoder` for compression and `unsupported_extension` for everything else, listed or
    not, whether the model requires the extension or only uses it."""
    status = TABLE.get(name)
    if status is Support.SUPPORTED:
        return None
    if status is Support.WHEN_ENABLED:
        return None if CONTROLS[name] in enabled else "needs_decoder"
    return "needs_decoder" if status is Support.DECODER else "unsupported_extension"
