"""One call from source bytes to reviewed outputs and a value-free report."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from .decode import DecodedImage, decode_image
from .encode import EncodedImage, encode
from .errors import ImageError
from .prepare import PreparedImage, prepare_texture
from .profiles import ImageProfile

PROCESSOR = "lai-native-image"
PROCESSOR_VERSION = "1"
MAX_OUTPUTS = 4
MAX_TOTAL_OUTPUT_BYTES = 16 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class ConvertedOutput:
    profile: ImageProfile
    image: EncodedImage
    plan: dict
    findings: tuple[str, ...]

    def summary(self) -> dict:
        """JSON-safe, value-free description of this output."""
        return {
            "logicalId": self.profile.name,
            "profile": self.profile.reference,
            "format": self.image.format,
            "contentType": self.image.content_type,
            "width": self.image.width,
            "height": self.image.height,
            "sizeBytes": self.image.size_bytes,
            "sha256": self.image.sha256,
            "sanitized": self.image.sanitized,
            "colour": self.plan.get("colour", {}),
            "alphaAction": self.plan.get("alphaAction", "none"),
            "orientationApplied": self.plan.get("orientationApplied", 0),
            "resized": bool(self.plan.get("resized")),
        }


@dataclass(frozen=True, slots=True)
class ConversionReport:
    source: dict
    outputs: tuple[ConvertedOutput, ...]
    findings: tuple[str, ...] = field(default_factory=tuple)

    def as_dict(self) -> dict:
        return {
            "processor": {"name": PROCESSOR, "version": PROCESSOR_VERSION},
            "source": self.source,
            "outputs": [output.summary() for output in self.outputs],
            "findings": list(self.findings),
        }


def convert_image(data: bytes, profile: ImageProfile) -> ConvertedOutput:
    """One output. Raises `ImageError`."""
    return convert_many(data, [profile]).outputs[0]


def source_facts(decoded: DecodedImage) -> dict:
    """Value-free facts about the source (flags, sizes, orientation number)."""
    return {
        "format": decoded.format,
        "width": decoded.width,
        "height": decoded.height,
        **{
            key: decoded.facts[key]
            for key in (
                "mode",
                "orientation",
                "animated",
                "bitDepth",
                "exifPresent",
                "gpsPresent",
                "xmpPresent",
                "iccPresent",
                "textPresent",
                "iptcPresent",
            )
        },
    }


def convert_many(data: bytes, profiles: Sequence[ImageProfile]) -> ConversionReport:
    """Decode once, then prepare and encode each profile. Order and bytes are deterministic."""
    if not 1 <= len(profiles) <= MAX_OUTPUTS:
        raise ImageError("invalid_profile")
    decoded = decode_image(
        data,
        first_frame_only=all(p.first_frame_only for p in profiles),
        apply_orientation=not any(p.ignore_orientation for p in profiles),
    )
    return convert_decoded(decoded, profiles)


def convert_decoded(decoded: DecodedImage, profiles: Sequence[ImageProfile]) -> ConversionReport:
    """Prepare and encode each profile from an already decoded image."""
    if not 1 <= len(profiles) <= MAX_OUTPUTS:
        raise ImageError("invalid_profile")
    outputs: list[ConvertedOutput] = []
    total = 0
    for profile in profiles:
        prepared: PreparedImage = prepare_texture(decoded, profile)
        encoded = encode(prepared)
        plan, findings = prepared.plan, tuple(prepared.findings)
        del prepared  # release the intermediate before the next profile
        total += encoded.size_bytes
        if total > MAX_TOTAL_OUTPUT_BYTES:
            raise ImageError("output_too_large")
        outputs.append(ConvertedOutput(profile, encoded, plan, findings))
    merged = tuple(sorted({code for output in outputs for code in output.findings}))
    return ConversionReport(source=source_facts(decoded), outputs=tuple(outputs), findings=merged)
