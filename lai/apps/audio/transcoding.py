"""Audio transcoding and normalising in the background (`asset.transcode_audio`, ADR-067).

Staff trigger this from the Sound Manager (Django Admin) on one stored audio version. It is the
Sound Manager side of the derived-artifact foundation (ADR-066, docs/processing/DERIVED_ARTIFACTS.md):

- `submit_transcode(version, normalize=, user=, channel=)` builds the request with
  `apps.assets.artifact_jobs.submit_derived_job` (so namespace, input identity, idempotency key,
  expiry and the resubmission cap are the shared ones) and sends it on the `audio` queue, only while
  `LAI_AUDIO_TRANSCODING` is on (`WorkloadUnavailable`, with a safe message, otherwise; nothing is
  recorded).
- The two staff actions differ by one option: **Transcode** converts to Opus (primary) and MP3
  (alternative) and only measures the level (`normalize=False`); **Normalize** converts and sets the
  level to the cue channel's target (`normalize=True`). The profile is `audio-<channel>` v1.
- The worker returns outputs as private artifacts; `apps.assets.artifact_results` verifies and
  records them as `DerivedArtifact` rows (`pending_review`). **Nothing here changes a version, a
  cue or a release**: outputs reach the game only when staff promote one artifact into a new
  unpublished version (`apps.assets.artifact_promotion.promote_artifact`) and publish it through
  the Asset Library and a sound release. Only staff-authored Sound Manager audio is processed,
  never child audio.

Logs carry ids and codes only.
"""

import logging
from dataclasses import dataclass

logger = logging.getLogger("lai.audio")

JOB_TYPE = "asset.transcode_audio"
PROFILE_VERSION = 1
SUBJECT_TYPE = "asset_version"
JOB_SUBJECT = "assets.assetversion"
PROCESSOR_ID = "asset.audio_transcoder"
#: Same formats the inspector applies to (lai/apps/assets/formats.py, family audio).
AUDIO_FORMATS = frozenset({"mp3", "wav", "ogg"})


class TranscodeRefused(Exception):
    """A request refused before anything was submitted. `message` is safe to show staff."""

    MESSAGES = {
        "not_audio": "This version is not an audio file.",
        "channel_needed": "Choose a cue first: this file is used on no cue or on several channels, "
        "so its loudness target is not clear. Use the action on a Sound cue.",
        "bad_channel": "That channel has no transcoding profile.",
    }

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code
        self.message = self.MESSAGES.get(code, "The request was refused.")


def profile_id(channel: str) -> str:
    return f"audio-{channel}"


def processor_version() -> str:
    from lai_native.audio.engine import AudioTranscodeProcessor

    return AudioTranscodeProcessor.version


def resolve_processor(profile_id_: str, version: int):
    """Resolver for `artifact_results.PROCESSOR_VERSION_RESOLVERS`: the (processor id, version)
    this build expects for a profile, or None for an unknown one."""
    from lai_native.audio.profiles import DEFAULT_PROFILES

    profile = DEFAULT_PROFILES.get(profile_id_)
    if profile is None or profile.version != version:
        return None
    return PROCESSOR_ID, processor_version()


def register() -> None:
    """Register the processor version resolver (called from `AudioConfig.ready`)."""
    from apps.assets import artifact_results

    artifact_results.PROCESSOR_VERSION_RESOLVERS[JOB_TYPE] = resolve_processor


def channels_for(version) -> list[str]:
    """The Sound Manager channels of the cues that use this file's asset."""
    from .models import SoundCue

    return sorted(
        SoundCue.objects.filter(asset_id=version.asset_id).values_list("channel", flat=True).distinct()
    )


def choose_channel(version, channel: str | None = None) -> str:
    from .vocabulary import Channel

    if channel is not None:
        if channel not in Channel.values:
            raise TranscodeRefused("bad_channel")
        return channel
    found = channels_for(version)
    if len(found) != 1:
        raise TranscodeRefused("channel_needed")
    return found[0]


def transcode_jobs(version):
    from apps.assets.artifact_jobs import derived_jobs

    return derived_jobs(version, JOB_TYPE)


def latest_job(version):
    if not hasattr(version, "_lai_audio_transcode"):
        version._lai_audio_transcode = transcode_jobs(version).first()
    return version._lai_audio_transcode


