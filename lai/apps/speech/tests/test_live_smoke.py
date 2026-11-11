"""SM-P8-LIVE: the opt-in live smoke command.

The command's own logic runs against a stubbed client here. The one test that calls real AWS
is skipped unless `LAI_SPEECH_LIVE_AWS=1` is set (with credentials and
`LAI_SPEECH_LIVE_REGION`); it is never part of the default suite.
"""

import os
from io import StringIO

import pytest
from django.core.management import CommandError, call_command

from apps.speech.management.commands import speech_live_smoke
from apps.speech.models import SpeechClip
from apps.speech.polly import Boto3PollyClient, SpeechError

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00\xff\xfb" + b"\x00" * 4000


class FakeAws:
    """Stands in for `Boto3PollyClient` with the same surface (synthesize, voice_report)."""

    def __init__(self, *, offered=None, synth_error=None, audio=MP3):
        self.offered = offered
        self.synth_error = synth_error
        self.audio = audio
        self.synth_calls = []

    def voice_report(self, language):
        if self.offered is not None:
            return self.offered.get(language, {})
        from apps.speech.voices import SUPPORTED_VOICES

        return {
            voice: engines[language]
            for voice, engines in SUPPORTED_VOICES.items()
            if language in engines
        }

    def synthesize(self, *, text, text_type, voice_id, engine, language):
        self.synth_calls.append(voice_id)
        if voice_id == "NotARealVoice":
            raise SpeechError(
                "speech_unavailable", "This voice is not available.", reason="invalid_voice"
            )
        if self.synth_error:
            raise self.synth_error
        return self.audio


@pytest.fixture
def live_settings(settings):
    settings.LAI_SPEECH_PROVIDER = "polly"
    settings.LAI_SPEECH_AWS_REGION = "us-east-1"
    return settings


def run(monkeypatch, client, *args):
    monkeypatch.setattr(speech_live_smoke.Command, "make_client", lambda self: client)
    out = StringIO()
    call_command("speech_live_smoke", *args, stdout=out)
    return out.getvalue()


def test_refuses_without_the_explicit_confirmation(live_settings, monkeypatch):
    client = FakeAws()
    with pytest.raises(CommandError, match="--confirm-live-aws"):
        run(monkeypatch, client)
    assert client.synth_calls == []


def test_refuses_unless_the_provider_is_polly(settings, monkeypatch):
    settings.LAI_SPEECH_PROVIDER = "fake"
    with pytest.raises(CommandError, match="LAI_SPEECH_PROVIDER=polly"):
        run(monkeypatch, FakeAws(), "--confirm-live-aws")


def test_a_healthy_service_passes_every_step_and_leaves_nothing(live_settings, monkeypatch):
    client = FakeAws()
    out = run(monkeypatch, client, "--confirm-live-aws")
    assert "LIVE SMOKE TEST PASSED." in out
    for step in ("region", "synthesis", "cache", "storage", "fallback (aws)", "fallback (table)"):
        assert f"PASS {step}:" in out, out
    assert "voice=Justin engine=neural" in out
    # Sample once, cache once (one call for two requests), then the invalid-voice probe.
    assert client.synth_calls == ["Justin", "Justin", "NotARealVoice"]
    assert SpeechClip.objects.count() == 0  # cleaned up


def test_keep_leaves_the_sample_clip_and_save_writes_the_mp3(live_settings, monkeypatch, tmp_path):
    target = tmp_path / "pip.mp3"
    out = run(monkeypatch, FakeAws(), "--confirm-live-aws", "--keep", "--save-mp3", str(target))
    assert "LIVE SMOKE TEST PASSED." in out
    assert target.read_bytes() == MP3 and SpeechClip.objects.count() == 1


def test_a_failed_synthesis_fails_the_run(live_settings, monkeypatch):
    client = FakeAws(synth_error=SpeechError("speech_unavailable", "x", reason="access_denied"))
    with pytest.raises(CommandError, match="LIVE SMOKE TEST FAILED"):
        run(monkeypatch, client, "--confirm-live-aws")


def test_a_credential_refusal_does_not_count_as_a_verified_fallback(live_settings, monkeypatch):
    class Denied(FakeAws):
        def synthesize(self, **kwargs):
            raise SpeechError("speech_unavailable", "x", reason="access_denied")

    out = StringIO()
    monkeypatch.setattr(speech_live_smoke.Command, "make_client", lambda self: Denied())
    with pytest.raises(CommandError):
        call_command("speech_live_smoke", "--confirm-live-aws", stdout=out)
    assert "FAIL fallback (aws): not verified" in out.getvalue()


def test_audio_that_is_not_mp3_fails_the_run(live_settings, monkeypatch):
    with pytest.raises(CommandError, match="FAILED"):
        run(monkeypatch, FakeAws(audio=b"not audio" * 500), "--confirm-live-aws")


def test_a_region_without_the_voice_fails_and_table_gaps_warn(live_settings, monkeypatch):
    out = StringIO()
    client = FakeAws(offered={"en-US": {"Joanna": ("neural",)}, "en-GB": {}})
    monkeypatch.setattr(speech_live_smoke.Command, "make_client", lambda self: client)
    with pytest.raises(CommandError):
        call_command("speech_live_smoke", "--confirm-live-aws", stdout=out)
    text = out.getvalue()
    assert "FAIL region: Justin neural is not offered" in text
    assert "WARN voice table:" in text


def test_an_unknown_profile_is_refused(live_settings, monkeypatch):
    with pytest.raises(CommandError, match="No voice profile"):
        run(monkeypatch, FakeAws(), "--confirm-live-aws", "--profile", "nobody")


def test_the_real_client_is_what_runs_by_default():
    assert isinstance(speech_live_smoke.Command().make_client(), Boto3PollyClient)


@pytest.mark.skipif(
    os.environ.get("LAI_SPEECH_LIVE_AWS") != "1",
    reason="LIVE AWS: set LAI_SPEECH_LIVE_AWS=1, LAI_SPEECH_LIVE_REGION and AWS credentials",
)
def test_live_amazon_polly(settings, tmp_path):  # pragma: no cover - opt-in, calls AWS
    settings.LAI_SPEECH_PROVIDER = "polly"
    settings.LAI_SPEECH_AWS_REGION = os.environ.get("LAI_SPEECH_LIVE_REGION", "us-east-1")
    bucket = os.environ.get("LAI_SPEECH_LIVE_BUCKET", "")
    if bucket:
        from apps.speech.storage import reset_speech_storage_cache

        settings.LAI_SPEECH_STORAGE = "s3"
        settings.LAI_SPEECH_BUCKET = bucket
        settings.LAI_SPEECH_S3_REGION = os.environ.get(
            "LAI_SPEECH_LIVE_S3_REGION", settings.LAI_SPEECH_AWS_REGION
        )
        settings.LAI_SPEECH_DELIVERY = "s3"
        reset_speech_storage_cache()
    out = StringIO()
    try:
        call_command(
            "speech_live_smoke",
            "--confirm-live-aws",
            "--save-mp3",
            os.environ.get("LAI_SPEECH_LIVE_SAVE_MP3") or str(tmp_path / "pirate-pip-sample.mp3"),
            stdout=out,
        )
    finally:
        print(out.getvalue())  # noqa: T201 - the step report is the evidence, PASS or FAIL
    assert "LIVE SMOKE TEST PASSED." in out.getvalue()
