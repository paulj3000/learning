"""Synthetic audio files for the audio inspector tests (LAI-LAMBDA-008). Built in code; no
binary fixtures and nothing downloaded. Headers are exact; sample data is silence (zeros).

The Ogg page checksum here is an independent bit-by-bit implementation, so a CRC test does not
just compare the inspector with itself.
"""

from __future__ import annotations

import struct

# --- WAV -------------------------------------------------------------------------------------


def wav(
    seconds: float = 1.0,
    rate: int = 8000,
    channels: int = 1,
    bits: int = 16,
    tag: int = 1,
    *,
    extra_chunks: tuple[tuple[bytes, bytes], ...] = (),
    data_length: int | None = None,
    fmt_override: bytes | None = None,
) -> bytes:
    block = channels * bits // 8
    data = b"\x00" * (int(rate * seconds) * block)
    fmt = fmt_override or struct.pack("<HHIIHH", tag, channels, rate, rate * block, block, bits)
    body = b"WAVE" + chunk(b"fmt ", fmt)
    for kind, payload in extra_chunks:
        body += chunk(kind, payload)
    length = len(data) if data_length is None else data_length
    body += b"data" + struct.pack("<I", length) + data + (b"\x00" if len(data) & 1 else b"")
    return b"RIFF" + struct.pack("<I", len(body)) + body


def chunk(kind: bytes, payload: bytes) -> bytes:
    return kind + struct.pack("<I", len(payload)) + payload + (b"\x00" if len(payload) & 1 else b"")


# --- MP3 -------------------------------------------------------------------------------------

MPEG1_L3_KBPS = (32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320)


def mp3_frame(
    kbps: int = 128, *, rate_index: int = 0, mono: bool = False, padding: int = 0
) -> bytes:
    """One MPEG-1 Layer III frame (44.1 kHz for rate index 0) with a zero body."""
    index = MPEG1_L3_KBPS.index(kbps) + 1
    rate = (44100, 48000, 32000)[rate_index]
    header = bytes(
        [0xFF, 0xFB, (index << 4) | (rate_index << 2) | (padding << 1), (3 if mono else 1) << 6]
    )
    length = 144 * kbps * 1000 // rate + padding
    return header + b"\x00" * (length - 4)


def xing_frame(frames: int, audio_bytes: int, *, tag: bytes = b"Xing", kbps: int = 128) -> bytes:
    """A Xing (or Info) frame for joint-stereo MPEG-1 Layer III: side info is 32 bytes."""
    frame = bytearray(mp3_frame(kbps))
    body = tag + struct.pack(">III", 0x3, frames, audio_bytes)
    frame[4 + 32 : 4 + 32 + len(body)] = body
    return bytes(frame)


def id3v2(payload_bytes: int = 20) -> bytes:
    size = payload_bytes
    synchsafe = bytes([(size >> 21) & 0x7F, (size >> 14) & 0x7F, (size >> 7) & 0x7F, size & 0x7F])
    return b"ID3\x03\x00\x00" + synchsafe + b"\x00" * payload_bytes


def mp3_cbr(frames: int = 40, kbps: int = 128, *, tag: bool = True) -> bytes:
    return (id3v2() if tag else b"") + mp3_frame(kbps) * frames


def mp3_vbr_xing(rates: tuple[int, ...] = (128, 192, 64, 320)) -> bytes:
    frames = [mp3_frame(k) for k in rates * 10]
    audio = b"".join(frames)
    return id3v2() + xing_frame(len(frames), len(audio) + 417) + audio


def mp3_vbr_without_header(rates: tuple[int, ...] = (128, 192, 64, 320)) -> bytes:
    return b"".join(mp3_frame(k) for k in rates * 10)


# --- Ogg -------------------------------------------------------------------------------------


def ogg_crc(data: bytes) -> int:
    crc = 0
    for byte in data:
        crc ^= byte << 24
        for _ in range(8):
            crc = ((crc << 1) ^ 0x04C11DB7) if crc & 0x80000000 else crc << 1
            crc &= 0xFFFFFFFF
    return crc


def ogg_page(
    body: bytes,
    *,
    flags: int = 0,
    granule: int = 0,
    serial: int = 1,
    sequence: int = 0,
    good_crc: bool = True,
) -> bytes:
    lacing = bytearray()
    remaining = len(body)
    while remaining >= 255:
        lacing.append(255)
        remaining -= 255
    lacing.append(remaining)
    header = (
        b"OggS\x00"
        + bytes([flags])
        + struct.pack("<qIII", granule, serial, sequence, 0)
        + bytes([len(lacing)])
        + bytes(lacing)
    )
    page = bytearray(header + body)
    crc = ogg_crc(bytes(page))
    page[22:26] = struct.pack("<I", crc if good_crc else crc ^ 1)
    return bytes(page)


def vorbis_id(rate: int = 44100, channels: int = 2, nominal: int = 128000) -> bytes:
    return (
        b"\x01vorbis"
        + struct.pack("<IBIiii", 0, channels, rate, 0, nominal, 0)
        + bytes([0xB8, 0x01])
    )


def opus_head(channels: int = 2, pre_skip: int = 312, input_rate: int = 48000) -> bytes:
    return b"OpusHead" + struct.pack("<BBHIhB", 1, channels, pre_skip, input_rate, 0, 0)


def flac_in_ogg_id() -> bytes:
    return b"\x7fFLAC\x01\x00\x00\x01fLaC" + b"\x00" * 38


def ogg_stream(
    ident: bytes,
    final_granule: int,
    *,
    serial: int = 1,
    data_pages: int = 3,
    end: bool = True,
) -> list[bytes]:
    """BOS page with `ident`, a comment-ish page, then `data_pages` data pages; the last one
    carries `final_granule` and (when `end`) the EOS flag."""
    pages = [ogg_page(ident, flags=0x02, serial=serial, sequence=0)]
    pages.append(ogg_page(b"\x03comment" + b"\x00" * 8, serial=serial, sequence=1))
    for index in range(data_pages):
        last = index == data_pages - 1
        granule = final_granule * (index + 1) // data_pages
        pages.append(
            ogg_page(
                b"\x00" * 64,
                flags=0x04 if (last and end) else 0,
                granule=granule,
                serial=serial,
                sequence=2 + index,
            )
        )
    return pages


def ogg_vorbis(seconds: float = 2.0, rate: int = 44100, channels: int = 2, **kwargs) -> bytes:
    return b"".join(ogg_stream(vorbis_id(rate, channels), int(seconds * rate), **kwargs))


def ogg_opus(seconds: float = 2.0, channels: int = 2, pre_skip: int = 312, **kwargs) -> bytes:
    granule = int(seconds * 48000) + pre_skip
    return b"".join(ogg_stream(opus_head(channels, pre_skip), granule, **kwargs))
