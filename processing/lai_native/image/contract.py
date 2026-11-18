"""The `asset.convert_image` contract declarations. Pure Python (no Pillow), so Django imports
this module for the processor version, the limits and the profile table, and the worker imports
it for the engine.

Three contract profiles, each a staff action in the Asset Library:

| Profile (v1) | Staff action | Role | Logical ids |
|---|---|---|---|
| `image-convert` | Convert image | `image.converted` | `converted` |
| `image-resize` | Resize image | `image.resized` | `resized` |
| `image-thumbnails` | Generate thumbnail | `image.thumbnail` | `thumb-128`, `-256`, `-512` |

The options of a profile are the only knobs: they select one of the named `ImageProfile`s of
`profiles.py` and narrow it (`plan`).
"""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

from lai_processing.contracts.profiles import OptionSpec, ProcessingProfile
from lai_processing.core.limits import MIB, ResourceLimits

from .errors import ImageError
from .limits import MAX_IMAGE_SIDE
from .profiles import ImageProfile, get_profile

JOB_TYPE: Final = "asset.convert_image"
PROCESSOR_ID: Final = "asset.image_converter"
#: Semver of the processor. A change in output bytes (Pillow upgrade, profile behaviour) is a new
#: version; Django treats a result from an older processor as `processor_outdated`.
PROCESSOR_VERSION: Final = "1.0.0"

ROLE_CONVERTED: Final = "image.converted"
ROLE_RESIZED: Final = "image.resized"
ROLE_THUMBNAIL: Final = "image.thumbnail"

PROFILE_CONVERT: Final = ("image-convert", 1)
PROFILE_RESIZE: Final = ("image-resize", 1)
PROFILE_THUMBNAILS: Final = ("image-thumbnails", 1)

#: What a job may use (the request carries these; the worker clamps them to its ceilings). 60 s
#: inside the function's 120 s timeout (ADR-068 O-1).
IMAGE_LIMITS: Final = ResourceLimits(
    max_input_bytes=10 * MIB,
    max_output_bytes=16 * MIB,
    max_execution_seconds=60,
    max_temp_bytes=64 * MIB,
    max_artifact_count=4,
    max_metadata_bytes=32 * 1024,
    max_message_bytes=64 * 1024,
)

FORMATS: Final = ("png", "jpeg", "webp")
_COMMON = {
    "purpose": OptionSpec("str", default="artwork", choices=("artwork", "data")),
    "quality": OptionSpec("int", default=85, minimum=1, maximum=100),
    "lossless": OptionSpec("bool", default=False),
    "power_of_two": OptionSpec("bool", default=False),
    # `#rrggbb`, or empty for the profile default (white); only used for JPEG output.
    "flatten_background": OptionSpec("str", default=""),
}
_PROFILES: Final = (
    ProcessingProfile(
        profile_id=PROFILE_CONVERT[0],
        version=PROFILE_CONVERT[1],
        job_type=JOB_TYPE,
        description="Convert an image to PNG, JPEG or WebP at its own size, metadata removed.",
        options={
            **_COMMON,
            "target_format": OptionSpec("str", default="webp", choices=FORMATS),
        },
        limits=IMAGE_LIMITS,
    ),
    ProcessingProfile(
        profile_id=PROFILE_RESIZE[0],
        version=PROFILE_RESIZE[1],
        job_type=JOB_TYPE,
        description="Resize an image to fit within a side length, metadata removed.",
        options={
            **_COMMON,
            "max_side": OptionSpec("int", default=1024, minimum=16, maximum=MAX_IMAGE_SIDE),
            "target_format": OptionSpec("str", default="source", choices=(*FORMATS, "source")),
        },
        limits=IMAGE_LIMITS,
    ),
    ProcessingProfile(
        profile_id=PROFILE_THUMBNAILS[0],
        version=PROFILE_THUMBNAILS[1],
        job_type=JOB_TYPE,
        description="Make 128, 256 and 512 pixel WebP thumbnails, metadata removed.",
        options={},
        limits=IMAGE_LIMITS,
    ),
)
PROFILE_DECLARATIONS: Final = MappingProxyType({(p.profile_id, p.version): p for p in _PROFILES})


def profiles() -> tuple[ProcessingProfile, ...]:
    return _PROFILES


def current_processor(profile_id: str, profile_version: int) -> tuple[str, str] | None:
    """The processor this build expects for a profile (the Django resolver); None when unknown."""
    if (profile_id, profile_version) not in PROFILE_DECLARATIONS:
        return None
    return PROCESSOR_ID, PROCESSOR_VERSION


@dataclass(frozen=True, slots=True)
class PlannedOutput:
    logical_id: str
    role: str
    profile: ImageProfile


def plan(profile: tuple[str, int], options: dict, source_format: str) -> tuple[PlannedOutput, ...]:
    """The outputs for a contract profile and its resolved options. Raises `ImageError`."""
    if profile == PROFILE_THUMBNAILS:
        return tuple(
            PlannedOutput(f"thumb-{side}", ROLE_THUMBNAIL, get_profile(f"thumbnail-{side}"))
            for side in (128, 256, 512)
        )
    if profile not in (PROFILE_CONVERT, PROFILE_RESIZE) or source_format not in FORMATS:
        raise ImageError("invalid_profile")
    resize = profile == PROFILE_RESIZE
    target = options.get("target_format", "source" if resize else "webp")
    if target == "source":
        target = source_format
    data = options.get("purpose", "artwork") == "data"
    lossless = bool(options.get("lossless", False))
    if data:
        base = {"png": "texture-data-png", "webp": "texture-data-webp"}.get(target)
    else:
        base = {
            "png": "convert-png",
            "jpeg": "convert-jpeg",
            "webp": "convert-webp-lossless" if lossless else "convert-webp",
        }.get(target)
    if base is None:
        raise ImageError("invalid_profile")  # data textures are never lossy or JPEG
    overrides: dict = {"quality": options.get("quality", 85)}
    if options.get("power_of_two"):
        overrides["power_of_two"] = True
    if resize:
        overrides["max_side"] = options.get("max_side", 1024)
    background = options.get("flatten_background") or ""
    if background and target == "jpeg":
        overrides["flatten_background"] = background
    image_profile = get_profile(base).with_options(**overrides)
    return (
        PlannedOutput(
            "resized" if resize else "converted",
            ROLE_RESIZED if resize else ROLE_CONVERTED,
            image_profile,
        ),
    )
