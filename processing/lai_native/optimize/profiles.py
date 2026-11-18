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

__all__ = [
    "MESHOPT_CONSERVATIVE",
    "PROFILES",
    "OptimizeProfile",
    "gltfpack_argv",
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
    #: Hard limit for one tool run.
    timeout_s: float = 300.0
    #: Bound on captured stdout/stderr.
    max_output_bytes: int = 64 * 1024
    #: What the textures may become (see `signature.compare_signatures`).
    textures: Literal["identical", "ktx2"] = "identical"

    @property
    def label(self) -> str:
        return f"{self.name}/v{self.version}"


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
)

PROFILES: dict[str, OptimizeProfile] = {MESHOPT_CONSERVATIVE.name: MESHOPT_CONSERVATIVE}


def gltfpack_argv(
    profile: OptimizeProfile, source: str = SOURCE_NAME, output: str = OUTPUT_NAME
) -> list[str]:
    """The gltfpack arguments (without the executable) for `profile`."""
    return ["-i", source, "-o", output, *profile.gltfpack_flags]
