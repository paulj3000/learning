"""Validation of image and audio uploads (AM-13; `docs/ASSET_LIBRARY.md` section 21).

Like the model validator, these read untrusted bytes without decoding pixels or samples and
without executing anything:

- The format comes from the leading bytes, never from the file name or the client's content type.
- Every structure is walked with bounds (chunk lengths, page sizes, loop counts) and must end
  exactly where the file ends, so a valid image or sound with extra bytes appended (a polyglot
  that is also a script or archive) is refused.
- SVG, GIF, BMP, TIFF, AAC, FLAC and anything else not in `formats.FORMATS` are refused.
- Dimensions, channels, sample rates and durations are limited so one file cannot exhaust a
  browser's memory.

Each function returns a `ValidationResult` with `format`, `metadata` and findings.
"""

import struct
import zlib
from typing import IO

from django.conf import settings

from .validation import ValidationResult, _Stop

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_IMAGE_SIDE = 4096
MAX_IMAGE_PIXELS = 16_000_000
MAX_AUDIO_SECONDS = 15 * 60
MAX_CHUNKS = 100_000
MP3_BITRATES = {
    # (version, layer III) -> kbit/s by bitrate index
    "mpeg1": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    "mpeg2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
MP3_RATES = {"mpeg1": [44100, 48000, 32000], "mpeg2": [22050, 24000, 16000]}


def max_image_bytes() -> int:
    return int(getattr(settings, "LAI_ASSET_MAX_IMAGE_BYTES", 10 * 1024 * 1024))


def max_audio_bytes() -> int:
    return int(getattr(settings, "LAI_ASSET_MAX_AUDIO_BYTES", 20 * 1024 * 1024))


def sniff_format(head: bytes) -> str | None:
    """The format named by a file's first bytes, or None. Models are detected by the caller."""
    if head.startswith(PNG_SIGNATURE):
        return "png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[:4] == b"OggS":
        return "ogg"
    if head[:3] == b"ID3" or (len(head) >= 2 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0):
        return "mp3"
    return None


def _read(stream: IO[bytes], offset: int, length: int) -> bytes:
    stream.seek(offset)
    return stream.read(length)


def _size_ok(result: ValidationResult, size: int, limit: int, noun: str) -> None:
    if size <= 0:
        result.error("empty_file", "The file is empty.")
        raise _Stop
    if size > limit:
        result.error(
            "too_large", f"The {noun} is {size:,} bytes; the limit is {limit:,} bytes."
        )
        raise _Stop


# --- images ------------------------------------------------------------------------------------


def validate_image(stream: IO[bytes], *, size: int, file_format: str) -> ValidationResult:
    result = ValidationResult()
    try:
        _size_ok(result, size, max_image_bytes(), "image")
        result.format = file_format
        checker = {"png": _check_png, "jpeg": _check_jpeg, "webp": _check_webp}[file_format]
        width, height = checker(result, stream, size)
        _check_dimensions(result, width, height)
        result.metadata = {"width": width, "height": height}
    except _Stop:
        if not result.errors:  # pragma: no cover - every stop records why
            result.error("unreadable", "The file could not be read as an image.")
    finally:
        stream.seek(0)
    return result


def _check_dimensions(result: ValidationResult, width: int, height: int) -> None:
    if width < 1 or height < 1:
        result.error("image_dimensions", "The image has no pixels.")
        raise _Stop
    if width > MAX_IMAGE_SIDE or height > MAX_IMAGE_SIDE or width * height > MAX_IMAGE_PIXELS:
        result.error(
            "image_too_large",
            f"The image is {width} x {height} pixels; the limit is {MAX_IMAGE_SIDE} on a side "
            f"and {MAX_IMAGE_PIXELS:,} pixels in all. Resize it and export again.",
        )
        raise _Stop
    power_of_two = (width & (width - 1) == 0) and (height & (height - 1) == 0)
    if not power_of_two:
        result.warn(
            "not_power_of_two",
            "The sides are not powers of two. Some devices resample such textures, which can "
            "blur them.",
        )


def _check_png(result, stream, size):
    if _read(stream, 0, 8) != PNG_SIGNATURE:
        result.error("bad_signature", "This is not a PNG file.")
        raise _Stop
    offset, width, height, seen_idat, chunks = 8, 0, 0, False, 0
    while True:
        chunks += 1
        header = _read(stream, offset, 8)
        if len(header) < 8 or chunks > MAX_CHUNKS:
            result.error("png_truncated", "The PNG ends before its IEND chunk.")
            raise _Stop
        length, kind = struct.unpack(">I4s", header)
        if length > size or offset + 12 + length > size:
            result.error("png_chunk", "A PNG chunk is larger than the file.")
            raise _Stop
        if chunks == 1 and (kind != b"IHDR" or length != 13):
            result.error("png_header", "The PNG does not start with a valid IHDR chunk.")
            raise _Stop
        body = _read(stream, offset + 8, length + 4)
        data, crc = body[:length], struct.unpack(">I", body[length:])[0]
        if zlib.crc32(kind + data) & 0xFFFFFFFF != crc:
            result.error("png_crc", f"The PNG chunk {kind.decode('latin-1')!r} is corrupted.")
            raise _Stop
        if kind == b"IHDR":
            width, height = struct.unpack(">II", data[:8])
        elif kind == b"IDAT":
            seen_idat = True
        offset += 12 + length
        if kind == b"IEND":
            break
    if not seen_idat:
        result.error("png_no_data", "The PNG has no image data.")
        raise _Stop
    if offset != size:
        result.error("trailing_data", "The file has extra bytes after the end of the PNG.")
        raise _Stop
    return width, height


SOF_MARKERS = frozenset({0xC0, 0xC1, 0xC2})  # baseline, extended, progressive (Huffman)


def _check_jpeg(result, stream, size):
    if _read(stream, 0, 2) != b"\xff\xd8":
        result.error("bad_signature", "This is not a JPEG file.")
        raise _Stop
    offset, width, height, segments = 2, 0, 0, 0
    while True:
        segments += 1
        head = _read(stream, offset, 4)
        if len(head) < 4 or segments > MAX_CHUNKS:
            result.error("jpeg_truncated", "The JPEG ends before its image data.")
            raise _Stop
        if head[0] != 0xFF:
            result.error("jpeg_marker", "The JPEG has a corrupted segment header.")
            raise _Stop
        marker = head[1]
        if marker == 0xFF:  # fill byte
            offset += 1
            continue
        length = struct.unpack(">H", head[2:4])[0]
        if length < 2:
            result.error("jpeg_segment", "The JPEG has a corrupted segment.")
            raise _Stop
        if marker in SOF_MARKERS:
            body = _read(stream, offset + 4, 5)
            if len(body) < 5:
                result.error("jpeg_truncated", "The JPEG ends inside its frame header.")
                raise _Stop
            height, width = struct.unpack(">HH", body[1:5])
        elif 0xC3 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            result.error("jpeg_unsupported", "Arithmetic-coded and lossless JPEGs are not supported.")
            raise _Stop
        offset += 2 + length
        if marker == 0xDA:  # start of scan: entropy-coded data follows to the end marker
            break
        if offset >= size:
            result.error("jpeg_truncated", "The JPEG ends before its image data.")
            raise _Stop
    if not width:
        result.error("jpeg_no_frame", "The JPEG has no frame header.")
        raise _Stop
    tail = _read(stream, max(size - 2, 0), 2)
    if tail != b"\xff\xd9":
        result.error(
            "jpeg_end",
            "The JPEG does not end with its end marker. It may be truncated or have extra bytes "
            "appended.",
        )
        raise _Stop
    return width, height


def _check_webp(result, stream, size):
    head = _read(stream, 0, 30)
    if len(head) < 20 or head[:4] != b"RIFF" or head[8:12] != b"WEBP":
        result.error("bad_signature", "This is not a WebP file.")
        raise _Stop
    declared = struct.unpack("<I", head[4:8])[0] + 8
    if declared != size and declared + (declared & 1) != size:
        result.error(
            "webp_size", "The WebP size field does not match the file (truncated or extra bytes)."
        )
        raise _Stop
    kind = head[12:16]
    if kind == b"VP8X" and len(head) >= 30:
        width = 1 + int.from_bytes(head[24:27], "little")
        height = 1 + int.from_bytes(head[27:30], "little")
        if head[20] & 0x02:
            result.warn("webp_animated", "Animated WebP is shown as its first frame in some browsers.")
    elif kind == b"VP8L" and len(head) >= 25 and head[20] == 0x2F:
        bits = int.from_bytes(head[21:25], "little")
        width, height = 1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF)
    elif kind == b"VP8 " and len(head) >= 30 and head[23:26] == b"\x9d\x01\x2a":
        width = struct.unpack("<H", head[26:28])[0] & 0x3FFF
        height = struct.unpack("<H", head[28:30])[0] & 0x3FFF
    else:
        result.error("webp_header", "The WebP has an unrecognised or corrupted header.")
        raise _Stop
    return width, height


