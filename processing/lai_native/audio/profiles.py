"""Audio transcode profiles (LAI-LAMBDA-008b, ADR-067).

A pure-Python model and validator for the settings an audio transcode job uses. It calls no tool
and reads no file; `processor.py` turns a validated profile into FFmpeg arguments. Moved here
from the design branch's `lai_processing.contracts.audio_profiles` because everything that
touches the native tool lives in `lai_native` (`lai_processing` stays standard-library only).

Categories follow the Sound Manager channels (`lai/apps/audio/vocabulary.py`): `sfx`, `ui`,
`ambient`, `music` and `voice` (authored dialogue, never child speech). The numbers in
`DEFAULT_PROFILES` are the design targets (voice -16 LUFS, music -18, ambient -20, sfx peak -3
dBFS, ui peak -6 dBFS) with rationale in `docs/processing/AUDIO_TRANSCODING.md`. They stay
adjustable: a changed target is a new profile version, never an edit of a used one.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final, Literal

__all__ = [
    "CATEGORIES",
    "CONTENT_TYPES",
    "DEFAULT_PROFILES",
    "JOB_TYPE",
    "SHORT_AUDIO_SECONDS",
    "AudioTranscodeProfile",
    "LoudnessSpec",
    "OutputSpec",
    "ProfileProblem",
    "check_profile",
    "linear_gain_db",
    "loudness_within_tolerance",
    "profile_from_mapping",
    "validate_profile",
]

JOB_TYPE: Final = "asset.transcode_audio"

Category = Literal["sfx", "ui", "ambient", "music", "voice"]
CATEGORIES: Final = ("sfx", "ui", "ambient", "music", "voice")

Codec = Literal["opus", "mp3"]
Container = Literal["ogg", "mp3"]
CODEC_CONTAINER: Final = {"opus": "ogg", "mp3": "mp3"}
CONTENT_TYPES: Final = {"ogg": "audio/ogg", "mp3": "audio/mpeg"}
SAMPLE_RATES: Final = {
    "opus": frozenset({48_000, 24_000, 16_000}),
    "mp3": frozenset({48_000, 44_100, 32_000, 24_000, 22_050}),
}
# Quality presets name a bit rate (opus) or a LAME VBR quality (mp3); they never mix with an
# explicit bitrate_kbps. The values are the proposal, reviewed in the design document.
OPUS_PRESETS: Final = MappingProxyType({"low": 48, "standard": 64, "high": 96})
MP3_VBR_QUALITY: Final = MappingProxyType({"low": 6, "standard": 5, "high": 4})  # LAME -q:a (V)
OPUS_BITRATE_RANGE: Final = (16, 256)  # kbit/s, total for the stream
MP3_BITRATE_RANGE: Final = (32, 320)
MAX_OUTPUTS: Final = 3
MAX_INPUT_SECONDS: Final = 900  # 15 minutes, lai/apps/assets/validation_media.py
#: Below this duration integrated loudness (BS.1770 gating uses 400 ms blocks and a 3 s short-term
#: window) is unreliable, so a clip this short is normalised by peak instead.
SHORT_AUDIO_SECONDS: Final = 3.0

LoudnessMode = Literal["integrated", "peak", "none"]
_LABEL = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
_PROFILE_ID = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


@dataclass(frozen=True, slots=True)
class LoudnessSpec:
    """How level is set.

    `integrated`: EBU R128 / ITU-R BS.1770 integrated loudness to `integrated_lufs`, true peak
    at most `true_peak_dbtp`, loudness range capped at `lra_max` (linear gain only when the
    source already fits). `peak`: sample-peak normalisation to `peak_dbfs` (short clips, where
    integrated loudness is not meaningful). `none`: level untouched (reports only).
    """

    mode: LoudnessMode
    integrated_lufs: float | None = None
    true_peak_dbtp: float | None = None
    peak_dbfs: float | None = None
    lra_max: float | None = None
    tolerance_lu: float = 1.0
    short_term_flag_lufs: float | None = None  # report-only ceiling for the loudest 3 s


@dataclass(frozen=True, slots=True)
class OutputSpec:
    label: str
    codec: Codec
    sample_rate: int
    channels: (
        int | None
    )  # 1 or 2; None keeps the source layout (the inspector admits mono or stereo)
    bitrate_kbps: int | None = None
    quality: str | None = None  # preset name; exclusive with bitrate_kbps
    vbr: bool = True
    required: bool = True  # false: a failure of this output does not fail the job

    @property
    def container(self) -> Container:
        return CODEC_CONTAINER[self.codec]  # type: ignore[return-value]


@dataclass(frozen=True, slots=True)
class AudioTranscodeProfile:
    profile_id: str
    version: int
    category: Category
    description: str
    outputs: tuple[OutputSpec, ...]
    loudness: LoudnessSpec
    max_input_seconds: int = MAX_INPUT_SECONDS
    max_output_bytes: int = 20 * 1024 * 1024
    strip_metadata: bool = True
    #: Seamless-loop material (ambient beds): never padded or trimmed, and reviewed for loop
    #: points because lossy encoders add priming and padding (Opus pre-skip).
    loop: bool = False


@dataclass(frozen=True, slots=True)
class ProfileProblem:
    field: str
    reason: str


def _lm(value: float | None) -> bool:
    return value is not None and not isinstance(value, bool)


def validate_profile(profile: AudioTranscodeProfile) -> tuple[ProfileProblem, ...]:
    """Every problem found; an empty tuple means the profile is valid."""
    out: list[ProfileProblem] = []

    def bad(field: str, reason: str) -> None:
        out.append(ProfileProblem(field, reason))

    if not _PROFILE_ID.match(profile.profile_id):
        bad("profile_id", "must be a lower-case slug")
    if type(profile.version) is not int or not 1 <= profile.version <= 1_000_000:
        bad("version", "must be an integer from 1 to 1,000,000")
    if profile.category not in CATEGORIES:
        bad("category", "unknown category")
    if not 1 <= profile.max_input_seconds <= MAX_INPUT_SECONDS:
        bad("max_input_seconds", f"must be 1 to {MAX_INPUT_SECONDS}")
    if not 1 <= profile.max_output_bytes <= 20 * 1024 * 1024:
        bad("max_output_bytes", "must be 1 byte to 20 MiB")
    if profile.strip_metadata is not True:
        bad("strip_metadata", "metadata must always be stripped")
    if not 1 <= len(profile.outputs) <= MAX_OUTPUTS:
        bad("outputs", f"must hold 1 to {MAX_OUTPUTS} outputs")
    if profile.outputs and not any(o.required for o in profile.outputs):
        bad("outputs", "at least one output must be required")
    labels = [o.label for o in profile.outputs]
    if len(set(labels)) != len(labels):
        bad("outputs", "labels must be unique")
    containers = [o.container for o in profile.outputs if o.codec in CODEC_CONTAINER]
    if len(set(containers)) != len(containers):
        bad("outputs", "each container may appear once")

    for i, o in enumerate(profile.outputs):
        p = f"outputs[{i}]"
        if not _LABEL.match(o.label):
            bad(f"{p}.label", "must be a lower-case label")
        if o.codec not in CODEC_CONTAINER:
            bad(f"{p}.codec", "unknown codec")
            continue
        if o.sample_rate not in SAMPLE_RATES[o.codec]:
            bad(f"{p}.sample_rate", f"{o.codec} allows {sorted(SAMPLE_RATES[o.codec])}")
        if o.channels not in (None, 1, 2):
            bad(f"{p}.channels", "must be 1, 2 or None")
        if (o.bitrate_kbps is None) == (o.quality is None):
            bad(f"{p}.quality", "set exactly one of bitrate_kbps and quality")
        if o.quality is not None:
            table = OPUS_PRESETS if o.codec == "opus" else MP3_VBR_QUALITY
            if o.quality not in table:
                bad(f"{p}.quality", f"must be one of {sorted(table)}")
            if o.codec == "mp3" and not o.vbr:
                bad(f"{p}.vbr", "an mp3 quality preset is variable bit rate")
        if o.bitrate_kbps is not None:
            lo, hi = OPUS_BITRATE_RANGE if o.codec == "opus" else MP3_BITRATE_RANGE
            if type(o.bitrate_kbps) is not int or not lo <= o.bitrate_kbps <= hi:
                bad(f"{p}.bitrate_kbps", f"must be an integer from {lo} to {hi}")
        if o.codec == "mp3" and o.channels == 1 and o.sample_rate == 48_000:
            bad(f"{p}.sample_rate", "mono mp3 at 48 kHz is not offered; use 44100 or lower")

    ld = profile.loudness
    if ld.mode == "integrated":
        if not _lm(ld.integrated_lufs) or not -30.0 <= ld.integrated_lufs <= -9.0:  # type: ignore[operator]
            bad("loudness.integrated_lufs", "required, -30 to -9 LUFS")
        if not _lm(ld.true_peak_dbtp) or not -9.0 <= ld.true_peak_dbtp <= -0.1:  # type: ignore[operator]
            bad("loudness.true_peak_dbtp", "required, -9 to -0.1 dBTP")
        if ld.peak_dbfs is not None:
            bad("loudness.peak_dbfs", "not used with mode integrated")
        if ld.lra_max is not None and not 1.0 <= ld.lra_max <= 30.0:
            bad("loudness.lra_max", "1 to 30 LU")
    elif ld.mode == "peak":
        if not _lm(ld.peak_dbfs) or not -24.0 <= ld.peak_dbfs <= -0.1:  # type: ignore[operator]
            bad("loudness.peak_dbfs", "required, -24 to -0.1 dBFS")
        if (
            ld.integrated_lufs is not None
            or ld.true_peak_dbtp is not None
            or ld.lra_max is not None
        ):
            bad("loudness.mode", "peak mode takes only peak_dbfs")
    elif ld.mode == "none":
        if any(_lm(v) for v in (ld.integrated_lufs, ld.true_peak_dbtp, ld.peak_dbfs, ld.lra_max)):
            bad("loudness.mode", "mode none takes no targets")
    else:
        bad("loudness.mode", "unknown mode")
    if not 0.1 <= ld.tolerance_lu <= 3.0:
        bad("loudness.tolerance_lu", "0.1 to 3 LU")
    if ld.short_term_flag_lufs is not None and not -30.0 <= ld.short_term_flag_lufs <= 0.0:
        bad("loudness.short_term_flag_lufs", "-30 to 0 LUFS")
    return tuple(out)


def check_profile(profile: AudioTranscodeProfile) -> AudioTranscodeProfile:
    """Return the profile when valid, else raise ValueError naming the fields (never values)."""
    problems = validate_profile(profile)
    if problems:
        raise ValueError("invalid audio profile: " + ", ".join(p.field for p in problems))
    return profile


def linear_gain_db(measured_lufs: float, spec: LoudnessSpec, measured_true_peak: float) -> float:
    """Gain in dB that reaches the integrated target without exceeding the true-peak ceiling.

    Pure arithmetic for a measure-then-apply design. When the peak ceiling would be exceeded the
    gain is reduced (the result then undershoots the loudness target; a limiter is a separate,
    reviewed choice and is not assumed).
    """
    if spec.mode != "integrated" or spec.integrated_lufs is None or spec.true_peak_dbtp is None:
        raise ValueError("linear_gain_db needs an integrated loudness spec")
    wanted = spec.integrated_lufs - measured_lufs
    headroom = spec.true_peak_dbtp - measured_true_peak
    return min(wanted, headroom)


def loudness_within_tolerance(measured_lufs: float, spec: LoudnessSpec) -> bool:
    if spec.mode != "integrated" or spec.integrated_lufs is None:
        raise ValueError("needs an integrated loudness spec")
    return abs(measured_lufs - spec.integrated_lufs) <= spec.tolerance_lu


def _output(label: str, codec: Codec, rate: int, ch: int | None, **kw: object) -> OutputSpec:
    return OutputSpec(label=label, codec=codec, sample_rate=rate, channels=ch, **kw)  # type: ignore[arg-type]


DEFAULT_PROFILES: Final[Mapping[str, AudioTranscodeProfile]] = MappingProxyType(
    {
        p.profile_id: p
        for p in (
            AudioTranscodeProfile(
                "audio-sfx",
                1,
                "sfx",
                "Short effects: peak normalised, quiet ceiling.",
                (
                    _output("opus", "opus", 48_000, None, quality="standard"),
                    _output(
                        "mp3", "mp3", 44_100, None, bitrate_kbps=128, vbr=False, required=False
                    ),
                ),
                LoudnessSpec("peak", peak_dbfs=-3.0, short_term_flag_lufs=-14.0),
                max_input_seconds=30,
            ),
            AudioTranscodeProfile(
                "audio-ui",
                1,
                "ui",
                "Interface sounds: peak normalised lower than effects.",
                (
                    _output("opus", "opus", 48_000, 1, quality="low"),
                    _output("mp3", "mp3", 44_100, 1, bitrate_kbps=64, vbr=False, required=False),
                ),
                LoudnessSpec("peak", peak_dbfs=-6.0, short_term_flag_lufs=-18.0),
                max_input_seconds=10,
            ),
            AudioTranscodeProfile(
                "audio-ambient",
                1,
                "ambient",
                "Loops and beds: integrated loudness, low.",
                (
                    _output("opus", "opus", 48_000, 2, quality="standard"),
                    _output("mp3", "mp3", 44_100, 2, quality="standard", required=False),
                ),
                LoudnessSpec("integrated", -20.0, -1.0, lra_max=15.0),
                loop=True,
            ),
            AudioTranscodeProfile(
                "audio-music",
                1,
                "music",
                "Music: integrated loudness under narration.",
                (
                    _output("opus", "opus", 48_000, 2, quality="high"),
                    _output("mp3", "mp3", 44_100, 2, quality="high", required=False),
                ),
                LoudnessSpec("integrated", -18.0, -1.0, lra_max=20.0),
            ),
            AudioTranscodeProfile(
                "audio-voice",
                1,
                "voice",
                "Authored dialogue: speech target, mono.",
                (
                    _output("opus", "opus", 48_000, 1, bitrate_kbps=48),
                    _output("mp3", "mp3", 44_100, 1, bitrate_kbps=64, vbr=False, required=False),
                ),
                LoudnessSpec("integrated", -16.0, -1.0, lra_max=12.0),
            ),
        )
    }
)

_TOP_KEYS = frozenset(
    {
        "profile_id",
        "version",
        "category",
        "description",
        "outputs",
        "loudness",
        "max_input_seconds",
        "max_output_bytes",
        "strip_metadata",
        "loop",
    }
)


def profile_from_mapping(data: Mapping[str, object]) -> AudioTranscodeProfile:
    """Parse and validate a profile given as plain data (JSON-shaped). Unknown keys are refused."""
    if not isinstance(data, Mapping) or set(data) - _TOP_KEYS:
        raise ValueError("invalid audio profile: unknown or missing fields")
    try:
        outputs = tuple(OutputSpec(**dict(o)) for o in data["outputs"])  # type: ignore[arg-type, union-attr]
        profile = AudioTranscodeProfile(
            profile_id=data["profile_id"],  # type: ignore[arg-type]
            version=data["version"],  # type: ignore[arg-type]
            category=data["category"],  # type: ignore[arg-type]
            description=str(data.get("description", "")),
            outputs=outputs,
            loudness=LoudnessSpec(**dict(data["loudness"])),  # type: ignore[arg-type]
            **{
                k: data[k]
                for k in ("max_input_seconds", "max_output_bytes", "strip_metadata", "loop")
                if k in data
            },  # type: ignore[arg-type]
        )
    except (KeyError, TypeError) as exc:
        raise ValueError("invalid audio profile: unknown or missing fields") from exc
    return check_profile(profile)


for _p in DEFAULT_PROFILES.values():  # the shipped proposals must always be valid
    check_profile(_p)
