"""RIFF/WAVE header inspection: the fmt, fact and data chunks, without reading samples.

Facts follow the Microsoft RIFF and WAVEFORMATEX(TENSIBLE) layouts. The walk is bounded by the
chunk-count limit and by the file and RIFF sizes; every length is checked before it is used, and
odd-length chunks are followed by their pad byte. Only uncompressed PCM and IEEE float are
playable WAV for the Asset Library; other format tags are reported and refused.
"""

from __future__ import annotations

import struct
from typing import Final

from .facts import DURATION_ESTIMATED, DURATION_EXACT, AudioFacts, AudioSettings
from .report import Report, Source, chunk_label

__all__ = ["inspect_wav"]

FORMAT_TAGS: Final = {
    0x0001: "pcm",
    0x0002: "ms_adpcm",
    0x0003: "float",
    0x0006: "alaw",
    0x0007: "mulaw",
    0x0011: "ima_adpcm",
    0x0031: "gsm610",
    0x0050: "mpeg",
    0x0055: "mp3",
    0xFFFE: "extensible",
}
PLAYABLE: Final = frozenset({"pcm", "float"})
PCM_BITS: Final = frozenset({8, 16, 24, 32})
FLOAT_BITS: Final = frozenset({32, 64})
#: The tail of every KSDATAFORMAT_SUBTYPE GUID whose first two bytes are a format tag.
_GUID_TAIL: Final = b"\x00\x00\x00\x00\x10\x00\x80\x00\x00\xaa\x00\x38\x9b\x71"
MAX_SAMPLE_RATE: Final = 768_000
MAX_CHANNELS: Final = 255
#: Chunk ids listed in metadata (the count is always complete).
MAX_LISTED_CHUNKS: Final = 32


def inspect_wav(src: Source, report: Report, settings: AudioSettings) -> AudioFacts:
    facts = AudioFacts(detected_format="wav", container="riff_wave", scan_unit="chunk")
    head = src.read(0, 12)
    structure = facts.structure
    if len(head) < 12:
        report.error("wav_truncated", "The file ends inside the RIFF header.")
        return facts
    riff_id = head[:4]
    if riff_id in (b"RF64", b"BW64"):
        facts.container = "rf64"
        report.error(
            "wav_rf64_unsupported",
            "This is an RF64 (64-bit) WAV. Only standard RIFF WAV files are supported.",
        )
        return facts
    if riff_id == b"RIFX":
        facts.container = "rifx"
        report.error(
            "wav_big_endian_unsupported",
            "This is a big-endian (RIFX) WAV. Only little-endian RIFF WAV files are supported.",
        )
        return facts

    declared_end = struct.unpack("<I", head[4:8])[0] + 8
    structure["riff_declared_bytes"] = declared_end
    end = declared_end
    if declared_end > src.size:
        report.error(
            "wav_truncated",
            "The RIFF header declares more bytes than the file holds. The file is truncated.",
        )
        end = src.size
    elif declared_end < src.size:
        extra = src.size - declared_end
        structure["trailing_bytes"] = extra
        if not (extra == 1 and declared_end & 1):
            report.error("trailing_data", "The file has extra bytes after the end of the WAV.")

    chunks: list[str] = []
    fmt: bytes | None = None
    fmt_length = 0
    data_length: int | None = None
    data_available: int | None = None
    fact_frames: int | None = None
    offset, count = 12, 0
    while offset < end:
        if count >= settings.max_wav_chunks:
            report.error(
                "wav_too_many_chunks",
                "The WAV has more chunks than the inspector reads; it is not a normal WAV file.",
            )
            break
        header = src.read(offset, 8)
        if len(header) < 8 or offset + 8 > end:
            if not (end - offset == 1 and src.read(offset, 1) == b"\x00"):
                report.error("wav_chunk_truncated", "The file ends inside a chunk header.")
            break
        raw_id, length = header[:4], struct.unpack("<I", header[4:8])[0]
        count += 1
        if any(b < 0x20 or b > 0x7E for b in raw_id):
            report.error(
                "wav_chunk_id_invalid",
                "A chunk id is not text; the chunk table is corrupted.",
                f"chunk[{count - 1}]",
            )
            break
        if len(chunks) < MAX_LISTED_CHUNKS:
            chunks.append(chunk_label(raw_id))
        body_start = offset + 8
        body_end = body_start + length
        if body_end > end:
            if raw_id == b"data":
                data_length, data_available = length, end - body_start
                report.error(
                    "wav_data_truncated",
                    "The data chunk is longer than the file. The file is truncated, or it was "
                    "written as a stream without a final length.",
                )
            else:
                report.error(
                    "wav_chunk_overruns",
                    "A chunk is larger than the file; the chunk table is corrupted.",
                    f"chunk[{count - 1}]",
                )
            break
        if raw_id == b"fmt ":
            if fmt is not None:
                report.error("wav_duplicate_fmt", "The WAV has more than one fmt chunk.")
            else:
                fmt_length = length
                fmt = src.read(body_start, min(length, 64))
        elif raw_id == b"data":
            if data_length is not None:
                report.error("wav_duplicate_data", "The WAV has more than one data chunk.")
            else:
                data_length = data_available = length
                if fmt is None:
                    report.warn(
                        "wav_data_before_fmt",
                        "The data chunk comes before the fmt chunk. Some players cannot read "
                        "such files.",
                    )
        elif raw_id == b"fact" and length >= 4 and fact_frames is None:
            fact_frames = struct.unpack("<I", src.read(body_start, 4))[0]
        next_offset = body_end + (length & 1)
        if length & 1 and next_offset > end:
            report.warn(
                "wav_missing_pad_byte",
                "The last chunk has an odd length and no pad byte. Most players accept this.",
            )
            next_offset = body_end
        offset = next_offset

    facts.units_scanned = count
    facts.scan_complete = offset >= end
    structure["chunk_count"] = count
    structure["chunks"] = chunks
    structure["chunks_truncated"] = count > len(chunks)
    structure["fmt_chunk_bytes"] = fmt_length if fmt is not None else None
    structure["data_chunk_bytes"] = data_length
    structure["fact_sample_frames"] = fact_frames

    if fmt is None:
        report.error("wav_fmt_missing", "The WAV has no fmt chunk, so its format is unknown.")
        return facts
    if len(fmt) < 16:
        report.error("wav_fmt_invalid", "The fmt chunk is shorter than 16 bytes.")
        return facts
    _read_format(fmt, facts, report)
    if data_length is None:
        report.error("wav_data_missing", "The WAV has no data chunk, so it holds no audio.")
        return facts
    _duration(facts, report, data_available or 0, data_available != data_length, fact_frames)
    return facts