# --- audio -------------------------------------------------------------------------------------


def validate_audio(stream: IO[bytes], *, size: int, file_format: str) -> ValidationResult:
    result = ValidationResult()
    try:
        _size_ok(result, size, max_audio_bytes(), "audio file")
        result.format = file_format
        checker = {"mp3": _check_mp3, "wav": _check_wav, "ogg": _check_ogg}[file_format]
        metadata = checker(result, stream, size)
        _check_audio_limits(result, metadata)
        result.metadata = metadata
    except _Stop:
        if not result.errors:  # pragma: no cover - every stop records why
            result.error("unreadable", "The file could not be read as audio.")
    finally:
        stream.seek(0)
    return result


def _check_audio_limits(result: ValidationResult, metadata: dict) -> None:
    if metadata["channels"] not in (1, 2):
        result.error("audio_channels", "Only mono and stereo audio is supported.")
        raise _Stop
    if not 8000 <= metadata["sampleRate"] <= 96000:
        result.error("audio_sample_rate", "The sample rate must be between 8,000 and 96,000 Hz.")
        raise _Stop
    seconds = metadata["durationSeconds"]
    if seconds <= 0:
        result.error("audio_empty", "The audio has no sound in it.")
        raise _Stop
    if seconds > MAX_AUDIO_SECONDS:
        result.error(
            "audio_too_long",
            f"The audio is {seconds:.0f} seconds; the limit is {MAX_AUDIO_SECONDS} seconds.",
        )
        raise _Stop


