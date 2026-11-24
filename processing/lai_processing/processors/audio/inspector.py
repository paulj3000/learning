"""Audio header inspection: detect the format from the bytes, run its module, build metadata.

The format always comes from the leading bytes, never from a file name or the declared content
type; the declared type is compared afterwards and a disagreement is a finding. The metadata
object is deterministic (the same bytes and declared type give the same object) and holds no
names, paths, timestamps or text copied from the file.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import IO, Any, Final

from .facts import AudioFacts, AudioSettings
from .mp3 import inspect_mp3, parse_frame_header
from .ogg import inspect_ogg
from .report import Report, Source
from .wav import inspect_wav

__all__ = [
    "DECLARED_TYPES",
    "METADATA_VERSION",
    "Inspection",
    "UPLOAD_POLICY",
    "inspect_audio",
    "sniff",
]

METADATA_VERSION: Final = 1
#: Declared content types and the format each names. The Asset Library stores `audio/mpeg`,
#: `audio/wav` and `audio/ogg` (lai/apps/assets/formats.py); the rest are common aliases.
DECLARED_TYPES: Final = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mpeg3": "mp3",
    "audio/x-mpeg": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/x-wav": "wav",
    "audio/vnd.wave": "wav",
    "audio/ogg": "ogg",
    "audio/opus": "ogg",
    "audio/vorbis": "ogg",
    "audio/x-ogg": "ogg",
    "application/ogg": "ogg",
}
#: The Asset Library's upload limits for audio (lai/apps/assets/validation_media.py). The
#: inspector reports a file outside them as a warning; it does not refuse it.
UPLOAD_POLICY: Final = {
    "channels": (1, 2),
    "min_sample_rate_hz": 8000,
    "max_sample_rate_hz": 96000,
    "max_duration_seconds": 15 * 60,
}
#: Recognised, unsupported containers (reported by name, never parsed).
_UNSUPPORTED: Final = (
    (b"fLaC", "flac"),
    (b"FORM", "aiff"),
    (b"MThd", "midi"),
    (b"#!AMR", "amr"),
    (b"\x30\x26\xb2\x75\x8e\x66\xcf\x11", "asf"),
    (b"\x1a\x45\xdf\xa3", "matroska"),
)
_LIMITATIONS: Final = (
    (
        "header_only",
        "Header inspection reads container and codec headers only. It does not decode audio, "
        "so it does not prove the file is decodable.",
    ),
    (
        "playback_not_verified",
        "It does not prove the file plays correctly in every browser or device.",
    ),
    (
        "loudness_not_measured",
        "It does not measure loudness, peak level, clipping or silence.",
    ),
)


@dataclass(frozen=True)
class Inspection:
    metadata: dict[str, Any]
    report: Report


def sniff(head: bytes) -> str | None:
    """The audio format named by a file's first bytes: `wav`, `mp3`, `ogg` or None."""
    if head[:4] in (b"RIFF", b"RIFX", b"RF64", b"BW64") and head[8:12] == b"WAVE":
        return "wav"
    if head[:4] == b"OggS":
        return "ogg"
    if head[:3] == b"ID3" or parse_frame_header(head[:4]) is not None:
        return "mp3"
    return None


def _unsupported(head: bytes) -> str | None:
    for signature, name in _UNSUPPORTED:
        if head.startswith(signature):
            return name
    if head[4:8] == b"ftyp":
        return "mp4"
    return None


def inspect_audio(
    handle: IO[bytes],
    size: int,
    declared_content_type: str,
    settings: AudioSettings,
    check: Callable[[], None] = lambda: None,
) -> Inspection:
    report = Report()
    for code, message in _LIMITATIONS:
        report.limitation(code, message)
    src = Source(handle, size, check)
    head = src.read(0, 16)
    detected = sniff(head)
    if size <= 0:
        report.error("empty_file", "The file is empty.")
        facts = AudioFacts()
    elif detected == "wav":
        facts = inspect_wav(src, report, settings)
    elif detected == "mp3":
        facts = inspect_mp3(src, report, settings)
    elif detected == "ogg":
        facts = inspect_ogg(src, report, settings)
    else:
        facts = AudioFacts()
        other = _unsupported(head)
        if other is not None:
            facts.container = other
            report.error(
                "audio_format_unsupported",
                "The file is audio in a format the Asset Library does not accept (only MP3, WAV "
                "and Ogg Vorbis or Opus are supported).",
            )
        else:
            report.error("not_audio", "The file is not MP3, WAV or Ogg audio.")
    check()
    declared = _declared(declared_content_type, facts.detected_format, report)
    _policy(facts, report)
    return Inspection(_metadata(facts, size, declared_content_type, declared, report), report)


def _declared(content_type: str, detected: str | None, report: Report) -> str | None:
    declared = DECLARED_TYPES.get(content_type)
    if declared is None:
        if content_type.startswith("audio/"):
            report.warn(
                "declared_type_unrecognized",
                "The declared content type is an audio type the inspector does not recognise.",
            )
        else:
            report.error(
                "declared_type_not_audio",
                "The declared content type is not an audio type.",
            )
    elif detected is not None and declared != detected:
        report.error(
            "declared_type_mismatch",
            "The declared content type does not match the format found in the file's bytes. "
            "Browsers may refuse to play it.",
        )
    return declared


def _policy(facts: AudioFacts, report: Report) -> None:
    if facts.channels is not None and facts.channels not in UPLOAD_POLICY["channels"]:
        report.warn(
            "channels_outside_upload_policy",
            "The audio is not mono or stereo; the Asset Library accepts mono and stereo only.",
        )
    rate = facts.sample_rate_hz
    if rate is not None and not (
        UPLOAD_POLICY["min_sample_rate_hz"] <= rate <= UPLOAD_POLICY["max_sample_rate_hz"]
    ):
        report.warn(
            "sample_rate_outside_upload_policy",
            "The sample rate is outside 8,000 to 96,000 Hz, which the Asset Library accepts.",
        )
    seconds = facts.duration_seconds
    if seconds is not None and seconds > UPLOAD_POLICY["max_duration_seconds"]:
        report.warn(
            "duration_outside_upload_policy",
            "The audio is longer than the Asset Library's 15 minute limit.",
        )
    if seconds == 0:
        report.warn("audio_empty", "The audio has a duration of zero.")


def _metadata(
    facts: AudioFacts,
    size: int,
    content_type: str,
    declared: str | None,
    report: Report,
) -> dict[str, Any]:
    matches = (
        None
        if declared is None or facts.detected_format is None
        else (declared == facts.detected_format)
    )
    return {
        "metadata_version": METADATA_VERSION,
        "detected_format": facts.detected_format,
        "container": facts.container,
        "codec": facts.codec,
        "file_size_bytes": size,
        "declared_content_type": content_type,
        "declared_format": declared,
        "declared_type_matches": matches,
        "duration_seconds": facts.duration_seconds,
        "duration_kind": facts.duration_kind,
        "sample_rate_hz": facts.sample_rate_hz,
        "channels": facts.channels,
        "sample_width_bits": facts.sample_width_bits,
        "bitrate_bps": facts.bitrate_bps,
        "bitrate_mode": facts.bitrate_mode,
        "scan": {
            "unit": facts.scan_unit,
            "units_scanned": facts.units_scanned,
            "complete": facts.scan_complete,
        },
        "structure": dict(sorted(facts.structure.items())),
        "limitations": report.limitations(),
    }
