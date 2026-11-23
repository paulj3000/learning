"""MPEG audio (MP3) header inspection: ID3v2 tags, frame headers, Xing/Info/VBRI headers.

Nothing is decoded. The inspector skips ID3v2 tags (bounded in number and size), finds the first
frame (bounded search, confirmed by a second header), reads a Xing, Info or VBRI header in the
first frame, then walks frame headers (bounded count) to check that the stream is a consistent
sequence of frames and to measure it. Free-format streams (bit rate index 0) cannot be walked
without decoding and are refused. ISO/IEC 11172-3 and 13818-3 define the header fields.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Final

from .facts import DURATION_ESTIMATED, DURATION_EXACT, AudioFacts, AudioSettings
from .report import Report, Source

__all__ = ["FrameHeader", "inspect_mp3", "parse_frame_header"]

MAX_ID3_TAGS: Final = 4
ID3V1_BYTES: Final = 128
APE_FOOTER_BYTES: Final = 32
#: Larger trailing APE tags are not skipped (they are reported as trailing data).
MAX_APE_BYTES: Final = 1024 * 1024

_VERSIONS: Final = {3: "1", 2: "2", 0: "2.5"}
_LAYERS: Final = {3: 1, 2: 2, 1: 3}
# kbit/s by bitrate index 1..14 (index 0 is free format, 15 is invalid).
_BITRATES: Final = {
    ("1", 1): (32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448),
    ("1", 2): (32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384),
    ("1", 3): (32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320),
    ("2", 1): (32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256),
    ("2", 2): (8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),
    ("2", 3): (8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160),
}
_RATES: Final = {
    "1": (44100, 48000, 32000),
    "2": (22050, 24000, 16000),
    "2.5": (11025, 12000, 8000),
}
_CHANNEL_MODES: Final = ("stereo", "joint_stereo", "dual_channel", "mono")


@dataclass(frozen=True, slots=True)
class FrameHeader:
    version: str  # "1", "2" or "2.5"
    layer: int  # 1, 2 or 3
    protected: bool
    bitrate_index: int
    sample_rate: int
    padding: int
    channel_mode: str

    @property
    def bitrate(self) -> int:
        """Bits per second; 0 for free format."""
        if self.bitrate_index == 0:
            return 0
        family = "1" if self.version == "1" else "2"
        return _BITRATES[(family, self.layer)][self.bitrate_index - 1] * 1000

    @property
    def channels(self) -> int:
        return 1 if self.channel_mode == "mono" else 2

    @property
    def samples_per_frame(self) -> int:
        if self.layer == 1:
            return 384
        if self.layer == 2 or self.version == "1":
            return 1152
        return 576

    @property
    def frame_length(self) -> int:
        """Bytes in the frame, header included; 0 for free format."""
        if self.bitrate_index == 0:
            return 0
        if self.layer == 1:
            return (12 * self.bitrate // self.sample_rate + self.padding) * 4
        return self.samples_per_frame // 8 * self.bitrate // self.sample_rate + self.padding

    @property
    def side_info_bytes(self) -> int:
        if self.layer != 3:
            return 0
        if self.version == "1":
            return 17 if self.channel_mode == "mono" else 32
        return 9 if self.channel_mode == "mono" else 17

    def same_stream(self, other: FrameHeader) -> bool:
        return (self.version, self.layer, self.sample_rate) == (
            other.version,
            other.layer,
            other.sample_rate,
        )


def parse_frame_header(data: bytes) -> FrameHeader | None:
    """The frame header in the first four bytes of `data`, or None when they are not one."""
    if len(data) < 4 or data[0] != 0xFF or data[1] & 0xE0 != 0xE0:
        return None
    version_bits, layer_bits = (data[1] >> 3) & 3, (data[1] >> 1) & 3
    bitrate_index, rate_index = data[2] >> 4, (data[2] >> 2) & 3
    if version_bits == 1 or layer_bits == 0 or bitrate_index == 15 or rate_index == 3:
        return None
    if data[3] & 3 == 2:  # reserved emphasis
        return None
    version = _VERSIONS[version_bits]
    return FrameHeader(
        version=version,
        layer=_LAYERS[layer_bits],
        protected=not data[1] & 1,
        bitrate_index=bitrate_index,
        sample_rate=_RATES[version][rate_index],
        padding=(data[2] >> 1) & 1,
        channel_mode=_CHANNEL_MODES[data[3] >> 6],
    )


def _skip_id3v2(src: Source, report: Report, settings: AudioSettings) -> int | None:
    """The offset after every leading ID3v2 tag, or None when a tag is unusable."""
    offset, total, tags = 0, 0, 0
    while True:  # bounded: at most MAX_ID3_TAGS + 1 iterations
        head = src.read(offset, 10)
        if head[:3] != b"ID3":
            break
        tags += 1
        if tags > MAX_ID3_TAGS:
            report.error("mp3_id3_too_many", "The MP3 starts with more ID3v2 tags than allowed.")
            return None
        if len(head) < 10 or head[3] not in (2, 3, 4) or head[4] == 0xFF:
            report.error(
                "mp3_id3_invalid", "An ID3v2 tag header is corrupted.", f"id3v2[{tags - 1}]"
            )
            return None
        if any(b & 0x80 for b in head[6:10]):
            report.error(
                "mp3_id3_invalid",
                "An ID3v2 tag size is not a valid synchsafe integer.",
                f"id3v2[{tags - 1}]",
            )
            return None
        size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9]
        footer = 10 if head[3] == 4 and head[5] & 0x10 else 0
        length = 10 + size + footer
        total += length
        if total > settings.max_id3_bytes:
            report.error(
                "mp3_id3_too_large",
                "The ID3v2 tags are larger than the inspector allows (embedded artwork?).",
            )
            return None
        if offset + length >= src.size:
            report.error("mp3_id3_truncated", "The file ends inside an ID3v2 tag.")
            return None
        offset += length
    return offset


def _audio_end(src: Source, start: int) -> tuple[int, list[str]]:
    """Where the frames end: before a trailing ID3v1 tag and an APEv2 tag, when present."""
    end, tags = src.size, []
    if end - start >= ID3V1_BYTES and src.read(end - ID3V1_BYTES, 3) == b"TAG":
        end -= ID3V1_BYTES
        tags.append("id3v1")
    if end - start >= APE_FOOTER_BYTES:
        footer = src.read(end - APE_FOOTER_BYTES, APE_FOOTER_BYTES)
        if footer[:8] == b"APETAGEX":
            size = struct.unpack("<I", footer[12:16])[0]
            flags = struct.unpack("<I", footer[20:24])[0]
            total = size + (APE_FOOTER_BYTES if flags & 0x80000000 else 0)
            if APE_FOOTER_BYTES <= total <= min(MAX_APE_BYTES, end - start):
                end -= total
                tags.append("apev2")
    return end, tags


def _find_first_frame(
    src: Source, start: int, end: int, settings: AudioSettings
) -> tuple[int, FrameHeader] | None:
    """The first frame at or after `start`, confirmed by a matching second header (or by the
    end of the audio), within the bounded search window."""
    limit = min(end - 4, start + settings.mp3_sync_search_bytes)
    offset = start
    while offset <= limit:
        window = src.read(offset, min(4096, limit - offset + 4))
        if len(window) < 4:
            return None
        at = window.find(b"\xff")
        while 0 <= at <= len(window) - 4:
            candidate = offset + at
            header = parse_frame_header(window[at : at + 4])
            if header is not None and header.bitrate_index != 0:
                following = candidate + header.frame_length
                if following >= end:
                    return candidate, header
                second = parse_frame_header(src.read(following, 4))
                if second is not None and second.same_stream(header):
                    return candidate, header
            elif header is not None:  # free format: cannot be confirmed by length
                return candidate, header
            at = window.find(b"\xff", at + 1)
        offset += max(len(window) - 3, 1)
    return None


def _vbr_header(src: Source, offset: int, header: FrameHeader) -> dict:
    """A Xing/Info or VBRI header in the first frame: kind, declared frames and bytes."""
    found: dict = {"kind": None, "frames": None, "bytes": None}
    if header.layer != 3:
        return found
    xing_at = offset + 4 + (2 if header.protected else 0) + header.side_info_bytes
    body = src.read(xing_at, 16)
    if body[:4] in (b"Xing", b"Info") and len(body) >= 8:
        flags = struct.unpack(">I", body[4:8])[0]
        position = 8
        found["kind"] = "xing" if body[:4] == b"Xing" else "info"
        if flags & 1 and len(body) >= position + 4:
            found["frames"] = struct.unpack(">I", body[position : position + 4])[0]
            position += 4
        if flags & 2 and len(body) >= position + 4:
            found["bytes"] = struct.unpack(">I", body[position : position + 4])[0]
        return found
    vbri = src.read(offset + 4 + 32, 18)
    if vbri[:4] == b"VBRI" and len(vbri) >= 18:
        found["kind"] = "vbri"
        found["bytes"], found["frames"] = struct.unpack(">II", vbri[10:18])
    return found


def inspect_mp3(src: Source, report: Report, settings: AudioSettings) -> AudioFacts:
    facts = AudioFacts(detected_format="mp3", container="mpeg_audio", scan_unit="frame")
    structure = facts.structure
    start = _skip_id3v2(src, report, settings)
    structure["id3v2_bytes"] = start
    if start is None:
        return facts
    end, trailing_tags = _audio_end(src, start)
    structure["trailing_tags"] = trailing_tags
    found = _find_first_frame(src, start, end, settings)
    if found is None:
        report.error("mp3_no_frames", "No MPEG audio frames were found.")
        return facts
    first_offset, first = found
    if first_offset != start:
        report.warn(
            "mp3_leading_junk",
            "There are unreadable bytes before the first audio frame. Most players skip them.",
        )
    structure.update(
        {
            "first_frame_offset": first_offset,
            "mpeg_version": first.version,
            "layer": first.layer,
            "channel_mode": first.channel_mode,
            "crc_protected": first.protected,
        }
    )
    facts.sample_rate_hz = first.sample_rate
    facts.channels = first.channels
    facts.codec = {1: "mp1", 2: "mp2", 3: "mp3"}[first.layer]
    if first.layer != 3:
        report.error(
            "mp3_layer_unsupported",
            "This is MPEG audio Layer I or II, not Layer III (MP3). Only MP3 is supported.",
        )
    if first.bitrate_index == 0:
        report.error(
            "mp3_free_format_unsupported",
            "The MP3 uses free-format bit rate, which cannot be measured without decoding and "
            "is not supported.",
        )
        report.limitation(
            "mp3_free_format",
            "Free-format MP3 frames have no length in their header, so the stream was not "
            "walked and no duration is reported.",
        )
        return facts

    vbr = _vbr_header(src, first_offset, first)
    structure["vbr_header"] = vbr["kind"]
    structure["vbr_header_frames"] = vbr["frames"]
    structure["vbr_header_bytes"] = vbr["bytes"]

    scan = _walk(src, report, settings, first_offset, end, first)
    facts.units_scanned = scan.frames
    facts.scan_complete = scan.complete
    audio_frames = scan.frames - (1 if vbr["kind"] in ("xing", "info") else 0)
    structure.update(
        {
            "frames_scanned": scan.frames,
            "audio_frames_scanned": max(audio_frames, 0),
            "distinct_bitrates": len(scan.bitrates),
            "first_frame_bitrate_bps": first.bitrate,
            "audio_bytes": end - first_offset,
        }
    )
    if audio_frames <= 0 and scan.complete:
        report.error("mp3_no_audio_frames", "The MP3 has no audio frames.")
    _measure(facts, report, vbr, scan, first, end - first_offset, audio_frames)
    return facts


@dataclass
class _Scan:
    frames: int = 0
    complete: bool = False
    end_offset: int = 0
    bitrates: frozenset[int] = frozenset()
    bits: int = 0  # sum of frame bit rates over the frames walked (for an average)


def _walk(
    src: Source, report: Report, settings: AudioSettings, offset: int, end: int, first: FrameHeader
) -> _Scan:
    frames, bitrates, bits = 0, set(), 0
    mode_changed = False
    complete = False
    while True:
        if offset >= end:
            complete = True
            break
        if frames >= settings.max_mp3_frames:
            report.note(
                "mp3_scan_limit",
                "The frame walk stopped at its limit; later frames were not checked and the "
                "duration may be estimated.",
            )
            break
        header = parse_frame_header(src.read(offset, 4))
        if header is None:
            remaining = src.read(offset, min(end - offset, 4096))
            if any(remaining):
                report.error(
                    "trailing_data",
                    "Bytes after the last readable frame are not MPEG audio frames. The file "
                    "may be damaged or have other data appended.",
                    f"frame[{frames}]",
                )
            else:
                report.warn(
                    "mp3_trailing_padding", "The file ends with zero bytes after the last frame."
                )
            complete = True
            break
        if not header.same_stream(first):
            report.error(
                "mp3_stream_changes",
                "The MPEG version, layer or sample rate changes partway through the stream.",
                f"frame[{frames}]",
            )
            complete = True
            break
        if header.bitrate_index == 0:
            report.error(
                "mp3_free_format_unsupported",
                "A frame uses free-format bit rate, which is not supported.",
                f"frame[{frames}]",
            )
            complete = True
            break
        if header.channel_mode != first.channel_mode and not mode_changed:
            mode_changed = True
            report.warn(
                "mp3_channel_mode_changes",
                "The channel mode changes partway through the stream.",
                f"frame[{frames}]",
            )
        length = header.frame_length
        if offset + length > end:
            report.warn(
                "mp3_last_frame_truncated",
                "The last frame is cut short. Players usually skip it; the file may have been "
                "truncated.",
                f"frame[{frames}]",
            )
            complete = True
            break
        frames += 1
        bitrates.add(header.bitrate)
        bits += header.bitrate
        offset += length
    return _Scan(frames, complete, offset, frozenset(bitrates), bits)


def _measure(
    facts: AudioFacts,
    report: Report,
    vbr: dict,
    scan: _Scan,
    first: FrameHeader,
    audio_bytes: int,
    audio_frames: int,
) -> None:
    rate, spf = first.sample_rate, first.samples_per_frame
    declared = vbr["frames"]
    if vbr["kind"] in ("xing", "vbri"):
        facts.bitrate_mode = "variable"
    elif vbr["kind"] == "info" or len(scan.bitrates) == 1:
        facts.bitrate_mode = "constant"
    else:
        facts.bitrate_mode = "variable"
    report.limitation(
        "mp3_encoder_delay",
        "MP3 encoder delay and padding (gapless playback data) are not subtracted from the "
        "duration.",
    )
    if declared:
        facts.set_duration(declared * spf / rate, DURATION_EXACT)
        if scan.complete and abs(audio_frames - declared) > max(2, declared // 100):
            report.warn(
                "mp3_frame_count_mismatch",
                "The frame count in the VBR header does not match the frames in the file. The "
                "header's duration is reported; the file may be truncated or edited.",
            )
    else:
        if vbr["kind"] in (None, "info") and facts.bitrate_mode == "variable":
            report.warn(
                "mp3_vbr_without_header",
                "The bit rate varies but the file has no Xing or VBRI header, so its duration "
                "is an estimate. Some players show a wrong length or seek badly.",
            )
            report.limitation(
                "mp3_vbr_estimate",
                "Variable bit rate MP3 without a Xing or VBRI frame count: the duration is "
                "estimated from the frames walked.",
            )
        else:
            report.limitation(
                "mp3_cbr_estimate",
                "MP3 without a frame count header: the duration is estimated from the frames "
                "walked or from the byte length and bit rate.",
            )
        if scan.complete and audio_frames > 0:
            facts.set_duration(audio_frames * spf / rate, DURATION_ESTIMATED)
        elif scan.frames:
            average = scan.bits // scan.frames
            facts.set_duration(audio_bytes * 8 / average if average else None, DURATION_ESTIMATED)
    if facts.bitrate_mode == "constant":
        facts.bitrate_bps = first.bitrate if vbr["kind"] != "info" else _constant(scan, first)
    elif facts.duration_seconds:
        facts.bitrate_bps = int(audio_bytes * 8 / facts.duration_seconds)


def _constant(scan: _Scan, first: FrameHeader) -> int:
    """An Info frame is written at its own (often lowest) bit rate; the stream's is the other."""
    others = scan.bitrates - {first.bitrate}
    return next(iter(others)) if len(others) == 1 else first.bitrate