def _id3_length(stream) -> int:
    head = _read(stream, 0, 10)
    if head[:3] != b"ID3":
        return 0
    if len(head) < 10 or any(b & 0x80 for b in head[6:10]):
        return -1
    footer = 10 if head[5] & 0x10 else 0
    return 10 + footer + ((head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9])


def _mp3_frame(header: bytes):
    """(frame length, bitrate bps, sample rate, channels, samples per frame) or None."""
    if len(header) < 4 or header[0] != 0xFF or header[1] & 0xE0 != 0xE0:
        return None
    version_bits, layer_bits = (header[1] >> 3) & 3, (header[1] >> 1) & 3
    if version_bits == 1 or layer_bits != 1:  # reserved version, or not Layer III
        return None
    bitrate_index, rate_index = header[2] >> 4, (header[2] >> 2) & 3
    if bitrate_index in (0, 15) or rate_index == 3:
        return None
    family = "mpeg1" if version_bits == 3 else "mpeg2"
    bitrate = MP3_BITRATES[family][bitrate_index] * 1000
    rate = MP3_RATES[family][rate_index]
    if version_bits == 0:
        rate //= 2  # MPEG 2.5
    padding = (header[2] >> 1) & 1
    samples = 1152 if family == "mpeg1" else 576
    length = samples // 8 * bitrate // rate + padding
    channels = 1 if header[3] >> 6 == 3 else 2
    return length, bitrate, rate, channels, samples


def _check_mp3(result, stream, size):
    start = _id3_length(stream)
    if start < 0 or start >= size:
        result.error("mp3_tags", "The MP3 has a corrupted ID3 tag.")
        raise _Stop
    offset, frames, bitrate, rate, channels, samples = start, 0, 0, 0, 0, 0
    # Walk frame headers for a bounded stretch to prove the file really is a sequence of frames.
    # A trailing ID3v1 tag ("TAG", 128 bytes) is allowed.
    end = size - 128 if _read(stream, size - 128, 3) == b"TAG" else size
    xing_frames = None
    while offset + 4 <= end and frames < 200_000:
        frame = _mp3_frame(_read(stream, offset, 4))
        if frame is None:
            break
        length, frame_bitrate, frame_rate, frame_channels, frame_samples = frame
        if frames == 0:
            bitrate, rate, channels, samples = frame_bitrate, frame_rate, frame_channels, frame_samples
            body = _read(stream, offset, 4 + 36 + 8)
            for tag in (b"Xing", b"Info"):
                at = body.find(tag, 4, 4 + 36)
                if at >= 0 and body[at + 7] & 1:
                    xing_frames = struct.unpack(">I", body[at + 8 : at + 12])[0]
        if frame_rate != rate:
            result.error("mp3_changes_rate", "The MP3 changes sample rate partway through.")
            raise _Stop
        if offset + length > end:
            result.error("mp3_truncated", "The MP3 ends inside a frame.")
            raise _Stop
        offset += length
        frames += 1
    if frames < 2:
        result.error("mp3_no_frames", "No valid MP3 audio frames were found.")
        raise _Stop
    if offset < end and any(_read(stream, offset, end - offset)[:4096]):
        result.error("trailing_data", "The file has unreadable bytes after the MP3 audio.")
        raise _Stop
    duration = (xing_frames or frames) * samples / rate
    return {
        "durationSeconds": round(duration, 3),
        "sampleRate": rate,
        "channels": channels,
        "bitrate": bitrate,
    }


