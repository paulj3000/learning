"""`EXT_meshopt_compression` structural validation (ADR-070), standard library only.

`validate_meshopt(document, sink, ...)` checks every buffer view that carries the extension and
every buffer marked as a fallback buffer, against the ratified Khronos specification
(https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/EXT_meshopt_compression,
read 2026-11-18):

- extension fields: `buffer` (a valid, non-fallback buffer), `byteOffset` (default 0) and
  `byteLength` inside that buffer, `byteStride`, `count`, `mode` (`ATTRIBUTES`, `TRIANGLES`,
  `INDICES`), `filter` (`NONE`, `OCTAHEDRAL`, `QUATERNION`, `EXPONENTIAL`) and the per-mode and
  per-filter stride and count rules;
- the parent view: its `byteStride` (when present) matches, and its `byteLength` equals
  `count * byteStride` (the decoded length);
- a decoded-size budget, per view and in total, so a small file cannot claim gigabytes of
  decoded geometry;
- fallback buffers: referenced only by compressed views, never as compressed sources; a fallback
  buffer without data requires the extension in `extensionsRequired`; declared-use consistency
  between `extensionsUsed`, `extensionsRequired` and actual use.

Optionally, when the caller passes `read`, bounded header-level stream checks: the mode's header
byte (`0xa0`, `0xe1`, `0xd1`), the smallest byte length a well-formed stream of that `count` and
`byteStride` can have, and the triangle codec's 16-byte tail table rules. This reads at most 17
bytes per view; it does **not** decode, so corrupt payload bytes inside a well-formed frame are
only found by the browser's decoder. Reports must say so (`meshopt_payload_not_decoded`, a note
the caller may surface as a warning).

The function never raises for a bad file. Findings go to `sink`, which only needs
`error(code, message, path)` and `warn(code, message, path)`: the processor's `Report` and
Django's `ValidationResult` both qualify. Messages are code-authored and never quote file
content.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Final, Protocol

__all__ = [
    "DEFAULT_MAX_DECODED_BYTES",
    "FILTERS",
    "MAX_DECODED_BYTES_CEILING",
    "MESHOPT_EXTENSION",
    "MODES",
    "MeshoptFacts",
    "MeshoptView",
    "Sink",
    "fallback_buffer_indices",
    "minimum_stream_length",
    "uses_meshopt",
    "validate_meshopt",
]

MESHOPT_EXTENSION: Final = "EXT_meshopt_compression"
MODES: Final = frozenset({"ATTRIBUTES", "TRIANGLES", "INDICES"})
FILTERS: Final = frozenset({"NONE", "OCTAHEDRAL", "QUATERNION", "EXPONENTIAL"})
STREAM_HEADER: Final[Mapping[str, int]] = {"ATTRIBUTES": 0xA0, "TRIANGLES": 0xE1, "INDICES": 0xD1}
#: Decoded geometry budget for one model (sum over compressed views). The GLB upload ceiling is
#: 50 MiB; meshopt rarely exceeds 10:1, so 256 MiB leaves room without letting a file claim more
#: than the media function's memory.
DEFAULT_MAX_DECODED_BYTES: Final = 256 * 1024 * 1024
MAX_DECODED_BYTES_CEILING: Final = 1024 * 1024 * 1024
#: The attribute codec pads its tail block to at least 32 bytes (version 0, the EXT bitstream).
_ATTRIBUTE_TAIL_MIN: Final = 32
_TRIANGLE_TAIL: Final = 16
_INDEX_TAIL: Final = 4

Check = Callable[[], None]
#: (buffer index, byte offset, length) -> up to `length` bytes, or None when the bytes are not
#: available (for example an external buffer). Must never read past the buffer.
ReadRange = Callable[[int, int, int], "bytes | None"]


class Sink(Protocol):
    def error(self, code: str, message: str, path: str = "") -> None: ...

    def warn(self, code: str, message: str, path: str = "") -> None: ...


@dataclass(frozen=True, slots=True)
class MeshoptView:
    index: int
    buffer: int
    byte_offset: int
    byte_length: int
    byte_stride: int
    count: int
    mode: str
    filter: str

    @property
    def decoded_bytes(self) -> int:
        return self.count * self.byte_stride


@dataclass
class MeshoptFacts:
    used: bool = False
    required: bool = False
    views: list[MeshoptView] = field(default_factory=list)
    fallback_buffers: frozenset[int] = frozenset()
    compressed_bytes: int = 0
    decoded_bytes: int = 0
    headers_checked: int = 0

    def as_metadata(self) -> dict[str, Any]:
        """A small, bounded summary for validation metadata."""
        modes: dict[str, int] = {}
        filters: dict[str, int] = {}
        for view in self.views:
            modes[view.mode] = modes.get(view.mode, 0) + 1
            filters[view.filter] = filters.get(view.filter, 0) + 1
        return {
            "extension": MESHOPT_EXTENSION,
            "required": self.required,
            "compressed_view_count": len(self.views),
            "compressed_bytes": self.compressed_bytes,
            "decoded_bytes": self.decoded_bytes,
            "modes": dict(sorted(modes.items())),
            "filters": dict(sorted(filters.items())),
            "fallback_buffer_count": len(self.fallback_buffers),
            "headers_checked": self.headers_checked,
            "payload_decoded": False,
        }


def _noop() -> None:
    return None


def _dict(value: object) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _list(document: Mapping[str, Any], name: str) -> list[Any]:
    value = document.get(name)
    return value if isinstance(value, list) else []


def _int(value: object, minimum: int = 0) -> int | None:
    """A JSON integer >= minimum (bool is not an integer here; 3.0 is accepted as glTF allows)."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= minimum else None
    if isinstance(value, float) and value.is_integer():
        whole = int(value)
        return whole if whole >= minimum else None
    return None


