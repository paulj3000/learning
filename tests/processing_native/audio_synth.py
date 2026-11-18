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