def _check_wav(result, stream, size):
    head = _read(stream, 0, 12)
    if len(head) < 12 or head[:4] != b"RIFF" or head[8:12] != b"WAVE":
        result.error("bad_signature", "This is not a WAV file.")
        raise _Stop
    declared = struct.unpack("<I", head[4:8])[0] + 8
    if declared > size:
        result.error("wav_truncated", "The WAV file is shorter than its header says.")
        raise _Stop
    if declared < size and size - declared > 1:
        result.error("trailing_data", "The file has extra bytes after the end of the WAV.")
        raise _Stop
    offset, fmt, data_bytes, chunks = 12, None, None, 0
    while offset + 8 <= declared and chunks < MAX_CHUNKS:
        chunks += 1
        kind, length = struct.unpack("<4sI", _read(stream, offset, 8))
        if offset + 8 + length > declared:
            result.error("wav_chunk", "A WAV chunk is larger than the file.")
            raise _Stop
        if kind == b"fmt ":
            fmt = _read(stream, offset + 8, min(length, 40))
        elif kind == b"data":
            data_bytes = length
        offset += 8 + length + (length & 1)
    if fmt is None or len(fmt) < 16 or data_bytes is None:
        result.error("wav_chunks", "The WAV is missing its fmt or data chunk.")
        raise _Stop
    tag, channels, rate, byte_rate, _align, bits = struct.unpack("<HHIIHH", fmt[:16])
    if tag not in (1, 3) or bits not in (8, 16, 24, 32):
        result.error(
            "wav_codec", "Only uncompressed PCM or float WAV (8, 16, 24 or 32 bit) is supported."
        )
        raise _Stop
    if byte_rate <= 0:
        result.error("wav_header", "The WAV header is corrupted.")
        raise _Stop
    return {
        "durationSeconds": round(data_bytes / byte_rate, 3),
        "sampleRate": rate,
        "channels": channels,
        "bitsPerSample": bits,
    }


def _check_ogg(result, stream, size):
    offset, pages, codec, rate, channels, last_granule, ended = 0, 0, None, 0, 0, 0, False
    pre_skip = 0
    while offset < size and pages < MAX_CHUNKS:
        header = _read(stream, offset, 27)
        if len(header) < 27 or header[:4] != b"OggS" or header[4] != 0:
            result.error("ogg_page", "The Ogg file has a corrupted page.")
            raise _Stop
        flags, granule, _serial, _seq, _crc, segment_count = struct.unpack(
            "<BqIIIB", header[5:27]
        )
        table = _read(stream, offset + 27, segment_count)
        if len(table) < segment_count:
            result.error("ogg_truncated", "The Ogg file ends inside a page.")
            raise _Stop
        body_length = sum(table)
        if offset + 27 + segment_count + body_length > size:
            result.error("ogg_truncated", "The Ogg file ends inside a page.")
            raise _Stop
        if pages == 0:
            if not flags & 0x02:
                result.error("ogg_start", "The Ogg file does not start with a first page.")
                raise _Stop
            first = _read(stream, offset + 27 + segment_count, min(body_length, 19))
            if first[:7] == b"\x01vorbis" and len(first) >= 16:
                codec = "vorbis"
                channels = first[11]
                rate = struct.unpack("<I", first[12:16])[0]
            elif first[:8] == b"OpusHead" and len(first) >= 12:
                codec = "opus"
                channels = first[9]
                pre_skip = struct.unpack("<H", first[10:12])[0]
                rate = 48000
            else:
                result.error(
                    "ogg_codec", "Only Vorbis and Opus audio in Ogg is supported."
                )
                raise _Stop
        if granule >= 0:
            last_granule = granule
        ended = bool(flags & 0x04)
        offset += 27 + segment_count + body_length
        pages += 1
        if ended:
            break
    if not ended:
        result.error("ogg_truncated", "The Ogg stream has no end page. The file may be truncated.")
        raise _Stop
    if offset != size:
        result.error("trailing_data", "The file has extra bytes after the end of the Ogg stream.")
        raise _Stop
    if rate <= 0:
        result.error("ogg_header", "The Ogg header is corrupted.")
        raise _Stop
    seconds = max(last_granule - pre_skip, 0) / rate
    return {
        "durationSeconds": round(seconds, 3),
        "sampleRate": rate,
        "channels": channels,
        "codec": codec,
    }