def _names(document: Mapping[str, Any], key: str) -> set[str]:
    return {name for name in _list(document, key) if isinstance(name, str)}


def _extension(container: object) -> object:
    item = _dict(container)
    if item is None:
        return None
    extensions = _dict(item.get("extensions"))
    if extensions is None:
        return None
    return extensions.get(MESHOPT_EXTENSION)


def fallback_buffer_indices(document: Mapping[str, Any]) -> frozenset[int]:
    """Buffers marked `{"extensions": {"EXT_meshopt_compression": {"fallback": true}}}`.

    The validators' buffer check uses this to accept a fallback buffer without data (no `uri`,
    not the GLB binary chunk) when the extension is enabled and required.
    """
    found: set[int] = set()
    for index, buffer in enumerate(_list(document, "buffers")):
        marker = _dict(_extension(buffer))
        if marker is not None and marker.get("fallback") is True:
            found.add(index)
    return frozenset(found)


def uses_meshopt(document: Mapping[str, Any]) -> bool:
    if MESHOPT_EXTENSION in _names(document, "extensionsUsed") | _names(
        document, "extensionsRequired"
    ):
        return True
    if fallback_buffer_indices(document):
        return True
    return any(_extension(view) is not None for view in _list(document, "bufferViews"))


def _ceil_div(a: int, b: int) -> int:
    return -(-a // b)


def minimum_stream_length(mode: str, count: int, stride: int) -> int:
    """The fewest bytes a well-formed stream of `count` elements of `stride` bytes can occupy.

    ATTRIBUTES: header byte, then per attribute block and per byte of the element the 2-bit
    group header bits (delta bytes may be absent when every delta is zero), then the tail
    block of max(stride, 32) bytes. TRIANGLES: header, one code byte per triangle, 16-byte tail.
    INDICES: header, at least one varint byte per index, 4-byte tail. (Appendix A of the spec.)
    """
    if mode == "ATTRIBUTES":
        max_block = min((8192 // stride) & ~15, 256) if stride else 0
        if max_block <= 0:
            return 1 + max(stride, _ATTRIBUTE_TAIL_MIN)
        total = 1 + max(stride, _ATTRIBUTE_TAIL_MIN)
        remaining = count
        while remaining > 0:
            block = min(remaining, max_block)
            groups = _ceil_div(block, 16)
            total += stride * _ceil_div(groups, 4)
            remaining -= block
        return total
    if mode == "TRIANGLES":
        return 1 + count // 3 + _TRIANGLE_TAIL
    if mode == "INDICES":
        return 1 + count + _INDEX_TAIL
    return 1


class _Checker:
    def __init__(
        self,
        document: Mapping[str, Any],
        sink: Sink,
        buffer_lengths: Sequence[int | None] | None,
        read: ReadRange | None,
        max_decoded_bytes: int,
        check: Check,
    ) -> None:
        self.doc = document
        self.sink = sink
        self.read = read
        self.max_decoded = max(1, min(max_decoded_bytes, MAX_DECODED_BYTES_CEILING))
        self.check = check
        self.buffers = _list(document, "buffers")
        self.views = _list(document, "bufferViews")
        self.facts = MeshoptFacts()
        self.lengths: list[int | None] = []
        for index, raw in enumerate(self.buffers):
            declared = _int(_dict(raw).get("byteLength") if _dict(raw) else None, 1)
            known = None
            if buffer_lengths is not None and index < len(buffer_lengths):
                known = buffer_lengths[index]
            # The smaller of what the JSON declares and what the container really holds.
            if declared is not None and known is not None:
                self.lengths.append(min(declared, known))
            else:
                self.lengths.append(declared if known is None else known)

    def run(self) -> MeshoptFacts:
        used = MESHOPT_EXTENSION in _names(self.doc, "extensionsUsed")
        required = MESHOPT_EXTENSION in _names(self.doc, "extensionsRequired")
        self.facts.required = required
        self.facts.fallback_buffers = fallback_buffer_indices(self.doc)
        self._fallback_markers()
        compressed_indices: set[int] = set()
        for index, raw in enumerate(self.views):
            self.check()
            extension = _extension(raw)
            if extension is None:
                continue
            compressed_indices.add(index)
            self._view(index, _dict(raw) or {}, extension)
        actually_used = bool(compressed_indices) or bool(self.facts.fallback_buffers)
        self.facts.used = actually_used or used or required
        if actually_used and not used:
            self.sink.error(
                "meshopt_not_declared",
                "The model compresses data with EXT_meshopt_compression but does not list it "
                "in extensionsUsed.",
                "extensionsUsed",
            )
        if required and not used:
            self.sink.error(
                "extension_required_not_used",
                "An extension in extensionsRequired is missing from extensionsUsed.",
                "extensionsRequired",
            )
        if (used or required) and not actually_used:
            self.sink.warn(
                "meshopt_unused",
                "The model declares EXT_meshopt_compression but compresses nothing.",
                "extensionsUsed",
            )
        self._fallback_references(compressed_indices, required)
        if self.facts.decoded_bytes > self.max_decoded:
            self.sink.error(
                "meshopt_decoded_too_large",
                f"The compressed geometry decodes to more than {self.max_decoded:,} bytes.",
                "bufferViews",
            )
        if self.facts.views:
            self.sink.warn(
                "meshopt_payload_not_decoded",
                "Compressed geometry was checked for structure only; the payload is decoded "
                "by the game.",
                "bufferViews",
            )
        return self.facts

    # --- buffers ---------------------------------------------------------------------------

    def _fallback_markers(self) -> None:
        for index, raw in enumerate(self.buffers):
            marker = _extension(raw)
            if marker is None:
                continue
            path = f"buffers[{index}].extensions.{MESHOPT_EXTENSION}"
            item = _dict(marker)
            if item is None or not isinstance(item.get("fallback", False), bool):
                self.sink.error("meshopt_invalid", "A meshopt buffer marker is malformed.", path)

    def _has_data(self, index: int) -> bool:
        """Whether a buffer carries bytes: a `uri`, or buffer 0 of a GLB (the BIN chunk)."""
        buffer = _dict(self.buffers[index]) or {}
        if "uri" in buffer:
            return True
        return index == 0 and bool(self.lengths) and self.lengths[0] is not None

    def _fallback_references(self, compressed: set[int], required: bool) -> None:
        fallback = self.facts.fallback_buffers
        for index, raw in enumerate(self.views):
            self.check()
            view = _dict(raw)
            if view is None:
                continue
            buffer = _int(view.get("buffer"))
            if buffer is None or buffer not in fallback:
                continue
            if index not in compressed:
                self.sink.error(
                    "meshopt_fallback_reference",
                    "An uncompressed buffer view reads from a meshopt fallback buffer.",
                    f"bufferViews[{index}]",
                )
        for index in sorted(fallback):
            path = f"buffers[{index}]"
            if index == 0:
                self.sink.error(
                    "meshopt_fallback_index",
                    "A meshopt fallback buffer must not be buffer 0 (the GLB binary chunk).",
                    path,
                )
                continue
            buffer = _dict(self.buffers[index]) or {}
            if "uri" not in buffer and not required:
                self.sink.error(
                    "meshopt_fallback_requires_extension",
                    "A meshopt fallback buffer has no data, so EXT_meshopt_compression must be "
                    "in extensionsRequired.",
                    path,
                )
        # A compressed view whose parent buffer is not marked as fallback but has no data
        # behaves like a fallback buffer: it also requires the extension.
        if not required:
            for index in sorted(compressed):
                view = _dict(self.views[index]) or {}
                buffer = _int(view.get("buffer"))
                if (
                    buffer is not None
                    and buffer < len(self.buffers)
                    and buffer not in fallback
                    and not self._has_data(buffer)
                ):
                    self.sink.error(
                        "meshopt_fallback_requires_extension",
                        "A compressed buffer view has no uncompressed data, so "
                        "EXT_meshopt_compression must be in extensionsRequired.",
                        f"bufferViews[{index}]",
                    )

    # --- views -----------------------------------------------------------------------------

    def _view(self, index: int, parent: dict[str, Any], raw: object) -> None:
        path = f"bufferViews[{index}].extensions.{MESHOPT_EXTENSION}"
        extension = _dict(raw)
        if extension is None:
            self.sink.error(
                "meshopt_invalid", "A meshopt buffer view extension is malformed.", path
            )
            return
        buffer = _int(extension.get("buffer"))
        offset = _int(extension.get("byteOffset", 0))
        length = _int(extension.get("byteLength"), 1)
        stride = _int(extension.get("byteStride"), 1)
        count = _int(extension.get("count"), 1)
        mode = extension.get("mode")
        filter_name = extension.get("filter", "NONE")
        malformed = False
        if buffer is None or buffer >= len(self.buffers):
            self.sink.error(
                "meshopt_invalid_buffer",
                "A compressed buffer view points at a missing buffer.",
                path,
            )
            malformed = True
        elif buffer in self.facts.fallback_buffers:
            self.sink.error(
                "meshopt_fallback_source",
                "Compressed data must not be read from a meshopt fallback buffer.",
                path,
            )
            malformed = True
        if offset is None or length is None or stride is None or count is None:
            self.sink.error(
                "meshopt_invalid",
                "A compressed buffer view has a missing or invalid byteOffset, byteLength, "
                "byteStride or count.",
                path,
            )
            malformed = True
        if not isinstance(mode, str) or mode not in MODES:
            self.sink.error(
                "meshopt_mode",
                "A compressed buffer view has an unknown mode (ATTRIBUTES, TRIANGLES or INDICES).",
                path,
            )
            malformed = True
        if not isinstance(filter_name, str) or filter_name not in FILTERS:
            self.sink.error(
                "meshopt_filter",
                "A compressed buffer view has an unknown filter.",
                path,
            )
            malformed = True
        if (
            malformed
            or buffer is None
            or offset is None
            or length is None
            or stride is None
            or count is None
            or not isinstance(mode, str)
            or not isinstance(filter_name, str)
        ):
            return
        self._rules(mode, filter_name, stride, count, path)
        limit = self.lengths[buffer]
        if limit is None or offset + length > limit:
            self.sink.error(
                "meshopt_bounds",
                "Compressed data runs past the end of its buffer.",
                path,
            )
            return
        parent_stride = parent.get("byteStride")
        if parent_stride is not None and _int(parent_stride, 1) != stride:
            self.sink.error(
                "meshopt_stride_mismatch",
                "The buffer view's byteStride differs from the compressed byteStride.",
                f"bufferViews[{index}]",
            )
        decoded = stride * count
        if _int(parent.get("byteLength"), 1) != decoded:
            self.sink.error(
                "meshopt_length_mismatch",
                "The buffer view's byteLength is not count times byteStride.",
                f"bufferViews[{index}]",
            )
        if decoded > self.max_decoded:
            self.sink.error(
                "meshopt_decoded_too_large",
                "A compressed buffer view decodes to more than the allowed size.",
                path,
            )
        view = MeshoptView(index, buffer, offset, length, stride, count, mode, filter_name)
        self.facts.views.append(view)
        self.facts.compressed_bytes += length
        self.facts.decoded_bytes += decoded
        self._stream(view, path)

    def _rules(self, mode: str, filter_name: str, stride: int, count: int, path: str) -> None:
        def stride_error(message: str) -> None:
            self.sink.error("meshopt_stride", message, path)

        if mode == "ATTRIBUTES":
            if stride % 4 or stride > 256:
                stride_error("An ATTRIBUTES stream needs a byteStride divisible by 4, up to 256.")
        else:
            if stride not in (2, 4):
                stride_error("An index stream needs a byteStride of 2 or 4.")
            if filter_name != "NONE":
                self.sink.error("meshopt_filter", "Index streams cannot use a filter.", path)
            if mode == "TRIANGLES" and count % 3:
                self.sink.error(
                    "meshopt_count", "A TRIANGLES stream needs a count divisible by 3.", path
                )
        if filter_name == "OCTAHEDRAL" and stride not in (4, 8):
            stride_error("The OCTAHEDRAL filter needs a byteStride of 4 or 8.")
        elif filter_name == "QUATERNION" and stride != 8:
            stride_error("The QUATERNION filter needs a byteStride of 8.")
        elif filter_name == "EXPONENTIAL" and stride % 4:
            stride_error("The EXPONENTIAL filter needs a byteStride divisible by 4.")

    def _stream(self, view: MeshoptView, path: str) -> None:
        minimum = minimum_stream_length(view.mode, view.count, view.byte_stride)
        if view.byte_length < minimum:
            self.sink.error(
                "meshopt_stream_truncated",
                "A compressed stream is shorter than its element count allows.",
                path,
            )
            return
        if self.read is None:
            return
        head = self.read(view.buffer, view.byte_offset, 1)
        if not head:
            return
        self.facts.headers_checked += 1
        if head[0] != STREAM_HEADER[view.mode]:
            self.sink.error(
                "meshopt_stream_header",
                "A compressed stream does not start with the header its mode requires.",
                path,
            )
            return
        if view.mode == "TRIANGLES":
            tail = self.read(view.buffer, view.byte_offset + view.byte_length - _TRIANGLE_TAIL, 16)
            if tail is not None and len(tail) == _TRIANGLE_TAIL:
                nibbles_ok = all((b >> 4) != 0xF and (b & 0xF) != 0xF for b in tail[:14])
                if tail[14] != 0 or tail[15] != 0 or not nibbles_ok:
                    self.sink.error(
                        "meshopt_stream_tail",
                        "A compressed triangle stream has an invalid tail table.",
                        path,
                    )


def validate_meshopt(
    document: Mapping[str, Any],
    sink: Sink,
    *,
    buffer_lengths: Sequence[int | None] | None = None,
    read: ReadRange | None = None,
    max_decoded_bytes: int = DEFAULT_MAX_DECODED_BYTES,
    check: Check = _noop,
) -> MeshoptFacts:
    """Check `EXT_meshopt_compression` use in a parsed glTF document.

    `buffer_lengths[i]` is the number of bytes buffer `i` really holds (for a GLB: the BIN chunk
    length for buffer 0, the decoded data URI length for embedded buffers, None when unknown);
    when omitted the declared `byteLength` is used. `read` enables the header-level stream
    checks. Call only when the extension is enabled; with the control off the policy table
    rejects the extension before this runs.
    """
    return _Checker(document, sink, buffer_lengths, read, max_decoded_bytes, check).run()
