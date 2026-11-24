"""Ogg container inspection (RFC 3533) with Vorbis and Opus identification headers.

Pages are walked from the start, bounded by the page limit: capture pattern, version, header
flags, lacing table and body length are checked for every page, and the CRC for the first
`ogg_crc_pages` pages and the last page. Each logical stream is tracked by serial number: its
codec (from the first packet of its beginning-of-stream page), page sequence, last granule
position and end-of-stream flag. Several streams at once (multiplexing) and streams one after
another (chaining) are reported. The duration comes from the last granule position: Vorbis
granules count samples at the stream's rate; Opus granules count 48 kHz samples and include the
pre-skip (RFC 7845 section 4). Nothing is decoded.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Final

from .facts import (
    DURATION_ESTIMATED,
    DURATION_EXACT,
    MAX_SAFE_INT,
    AudioFacts,
    AudioSettings,
)
from .report import Report, Source

__all__ = ["identify_codec", "inspect_ogg", "ogg_crc"]

CAPTURE: Final = b"OggS"
HEADER_BYTES: Final = 27
MAX_PAGE_BYTES: Final = 27 + 255 + 255 * 255
OPUS_RATE: Final = 48_000
MAX_LISTED_STREAMS: Final = 8
AUDIO_CODECS: Final = frozenset({"vorbis", "opus"})
_SIGNATURES: Final = (
    (b"\x01vorbis", "vorbis"),
    (b"OpusHead", "opus"),
    (b"\x7fFLAC", "flac"),
    (b"Speex   ", "speex"),
    (b"\x80theora", "theora"),
    (b"fishead\x00", "skeleton"),
    (b"\x80kate", "kate"),
    (b"PCM     ", "pcm"),
    (b"OVP80", "vp8"),
    (b"\x01video\x00\x00\x00", "ogm_video"),
)


def _crc_table() -> tuple[int, ...]:
    table = []
    for index in range(256):
        value = index << 24
        for _ in range(8):
            value = ((value << 1) ^ 0x04C11DB7) if value & 0x80000000 else value << 1
        table.append(value & 0xFFFFFFFF)
    return tuple(table)


_CRC_TABLE: Final = _crc_table()


def ogg_crc(data: bytes) -> int:
    """The Ogg page checksum (CRC-32, polynomial 0x04C11DB7, no reflection, initial value 0)."""
    crc = 0
    for byte in data:
        crc = ((crc << 8) & 0xFFFFFFFF) ^ _CRC_TABLE[((crc >> 24) ^ byte) & 0xFF]
    return crc


def identify_codec(packet: bytes) -> str:
    for signature, codec in _SIGNATURES:
        if packet.startswith(signature):
            return codec
    return "unknown"


@dataclass
class _Stream:
    index: int
    link: int
    codec: str
    sample_rate: int | None = None
    channels: int | None = None
    pre_skip: int = 0
    input_sample_rate: int | None = None
    nominal_bitrate: int | None = None
    mapping_family: int | None = None
    last_granule: int | None = None
    sequence: int = 0
    pages: int = 0
    ended: bool = False

    def describe(self) -> dict:
        return {
            "index": self.index,
            "link": self.link,
            "codec": self.codec,
            "sample_rate_hz": self.sample_rate,
            "channels": self.channels,
            "pre_skip": self.pre_skip if self.codec == "opus" else None,
            "input_sample_rate_hz": self.input_sample_rate,
            "nominal_bitrate_bps": self.nominal_bitrate,
            "channel_mapping_family": self.mapping_family,
            "pages": self.pages,
            "ended": self.ended,
            "duration_seconds": self.seconds(),
        }

    def seconds(self) -> float | None:
        if self.codec not in AUDIO_CODECS or self.last_granule is None or not self.sample_rate:
            return None
        samples = self.last_granule - (self.pre_skip if self.codec == "opus" else 0)
        return round(max(samples, 0) / self.sample_rate, 6)


@dataclass
class _Page:
    offset: int
    length: int
    flags: int
    granule: int
    serial: int
    sequence: int
    crc: int
    lacing: bytes


def _read_page(src: Source, offset: int) -> tuple[_Page | None, str | None]:
    header = src.read(offset, HEADER_BYTES)
    if len(header) < HEADER_BYTES:
        return None, "ogg_truncated"
    if header[:4] != CAPTURE:
        return None, "ogg_capture_pattern"
    if header[4] != 0:
        return None, "ogg_version_unsupported"
    flags = header[5]
    granule, serial, sequence, crc, segments = struct.unpack("<qIIIB", header[6:27])
    lacing = src.read(offset + HEADER_BYTES, segments)
    if len(lacing) < segments:
        return None, "ogg_truncated"
    length = HEADER_BYTES + segments + sum(lacing)
    if offset + length > src.size:
        return None, "ogg_truncated"
    return _Page(offset, length, flags, granule, serial, sequence, crc, lacing), None


_PAGE_ERRORS: Final = {
    "ogg_truncated": "The file ends inside an Ogg page. The file is truncated.",
    "ogg_capture_pattern": "An Ogg page does not start with the OggS capture pattern; the "
    "file is damaged or has other data in it.",
    "ogg_version_unsupported": "An Ogg page uses an unknown stream structure version.",
}


def _crc_ok(src: Source, page: _Page) -> bool:
    data = bytearray(src.read(page.offset, page.length))
    if len(data) < page.length:  # pragma: no cover - the page was bounds-checked
        return False
    data[22:26] = b"\x00\x00\x00\x00"
    return ogg_crc(bytes(data)) == page.crc


def _first_packet(src: Source, page: _Page) -> bytes | None:
    """The first packet on `page` when it ends on that page, else None."""
    length = 0
    for value in page.lacing:
        length += value
        if value < 255:
            return src.read(page.offset + HEADER_BYTES + len(page.lacing), length)
    return None


def _identify(stream: _Stream, packet: bytes, report: Report, path: str) -> None:
    if stream.codec == "vorbis":
        if len(packet) < 30 or struct.unpack("<I", packet[7:11])[0] != 0 or not packet[29] & 1:
            report.error(
                "ogg_vorbis_header_invalid", "The Vorbis identification header is corrupted.", path
            )
            return
        stream.channels = packet[11] or None
        rate = struct.unpack("<I", packet[12:16])[0]
        stream.sample_rate = rate or None
        nominal = struct.unpack("<i", packet[20:24])[0]
        stream.nominal_bitrate = nominal if nominal > 0 else None
        if not packet[11]:
            report.error("ogg_no_channels", "The Vorbis header declares zero channels.", path)
        if not rate:
            report.error(
                "ogg_no_sample_rate", "The Vorbis header declares a zero sample rate.", path
            )
    elif stream.codec == "opus":
        if len(packet) < 19:
            report.error(
                "ogg_opus_header_invalid", "The Opus identification header is corrupted.", path
            )
            return
        version, channels, pre_skip, input_rate = struct.unpack("<BBHI", packet[8:16])
        family = packet[18]
        if version >> 4:
            report.error(
                "ogg_opus_version_unsupported",
                "The Opus header has an unsupported major version.",
                path,
            )
            return
        stream.channels = channels or None
        stream.sample_rate = OPUS_RATE
        stream.pre_skip = pre_skip
        stream.input_sample_rate = input_rate or None
        stream.mapping_family = family
        if not channels:
            report.error("ogg_no_channels", "The Opus header declares zero channels.", path)
        elif family == 0 and channels > 2:
            report.error(
                "ogg_opus_header_invalid",
                "The Opus header declares more than two channels without a channel mapping.",
                path,
            )
        elif family != 0 and len(packet) < 21 + channels:
            report.error(
                "ogg_opus_header_invalid", "The Opus channel mapping table is truncated.", path
            )


def inspect_ogg(src: Source, report: Report, settings: AudioSettings) -> AudioFacts:
    facts = AudioFacts(detected_format="ogg", container="ogg", scan_unit="page")
    streams: dict[int, _Stream] = {}
    order: list[_Stream] = []
    offset, pages, crc_checked = 0, 0, 0
    link, multiplexed, gap, granule_back = 0, False, False, False
    complete, last_page = False, None
    while True:
        if offset >= src.size:
            complete = True
            break
        if pages >= settings.max_ogg_pages:
            report.note(
                "ogg_scan_limit",
                "The page walk stopped at its limit; later pages were not checked and the "
                "duration is estimated from the last page.",
            )
            break
        page, problem = _read_page(src, offset)
        path = f"page[{pages}]"
        if page is None:
            report.error(problem or "ogg_truncated", _PAGE_ERRORS[problem or "ogg_truncated"], path)
            break
        pages += 1
        last_page = page
        if crc_checked < settings.ogg_crc_pages:
            crc_checked += 1
            if not _crc_ok(src, page):
                report.error("ogg_crc_mismatch", "An Ogg page checksum does not match.", path)
        if page.flags & 0xF8:
            report.warn("ogg_flags_reserved", "An Ogg page sets reserved header flags.", path)
        stream = streams.get(page.serial)
        if page.flags & 0x02:  # beginning of stream
            if stream is not None:
                report.error(
                    "ogg_duplicate_stream",
                    "Two logical streams use the same serial number.",
                    path,
                )
                break
            active = [s for s in order if not s.ended]
            if active:
                multiplexed = True
            elif order:
                link += 1
            packet = _first_packet(src, page)
            codec = identify_codec(packet) if packet is not None else "unknown"
            stream = _Stream(index=len(order), link=link, codec=codec, sequence=page.sequence)
            streams[page.serial] = stream
            order.append(stream)
            if packet is None:
                report.error(
                    "ogg_header_packet_invalid",
                    "A stream's first page does not hold a complete identification packet.",
                    path,
                )
            else:
                _identify(stream, packet, report, f"stream[{stream.index}]")
        elif stream is None:
            report.error(
                "ogg_page_without_stream",
                "A page belongs to a stream that never began.",
                path,
            )
            break
        elif page.sequence != (stream.sequence + 1) & 0xFFFFFFFF and not gap:
            gap = True
            report.warn(
                "ogg_page_sequence_gap",
                "Ogg page sequence numbers skip; pages may be missing.",
                path,
            )
        stream.sequence = page.sequence
        stream.pages += 1
        if stream.ended:
            report.error("ogg_page_after_end", "A page follows its stream's last page.", path)
        if page.granule != -1:
            if page.granule < 0 or page.granule > MAX_SAFE_INT:
                report.error(
                    "ogg_granule_out_of_range",
                    "A granule position is out of range.",
                    path,
                )
            else:
                if (
                    stream.last_granule is not None
                    and page.granule < stream.last_granule
                    and not granule_back
                ):
                    granule_back = True
                    report.warn(
                        "ogg_granule_decreasing",
                        "Granule positions go backwards; the duration may be wrong.",
                        path,
                    )
                stream.last_granule = page.granule
        if page.flags & 0x04:
            stream.ended = True
        offset += page.length

    if last_page is not None and crc_checked < pages and not _crc_ok(src, last_page):
        report.error(
            "ogg_crc_mismatch", "The last Ogg page's checksum does not match.", f"page[{pages - 1}]"
        )
        crc_checked += 1
    elif last_page is not None and crc_checked < pages:
        crc_checked += 1

    facts.units_scanned = pages
    facts.scan_complete = complete
    if not complete and not report.has_errors:
        _estimate_from_tail(src, streams)
    _summarise(facts, report, order, multiplexed, link, complete)
    if facts.duration_seconds:
        # The average over the whole file (container overhead included).
        facts.bitrate_bps = int(src.size * 8 / facts.duration_seconds)
    facts.structure.update(
        {
            "pages_scanned": pages,
            "crc_pages_checked": crc_checked,
            "stream_count": len(order),
            "chained_links": link + 1 if order else 0,
            "multiplexed": multiplexed,
        }
    )
    report.limitation(
        "ogg_crc_sampled",
        "Ogg page checksums are verified on the first pages and the last page only.",
    )
    return facts


def _estimate_from_tail(src: Source, streams: dict[int, _Stream]) -> None:
    """After a capped walk: the granule of the last page in the file, found backwards."""
    start = max(0, src.size - MAX_PAGE_BYTES)
    tail = b""
    position = start
    while position < src.size:  # bounded: at most two reads
        piece = src.read(position, src.size - position)
        if not piece:
            break
        tail += piece
        position += len(piece)
    at = tail.rfind(CAPTURE)
    while at >= 0:
        page, problem = _read_page(src, start + at)
        if page is not None and problem is None and page.serial in streams:
            stream = streams[page.serial]
            if page.granule != -1 and 0 <= page.granule <= MAX_SAFE_INT:
                stream.last_granule = page.granule
            stream.ended = bool(page.flags & 0x04)
            return
        at = tail.rfind(CAPTURE, 0, at)


def _summarise(
    facts: AudioFacts,
    report: Report,
    order: list[_Stream],
    multiplexed: bool,
    link: int,
    complete: bool,
) -> None:
    facts.structure["streams"] = [s.describe() for s in order[:MAX_LISTED_STREAMS]]
    facts.structure["streams_truncated"] = len(order) > MAX_LISTED_STREAMS
    if not order:
        report.error("ogg_no_streams", "The Ogg file holds no logical stream.")
        return
    for stream in order:
        path = f"stream[{stream.index}]"
        if stream.codec not in AUDIO_CODECS:
            report.error(
                "ogg_codec_unsupported",
                "A stream is not Vorbis or Opus audio (for example FLAC, Speex or video in Ogg). "
                "Only Vorbis and Opus are supported.",
                path,
            )
        if complete and not stream.ended:
            report.error(
                "ogg_no_end_of_stream",
                "A stream has no last page. The file may be truncated.",
                path,
            )
        if (
            stream.codec == "opus"
            and stream.last_granule is not None
            and stream.last_granule < stream.pre_skip
        ):
            report.error(
                "ogg_granule_before_preskip",
                "The Opus stream ends before its pre-skip; it holds no audio.",
                path,
            )
    if multiplexed:
        report.error(
            "ogg_multiplexed",
            "The Ogg file carries several logical streams at once. Only a single audio stream "
            "is supported.",
        )
    if link:
        report.warn(
            "ogg_chained",
            "The Ogg file is chained (one stream after another). Some players stop after the "
            "first part. The duration is the sum of the parts.",
        )
        report.limitation(
            "ogg_chained",
            "Chained Ogg: sample rate and channels are those of the first stream.",
        )
    audio = [s for s in order if s.codec in AUDIO_CODECS]
    primary = audio[0] if audio else order[0]
    facts.codec = primary.codec
    facts.sample_rate_hz = primary.sample_rate
    facts.channels = primary.channels
    if primary.codec in AUDIO_CODECS:
        facts.bitrate_mode = "variable"
    if not audio or multiplexed:
        return
    durations = [s.seconds() for s in audio]
    if any(d is None for d in durations):
        return
    total = sum(d for d in durations if d is not None)
    facts.set_duration(total, DURATION_EXACT if complete else DURATION_ESTIMATED)
