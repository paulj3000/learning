"""The `asset.image_converter` processor: Pillow conversion plugged into the ADR-061 engine.

The engine owns the request checks, the verified input copy (size and SHA-256), limits, the
deadline, error classification, the result and the artifact key discipline. This module only
adapts: decode once, plan the outputs of the contract profile, convert them, write each as an
artifact through `ProcessingContext.write_artifact`, and publish value-free per-artifact facts
(`metadata["artifact_facts"][logical_id]`) that Django stores with the derived artifact.
"""

from __future__ import annotations

from typing import Final

from lai_processing.contracts.results import Finding, Severity, Verdict
from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.core.processor import ProcessingContext, Processor, ProcessorOutput

from . import contract
from .convert import convert_decoded
from .decode import decode_image
from .errors import ImageError
from .prepare import PreparedImage  # noqa: F401  (re-exported for texture callers)

_EXTENSIONS: Final = {"png": "png", "jpeg": "jpg", "webp": "webp"}

#: ImageError code -> (contract code, details reason). Reasons are fixed strings.
_MAP: Final = {
    "input_too_large": (ErrorCode.RESOURCE_LIMIT_EXCEEDED, "input_too_large"),
    "image_too_large": (ErrorCode.RESOURCE_LIMIT_EXCEEDED, "image_too_large"),
    "output_too_large": (ErrorCode.RESOURCE_LIMIT_EXCEEDED, "output_too_large"),
    "unsupported_format": (ErrorCode.UNSUPPORTED_INPUT, "unsupported_format"),
    "animated_not_supported": (ErrorCode.UNSUPPORTED_INPUT, "animated_not_supported"),
    "bit_depth_not_supported": (ErrorCode.UNSUPPORTED_INPUT, "bit_depth_not_supported"),
    "colour_mode_not_supported": (ErrorCode.UNSUPPORTED_INPUT, "colour_mode_not_supported"),
    "alpha_not_supported": (ErrorCode.UNSUPPORTED_INPUT, "alpha_not_supported"),
    "malformed_image": (ErrorCode.INVALID_INPUT, "malformed_image"),
    "colour_profile_invalid": (ErrorCode.INVALID_INPUT, "colour_profile_invalid"),
    "invalid_profile": (ErrorCode.INVALID_PROCESSING_PROFILE, "invalid_profile"),
    "output_check_failed": (ErrorCode.UNEXPECTED_FAILURE, "output_check_failed"),
    "pillow_unavailable": (ErrorCode.UNEXPECTED_FAILURE, "pillow_unavailable"),
}

#: Authored finding text (never derived from the file).
_FINDING_TEXT: Final = {
    "cmyk_converted": "The image was CMYK and was converted to RGB.",
    "gray_profile_ignored": "A gray colour profile was ignored and the values were kept.",
    "bit_depth_reduced": "The image had 16 bits per channel and was reduced to 8.",
}


def map_error(error: ImageError) -> ProcessingError:
    code, reason = _MAP.get(error.code, (ErrorCode.UNEXPECTED_FAILURE, "conversion_failed"))
    return ProcessingError(code, {"reason": reason})


def _facts(source: dict, planned, output) -> dict:
    """Scalars only, at most 12 keys, every string short (Django's `safe_metadata` bound)."""
    colour = output.plan.get("colour", {})
    return {
        "width": output.image.width,
        "height": output.image.height,
        "format": output.image.format,
        "source_width": source["width"],
        "source_height": source["height"],
        "source_format": source["format"],
        "colour_action": str(colour.get("action", "none"))[:32],
        "colour_class": str(colour.get("profileClass", "none"))[:32],
        "alpha_action": str(output.plan.get("alphaAction", "none"))[:32],
        "orientation": int(output.plan.get("orientationApplied") or 0),
        "sanitized": bool(output.image.sanitized),
        "profile": planned.profile.reference[:48],
    }


class ImageConvertProcessor(Processor):
    processor_id = contract.PROCESSOR_ID
    version = contract.PROCESSOR_VERSION
    job_types = frozenset({contract.JOB_TYPE})

    def profiles(self):
        return contract.profiles()

    def validate(self, context: ProcessingContext) -> None:
        if context.input_path is None or context.request.input is None:
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "input"})

    def process(self, context: ProcessingContext) -> ProcessorOutput:
        if context.input_path is None:
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "input"})
        ref = (context.profile.profile_id, context.profile.version)
        data = context.input_path.read_bytes()
        try:
            thumbnails = ref == contract.PROFILE_THUMBNAILS
            decoded = decode_image(data, first_frame_only=thumbnails)
            del data
            context.check()
            planned = contract.plan(ref, dict(context.options), decoded.format)
            report = convert_decoded(decoded, [p.profile for p in planned])
            source = report.source
            del decoded
        except ImageError as error:
            raise map_error(error) from None
        context.check()
        facts: dict[str, dict] = {}
        for item, output in zip(planned, report.outputs, strict=True):
            context.write_artifact(
                logical_id=item.logical_id,
                artifact_type=item.role,
                data=output.image.data,
                content_type=output.image.content_type,
                extension=_EXTENSIONS[output.image.format],
            )
            facts[item.logical_id] = _facts(source, item, output)
        findings = tuple(
            Finding(
                code=code,
                severity=Severity.WARNING,
                message=_FINDING_TEXT.get(code, "See the result."),
                path="",
            )
            for code in report.findings
        )
        metadata = {
            "tool_versions": {"pillow": _pillow_version()},
            "source": {
                key: source[key] for key in ("format", "width", "height", "orientation", "animated")
            },
            "source_flags": {
                key: bool(source[key])
                for key in ("exifPresent", "gpsPresent", "xmpPresent", "iccPresent")
            },
            "artifact_facts": facts,
        }
        return ProcessorOutput(verdict=Verdict.PASS, metadata=metadata, findings=findings)


def _pillow_version() -> str:
    from ._pil import Image

    return str(getattr(Image, "__version__", "unknown"))[:32]


def registry():
    """A frozen processor registry holding only this processor."""
    from lai_processing.core.registry import ProcessorRegistry

    value = ProcessorRegistry()
    value.register(ImageConvertProcessor())
    value.freeze()
    return value
