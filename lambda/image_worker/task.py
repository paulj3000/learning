"""`asset.convert_image`: read one image from the asset bucket, convert it with the requested
profiles, hand each output to the artifact sink and return a value-free result.

Payload (exact keys; phase 1 shape, mapped onto the frozen artifact contract in phase 2):
`storage_key`, `format`, `size_bytes`, `sha256` (of the source, verified), `profiles` (1 to 4
names from `lai_native.image.PROFILES`) and optional `options` (`max_side`, `quality`,
`power_of_two`, `flatten_background`, `output_format`, applied to every profile).

Errors are `TaskError(code)`; none is retryable except a storage fault from the ports.
"""

from __future__ import annotations

import hashlib

from .settings import KIND

READ_WINDOW = 1024 * 1024
OPTION_KEYS = frozenset(
    {"max_side", "quality", "power_of_two", "flatten_background", "output_format"}
)
PAYLOAD_KEYS = frozenset({"storage_key", "format", "size_bytes", "sha256", "profiles"})


class ArtifactSink:
    """The artifact output adapter point. Workstream A supplies the create-only S3 put
    (key `processing/artifacts/<env>/<job>/<attempt>/<logical id>.<ext>`). Phase 1 ships this
    stub, which refuses, and `MemorySink` for tests."""

    def put(self, logical_id: str, content_type: str, data: bytes, sha256: str) -> dict:
        raise NotImplementedError


class UnconfiguredSink(ArtifactSink):
    def put(self, logical_id, content_type, data, sha256):
        from .vendor_tasks import TaskError

        raise TaskError("artifact_store_unconfigured")


class MemorySink(ArtifactSink):
    """Keeps outputs in memory (tests and local demos)."""

    def __init__(self):
        self.objects: dict[str, tuple[str, bytes]] = {}

    def put(self, logical_id, content_type, data, sha256):
        self.objects[logical_id] = (content_type, data)
        return {
            "logical_id": logical_id,
            "content_type": content_type,
            "size_bytes": len(data),
            "sha256": sha256,
        }


def run_convert_image(payload: dict, ports) -> dict:
    from .vendor_tasks import TaskError, tasks

    if not isinstance(payload, dict) or not (
        PAYLOAD_KEYS <= set(payload) <= PAYLOAD_KEYS | {"options"}
    ):
        raise TaskError("invalid_payload")
    key, file_format = payload["storage_key"], payload["format"]
    if (
        file_format not in ("png", "jpeg", "webp")
        or not tasks.valid_asset_key(key, file_format)
        or type(payload["size_bytes"]) is not int
        or not 1 <= payload["size_bytes"] <= 10 * 1024 * 1024
        or not isinstance(payload["sha256"], str)
        or len(payload["sha256"]) != 64
        or not isinstance(payload["profiles"], list)
        or not 1 <= len(payload["profiles"]) <= 4
    ):
        raise TaskError("invalid_payload")
    options = payload.get("options", {})
    if not isinstance(options, dict) or set(options) - OPTION_KEYS:
        raise TaskError("invalid_payload")

    try:
        from lai_native import image as imaging
    except ImportError:  # pragma: no cover
        raise TaskError("pillow_unavailable") from None
    except Exception as error:  # ImageError("pillow_unavailable")
        raise TaskError(getattr(error, "code", "pillow_unavailable")) from None

    try:
        profiles = [
            imaging.get_profile(name).with_options(**options) for name in payload["profiles"]
        ]
    except imaging.ImageError as error:
        raise TaskError(error.code) from None

    size = ports.asset_object_size(key)
    if size is None:
        raise TaskError("object_missing")
    if size != payload["size_bytes"] or size > imaging.MAX_IMAGE_BYTES:
        raise TaskError("size_mismatch")
    chunks, position = [], 0
    while position < size:
        piece = ports.read_asset(key, position, min(READ_WINDOW, size - position))
        if not piece:
            raise TaskError("storage", retryable=True)
        chunks.append(piece)
        position += len(piece)
    data = b"".join(chunks)
    del chunks
    if hashlib.sha256(data).hexdigest() != payload["sha256"]:
        raise TaskError("checksum_mismatch")
    if imaging.sniff_format(data[:16]) != file_format:
        raise TaskError("format_mismatch")

    try:
        report = imaging.convert_many(data, profiles)
    except imaging.ImageError as error:
        raise TaskError(error.code) from None
    del data

    result = report.as_dict()
    sink = getattr(ports, "artifacts", None) or UnconfiguredSink()
    artifacts = []
    for output in report.outputs:
        artifacts.append(
            sink.put(
                output.profile.name,
                output.image.content_type,
                output.image.data,
                output.image.sha256,
            )
        )
    result["artifacts"] = artifacts
    result["verdict"] = "pass"
    return result


__all__ = ["KIND", "run_convert_image", "ArtifactSink", "MemorySink", "UnconfiguredSink"]