def _read_format(fmt: bytes, facts: AudioFacts, report: Report) -> None:
    structure = facts.structure
    tag, channels, rate, byte_rate, block_align, bits = struct.unpack("<HHIIHH", fmt[:16])
    structure.update(
        {
            "format_tag": tag,
            "byte_rate": byte_rate,
            "block_align": block_align,
            "bits_per_sample": bits,
        }
    )
    effective = tag
    if tag == 0xFFFE:
        if len(fmt) < 40 or struct.unpack("<H", fmt[16:18])[0] < 22:
            report.error(
                "wav_extensible_invalid", "The WAVE_FORMAT_EXTENSIBLE fmt chunk is too short."
            )
            effective = None
        else:
            valid_bits, channel_mask = struct.unpack("<HI", fmt[18:24])
            sub_tag = struct.unpack("<H", fmt[24:26])[0]
            structure["valid_bits_per_sample"] = valid_bits
            structure["channel_mask"] = channel_mask
            if fmt[26:40] != _GUID_TAIL:
                report.error(
                    "wav_extensible_subformat_unknown",
                    "The WAVE_FORMAT_EXTENSIBLE sub-format is not a known audio format.",
                )
                effective = None
            else:
                effective = sub_tag
                structure["subformat_tag"] = sub_tag
    codec = FORMAT_TAGS.get(effective, "unknown") if effective is not None else "unknown"
    if codec == "extensible":
        codec = "unknown"
    facts.codec = codec
    facts.channels = channels or None
    facts.sample_rate_hz = rate or None
    if channels == 0:
        report.error("wav_no_channels", "The fmt chunk declares zero channels.")
    elif channels > MAX_CHANNELS:  # pragma: no cover - a u16 above 255 channels
        report.error("wav_channels_invalid", "The fmt chunk declares an impossible channel count.")
    if rate == 0:
        report.error("wav_no_sample_rate", "The fmt chunk declares a sample rate of zero.")
    elif rate > MAX_SAMPLE_RATE:
        report.error(
            "wav_sample_rate_implausible",
            "The fmt chunk declares a sample rate above 768,000 Hz.",
        )
        facts.sample_rate_hz = None
    if codec not in PLAYABLE:
        report.error(
            "wav_codec_unsupported",
            "The WAV is not uncompressed PCM or IEEE float. Only those WAV encodings are "
            "supported.",
        )
        facts.bitrate_bps = byte_rate * 8 if byte_rate else None
        facts.bitrate_mode = "unknown"
        return
    allowed = PCM_BITS if codec == "pcm" else FLOAT_BITS
    if bits not in allowed:
        report.error(
            "wav_bits_unsupported",
            "The sample size is not supported (PCM: 8, 16, 24 or 32 bit; float: 32 or 64 bit).",
        )
        return
    facts.sample_width_bits = bits
    expected_align = channels * bits // 8
    if channels and block_align != expected_align:
        report.error(
            "wav_block_align_mismatch",
            "The block alignment does not match the channels and sample size.",
        )
    if channels and rate and byte_rate != rate * expected_align:
        report.warn(
            "wav_byte_rate_mismatch",
            "The byte rate in the header does not match the sample rate, channels and sample "
            "size. The computed rate is reported.",
        )
    if channels and rate and rate <= MAX_SAMPLE_RATE:
        facts.bitrate_bps = rate * expected_align * 8
        facts.bitrate_mode = "constant"


def _duration(
    facts: AudioFacts, report: Report, data_bytes: int, truncated: bool, fact_frames: int | None
) -> None:
    structure = facts.structure
    rate = facts.sample_rate_hz
    if facts.codec in PLAYABLE and facts.sample_width_bits and facts.channels and rate:
        align = facts.channels * facts.sample_width_bits // 8
        frames, remainder = divmod(data_bytes, align)
        structure["sample_frames"] = frames
        if remainder and not truncated:
            report.warn(
                "wav_partial_frame",
                "The data chunk does not hold a whole number of sample frames; the last "
                "partial frame is ignored.",
            )
        facts.set_duration(frames / rate, DURATION_ESTIMATED if truncated else DURATION_EXACT)
        if frames == 0:
            report.warn("wav_no_samples", "The data chunk holds no sample frames.")
        return
    if fact_frames is not None and rate:
        facts.set_duration(fact_frames / rate, DURATION_EXACT)
        return
    byte_rate = structure.get("byte_rate") or 0
    if byte_rate:
        facts.set_duration(data_bytes / byte_rate, DURATION_ESTIMATED)
