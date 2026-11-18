"""Synthetic WAV fixtures built with the standard library (no binary fixtures committed)."""

from __future__ import annotations

import array
import io
import math
import random
import wave


def _wav(samples: list[int], rate: int, channels: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(channels)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(array.array("h", samples).tobytes())
    return buffer.getvalue()


def make_wav(
    kind: str = "sine",
    seconds: float = 1.0,
    rate: int = 48_000,
    channels: int = 1,
    peak_dbfs: float = -12.0,
    freq: float = 440.0,
    seed: int = 1,
) -> bytes:
    """`sine`, `chord`, `speechlike` (4 Hz level modulation), `noise` or `silence`; the loudest
    sample sits at `peak_dbfs`. Deterministic."""
    frames = int(seconds * rate)
    amp = 32767 * 10 ** (peak_dbfs / 20.0)
    rng = random.Random(seed)
    out: list[int] = []
    for n in range(frames):
        t = n / rate
        if kind == "sine":
            v = math.sin(2 * math.pi * freq * t)
        elif kind == "chord":
            v = (
                math.sin(2 * math.pi * freq * t)
                + math.sin(2 * math.pi * freq * 1.25 * t)
                + math.sin(2 * math.pi * freq * 1.5 * t)
            ) / 3
        elif kind == "speechlike":
            v = math.sin(2 * math.pi * 180 * t) * (0.55 + 0.45 * math.sin(2 * math.pi * 4 * t))
        elif kind == "noise":
            v = rng.uniform(-1, 1)
        elif kind == "silence":
            v = 0.0
        else:
            raise ValueError(kind)
        sample = int(round(v * amp))
        out.extend([sample] * channels)
    return _wav(out, rate, channels)


def opus_tags(vendor: bytes = b"ffmpeg", comments: tuple[bytes, ...] = (b"encoder=Lavc libopus",)) -> bytes:
    import struct

    body = b"OpusTags" + struct.pack("<I", len(vendor)) + vendor + struct.pack("<I", len(comments))
    for comment in comments:
        body += struct.pack("<I", len(comment)) + comment
    return body


def ogg_opus_tagged(seconds: float = 2.0, channels: int = 2, *, tags: bytes | None = None) -> bytes:
    """A structurally valid Ogg Opus file (silent data) with a real `OpusTags` page."""
    import audio_builder as ab

    granule = int(seconds * 48000) + 312
    pages = [
        ab.ogg_page(ab.opus_head(channels, 312), flags=0x02, serial=1, sequence=0),
        ab.ogg_page(tags if tags is not None else opus_tags(), serial=1, sequence=1),
    ]
    for index in range(3):
        last = index == 2
        pages.append(
            ab.ogg_page(
                b"\x00" * 64,
                flags=0x04 if last else 0,
                granule=granule * (index + 1) // 3,
                serial=1,
                sequence=2 + index,
            )
        )
    return b"".join(pages)
