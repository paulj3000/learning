"""The reference processor (`reference.checksum`): proves the pipeline end to end.

It re-reads the verified input copy, recomputes its SHA-256 and size, and reports deterministic
metadata. It never echoes input content beyond, at `metadata_level="full"`, the first 16 bytes
as hex (a file signature, useful to identify a format) and a printable-byte ratio. Metadata
holds no timestamps, paths or ids, so the same input and options always give the same output.
"""

from __future__ import annotations

import hashlib
from typing import Any, Final

from ..contracts.profiles import OptionSpec, ProcessingProfile
from ..contracts.results import Finding, Severity, Verdict
from ..core.canonical import CHUNK_BYTES, canonical_json
from ..core.errors import ErrorCode, ProcessingError
from ..core.processor import ProcessingContext, Processor, ProcessorOutput

__all__ = ["REFERENCE_PROFILE", "ReferenceProcessor"]

LEADING_BYTES: Final = 16
# Printable ASCII plus tab, line feed and carriage return.
_PRINTABLE: Final = frozenset(range(0x20, 0x7F)) | {0x09, 0x0A, 0x0D}

REFERENCE_PROFILE: Final = ProcessingProfile(
    profile_id="reference-default",
    version=1,
    job_type="reference.checksum",
    description="Verify the input checksum and report deterministic metadata.",
    options={
        "metadata_level": OptionSpec("str", default="basic", choices=("basic", "full")),
        "write_report": OptionSpec("bool", default=False),
    },
)


class ReferenceProcessor(Processor):
    processor_id = "reference.checksum"
    version = "1.0.0"
    job_types = frozenset({"reference.checksum"})

    def profiles(self) -> tuple[ProcessingProfile, ...]:
        return (REFERENCE_PROFILE,)

    def validate(self, context: ProcessingContext) -> None:
        if context.input_path is None or context.request.input is None:
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "input"})

    def process(self, context: ProcessingContext) -> ProcessorOutput:
        if context.input_path is None or context.request.input is None:
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "input"})
        digest = hashlib.sha256()
        size = 0
        printable = 0
        leading = b""
        with open(context.input_path, "rb") as handle:
            while True:
                context.check()
                chunk = handle.read(CHUNK_BYTES)
                if not chunk:
                    break
                size += len(chunk)
                if size > context.limits.max_input_bytes:
                    raise ProcessingError(
                        ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "max_input_bytes"}
                    )
                digest.update(chunk)
                printable += sum(1 for b in chunk if b in _PRINTABLE)
                if len(leading) < LEADING_BYTES:
                    leading += chunk[: LEADING_BYTES - len(leading)]
        sha = digest.hexdigest()
        expected = context.request.input
        # Defence in depth: the engine verified the copy; refuse if it changed since.
        if sha != expected.sha256 or size != expected.size_bytes:
            raise ProcessingError(ErrorCode.CHECKSUM_MISMATCH, {"field": "input"})

        metadata: dict[str, Any] = {
            "byte_count": size,
            "sha256": sha,
            "content_type": expected.content_type,
            "checksum_verified": True,
        }
        if context.options.get("metadata_level") == "full":
            metadata["leading_bytes_hex"] = leading.hex()
            metadata["ascii_printable_permille"] = (printable * 1000 // size) if size else 0

        findings: tuple[Finding, ...] = ()
        if size == 0:
            findings = (
                Finding(
                    code="empty_input",
                    severity=Severity.WARNING,
                    message="The input is empty.",
                ),
            )

        if context.options.get("write_report") is True:
            context.write_artifact(
                logical_id="reference-report",
                artifact_type="report.reference",
                data=canonical_json(metadata),
                content_type="application/json",
                extension="json",
            )
        return ProcessorOutput(verdict=Verdict.PASS, metadata=metadata, findings=findings)