def submit_transcode(version, *, normalize: bool, user, channel: str | None = None):
    """Submit (or return) the transcode job for `version`. Never changes the version.

    Raises `TranscodeRefused` (not audio, no single channel), `apps.jobs.services.WorkloadUnavailable`
    (`LAI_AUDIO_TRANSCODING` off or no queue: nothing recorded), `JobsDisabled`, or `JobsError`
    (a contract code, `attempts_exhausted`)."""
    from apps.assets.artifact_jobs import submit_derived_job
    from lai_native.audio.engine import AUDIO_TRANSCODE_LIMITS
    from apps.jobs import services as jobs

    if version.format not in AUDIO_FORMATS:
        raise TranscodeRefused("not_audio")
    jobs.require_workload(JOB_TYPE)  # refuse (safe message) before any lookup
    chosen = choose_channel(version, channel)
    job = submit_derived_job(
        version,
        kind=JOB_TYPE,
        profile=(profile_id(chosen), PROFILE_VERSION),
        processor_version=processor_version(),
        options={"normalize": bool(normalize)},
        limits=AUDIO_TRANSCODE_LIMITS,
        user=user,
    )
    version._lai_audio_transcode = job
    return job


# --- results (for display; every value is rendered escaped by the admin) ----------------------------


@dataclass(frozen=True)
class OutputView:
    label: str
    content_type: str
    duration_seconds: object
    bitrate_kbps: object
    sample_rate_hz: object
    channels: object
    size_bytes: object
    before: dict
    after: dict
    gain_db: object
    artifact_id: str | None
    artifact_state: str | None


def _num(value):
    return value if isinstance(value, int | float) and not isinstance(value, bool) else None


def summary(job) -> dict | None:
    """The facts of a completed, applied job, or None."""
    from apps.assets import artifact_results

    if job is None or job.status != "completed":
        return None
    if job.subject_outcome not in artifact_results.APPLIED_OUTCOMES:
        return None
    result = job.result if isinstance(job.result, dict) else None
    if not result or result.get("status") != "succeeded":
        return None
    metadata = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
    source = metadata.get("source") if isinstance(metadata.get("source"), dict) else {}
    gains = metadata.get("gain_db") if isinstance(metadata.get("gain_db"), dict) else {}
    before = (
        metadata.get("measured_before") if isinstance(metadata.get("measured_before"), dict) else {}
    )
    from apps.assets.models import DerivedArtifact

    rows = {a.logical_id: a for a in DerivedArtifact.objects.filter(job=job)}
    outputs = []
    for item in (metadata.get("outputs") or [])[:4]:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label", ""))[:32]
        artifact = rows.get(label)
        b = before.get(label) if isinstance(before.get(label), dict) else {}
        a = item.get("measured_after") if isinstance(item.get("measured_after"), dict) else {}
        outputs.append(
            OutputView(
                label=label,
                content_type=str(item.get("content_type", ""))[:64],
                duration_seconds=_num(item.get("duration_seconds")),
                bitrate_kbps=_num(item.get("bitrate_kbps")),
                sample_rate_hz=_num(item.get("sample_rate_hz")),
                channels=_num(item.get("channels")),
                size_bytes=_num(item.get("size_bytes")),
                before={k: _num(v) for k, v in b.items() if k != "mode"},
                after={k: _num(v) for k, v in a.items()},
                gain_db=_num(gains.get(label)),
                artifact_id=str(artifact.pk) if artifact else None,
                artifact_state=artifact.state if artifact else None,
            )
        )
    findings = [
        {
            "code": str(f.get("code", ""))[:64],
            "severity": str(f.get("severity", ""))[:16],
            "message": str(f.get("message", ""))[:300],
            "path": str(f.get("path", ""))[:32],
        }
        for f in (result.get("findings") or [])[:50]
        if isinstance(f, dict)
    ]
    tool = metadata.get("tool") if isinstance(metadata.get("tool"), dict) else {}
    profile = result.get("profile") or {}
    return {
        "normalize": bool(metadata.get("normalize")),
        "profile": f"{profile.get('profile_id', '')} v{profile.get('version', '')}",
        "source_format": str(source.get("format", ""))[:16],
        "source_codec": str(source.get("codec", ""))[:16],
        "source_duration_seconds": _num(source.get("duration_seconds")),
        "source_sample_rate_hz": _num(source.get("sample_rate_hz")),
        "source_channels": _num(source.get("channels")),
        "tool": f"{tool.get('name', '')} {tool.get('version', '')}".strip()[:64],
        "outputs": outputs,
        "findings": findings,
    }
