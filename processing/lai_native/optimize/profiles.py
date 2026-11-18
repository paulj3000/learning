"""Optimization profiles and command construction (ADR-070).

A profile is a pinned, versioned tool configuration. Changing any flag is a new profile version,
so an optimize report always names exactly what produced its output.

`meshopt-conservative` v1 (gltfpack 1.3, flags read from the 1.3 source, `gltf/gltfpack.cpp`):

| Flag | Why |
|---|---|
| `-cc` | `EXT_meshopt_compression` with the higher-ratio attribute encoding |
| `-ce ext` | pin the ratified `EXT_` extension; `KHR_meshopt_compression` stays rejected |
| `-si 1` | no simplification (also gltfpack's default; stated so the report shows it) |
| `-kn` | keep named nodes: the game finds objects by name (`getObjectByName`) |
| `-km` | keep named materials, no material merging |
| `-ke` | keep `extras` |
| `-kv` | keep vertex attributes even if no material uses them |
| `-af 0` | no animation resampling: keyframe times stay the source's |
| `-ac` | keep constant animation tracks, so every channel survives |
| `-vpf` | float positions: no dequantization transform, so no node is inserted or moved |
| `-vtf` | float texture coordinates: no `KHR_texture_transform` is added to materials |

No texture flag: the Meshopt profile never touches images (checked by SHA-256 afterwards).
Measured on the repository NPC (workstation): the default `-cc` moves the skinned mesh under a
new unnamed node and adds a texture transform; this profile preserves both, at a few percent of
size (`docs/processing/GLB_OPTIMIZATION.md`, benchmarks).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal

from ..runtime import ToolLimits

__all__ = [
    "KTX2_BASISU",
    "MESHOPT_CONSERVATIVE",
    "PROFILES",
    "OptimizeProfile",
    "gltfpack_argv",
    "toktx_argv",
]

Kind = Literal["meshopt", "ktx2"]
#: Fixed file names inside the job's private working directory; never derived from input.
SOURCE_NAME: Final = "source.glb"
OUTPUT_NAME: Final = "output.glb"


@dataclass(frozen=True, slots=True)
class OptimizeProfile:
    name: str
    version: int
    kind: Kind
    gltfpack_flags: tuple[str, ...]
    #: Hard wall-clock limit for one tool run (also the CPU-seconds limit).
    timeout_s: float = 300.0
    #: What the textures may become (see `signature.compare_signatures`).
    textures: Literal["identical", "ktx2"] = "identical"
    #: The output may be at most this fraction of the source size (Meshopt: strictly smaller).
    max_size_ratio: float = 1.0
    #: toktx options for colour textures (sRGB) and data textures (normal, ORM; linear).
    toktx_color: tuple[str, ...] = ()
    toktx_data: tuple[str, ...] = ()
    #: The Workstream D image profile used to prepare textures before encoding.
    texture_profile: str = ""
    #: The pinned tool versions this profile was written and measured against
    #: (`native/gltf/tools.lock`); recorded in the result's `tool_versions`.
    tool_versions: tuple[tuple[str, str], ...] = ()

    @property
    def label(self) -> str:
        return f"{self.name}/v{self.version}"

    def limits(self) -> ToolLimits:
        """Limits for `lai_native.runtime.run_tool`, sized for the 50 MiB GLB ceiling: a file may
        be up to 4x the ceiling (quantization never grows a model that much; KTX2 is capped at
        1.5x), the workspace holds the source, the output and per-texture files."""
        return ToolLimits(
            timeout_seconds=self.timeout_s,
            cpu_seconds=int(self.timeout_s),
            address_space_bytes=2 * 1024 * 1024 * 1024,
            max_file_bytes=200 * 1024 * 1024,
            max_workspace_bytes=600 * 1024 * 1024,
        )


MESHOPT_CONSERVATIVE: Final = OptimizeProfile(
    name="meshopt-conservative",
    version=1,
    kind="meshopt",
    gltfpack_flags=(
        "-cc",
        "-ce",
        "ext",
        "-si",
        "1",
        "-kn",
        "-km",
        "-ke",
        "-kv",
        "-af",
        "0",
        "-ac",
        "-vpf",
        "-vtf",
    ),
    tool_versions=(("gltfpack", "1.3"),),
)

#: `ktx2-basisu` v1 (KTX-Software 4.4.2 `toktx`): ETC1S for colour (base colour, emissive),
#: assigned sRGB; UASTC with Zstandard level 18 for data (normal, occlusion,
#: metallic-roughness), assigned linear; full mip chains; BT.709 primaries; top-left origin
#: (toktx's default for PNG and JPEG, KTXorientation "rd"; no flip). Geometry, nodes and
#: materials are untouched; only images change. KTX2 does not shrink these files (feasibility and
#: section 10 of GLB_OPTIMIZATION.md); its win is GPU memory, so the size cap is 1.5x the source
#: and the step fails unless calculated GPU texture memory goes down.
KTX2_BASISU: Final = OptimizeProfile(
    name="ktx2-basisu",
    version=1,
    kind="ktx2",
    gltfpack_flags=(),
    timeout_s=600.0,
    textures="ktx2",
    max_size_ratio=1.5,
    toktx_color=(
        "--t2",
        "--encode",
        "etc1s",
        "--clevel",
        "1",
        "--qlevel",
        "128",
        "--assign_oetf",
        "srgb",
        "--assign_primaries",
        "bt709",
        "--genmipmap",
        "--threads",
        "1",
    ),
    toktx_data=(
        "--t2",
        "--encode",
        "uastc",
        "--uastc_quality",
        "2",
        "--zcmp",
        "18",
        "--assign_oetf",
        "linear",
        "--assign_primaries",
        "bt709",
        "--genmipmap",
        "--threads",
        "1",
    ),
    texture_profile="ktx2-source",
    tool_versions=(("toktx", "4.4.2"),),
)

PROFILES: dict[str, OptimizeProfile] = {
    MESHOPT_CONSERVATIVE.name: MESHOPT_CONSERVATIVE,
    KTX2_BASISU.name: KTX2_BASISU,
}


def gltfpack_argv(
    profile: OptimizeProfile, source: str = SOURCE_NAME, output: str = OUTPUT_NAME
) -> list[str]:
    """The gltfpack arguments (without the executable) for `profile`."""
    return ["-i", source, "-o", output, *profile.gltfpack_flags]


def toktx_argv(profile: OptimizeProfile, color: bool, source: str, output: str) -> list[str]:
    """toktx arguments (without the executable): options, then the output, then the input."""
    return [*(profile.toktx_color if color else profile.toktx_data), output, source]
