"""What one format module learned about a file, before it becomes result metadata."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Final

__all__ = [
    "DURATION_ESTIMATED",
    "DURATION_EXACT",
    "DURATION_UNAVAILABLE",
    "AudioFacts",
    "AudioSettings",
    "MAX_SAFE_INT",
]

#: Computed from container counts (sample frames, a header's frame count, a granule position).
DURATION_EXACT: Final = "exact"
#: Derived from a byte count and a bit rate, from a partial scan, or without a header count.
DURATION_ESTIMATED: Final = "estimated"
DURATION_UNAVAILABLE: Final = "unavailable"
#: Integers above this are not reported (they would lose precision in JSON consumers).
MAX_SAFE_INT: Final = 2**53


@dataclass
class AudioFacts:
    detected_format: str | None = None
    container: str | None = None
    codec: str | None = None
    duration_seconds: float | None = None
    duration_kind: str = DURATION_UNAVAILABLE
    sample_rate_hz: int | None = None
    channels: int | None = None
    sample_width_bits: int | None = None
    bitrate_bps: int | None = None
    bitrate_mode: str | None = None
    scan_unit: str | None = None
    units_scanned: int = 0
    scan_complete: bool = False
    structure: dict[str, Any] = field(default_factory=dict)

    def set_duration(self, seconds: float | None, kind: str) -> None:
        if seconds is None or seconds != seconds or seconds < 0 or seconds > MAX_SAFE_INT:
            self.duration_seconds, self.duration_kind = None, DURATION_UNAVAILABLE
            return
        self.duration_seconds, self.duration_kind = round(seconds, 6), kind


@dataclass(frozen=True)
class AudioSettings:
    """Scan bounds, from the profile's complexity limits (clamped by the worker ceilings)."""

    max_wav_chunks: int = 1024
    max_mp3_frames: int = 200_000
    max_ogg_pages: int = 50_000
    max_id3_bytes: int = 8 * 1024 * 1024
    #: Pages whose CRC is verified (from the start); the last page is always verified too.
    ogg_crc_pages: int = 16
    #: Bytes searched for the first MP3 frame after the ID3v2 tags.
    mp3_sync_search_bytes: int = 64 * 1024
