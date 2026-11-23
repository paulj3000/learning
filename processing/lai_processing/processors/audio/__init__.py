"""Audio header inspection (LAI-LAMBDA-008 phase 1), standard library only.

- `report`: findings, run warnings, limitations and bounded reads.
- `facts`: what a format module learned, and the scan bounds.
- `wav`, `mp3`, `ogg`: the format modules (RIFF/WAVE; MPEG audio with ID3v2, Xing/Info/VBRI;
  Ogg with Vorbis and Opus identification headers).
- `inspector`: format detection from the bytes, the declared-type check and the metadata object.
- `processor`: the `asset.audio_inspector` processor and its `audio-inspect` profile.

See `docs/processing/AUDIO_INSPECTION.md`.
"""

from .facts import AudioSettings
from .inspector import Inspection, inspect_audio, sniff
from .processor import AUDIO_PROFILE, AudioInspectorProcessor

__all__ = [
    "AUDIO_PROFILE",
    "AudioInspectorProcessor",
    "AudioSettings",
    "Inspection",
    "inspect_audio",
    "sniff",
]
