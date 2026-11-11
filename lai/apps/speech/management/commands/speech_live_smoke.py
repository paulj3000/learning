"""Opt-in LIVE Amazon Polly smoke test (SM-P8-LIVE). Calls real AWS; never runs by default.

    LAI_SPEECH_PROVIDER=polly LAI_SPEECH_AWS_REGION=us-east-1 \\
        python manage.py speech_live_smoke --confirm-live-aws [--profile pirate-pip] \\
        [--save-mp3 /tmp/pip.mp3] [--keep]

What it checks, each reported PASS / FAIL / WARN:

1. region: `DescribeVoices` in the configured region, compared with the hand-maintained table in
   `apps.speech.voices` (a missing voice or engine is WARN, the chosen profile's is FAIL);
2. synthesis: one short, fixed, non-sensitive sample in the chosen voice profile, checked to be
   MP3 of a plausible size (`--save-mp3` writes it for audible QA);
3. cache: the same line through `prepare_shared_clip` twice makes exactly one Polly call, the
   stored object reads back byte for byte, and (S3 delivery) a presigned URL answers `audio/mpeg`;
4. fallback: a deliberately invalid voice id is refused by AWS and mapped to a safe, generic
   error; and a voice outside the allowed table is refused before any AWS call.

Cost: one sample of about 40 characters (a fraction of a US cent on any engine), plus one
refused request that synthesizes nothing. The cache row and object are removed afterwards unless
`--keep`. Output names voices, engines, codes, sizes and timings only; never an AWS message.
Exit status is non-zero when any step FAILs. A PASS here is the only evidence that may mark the
live gate's Polly items verified.
"""

from __future__ import annotations

import time
import urllib.request
from dataclasses import dataclass

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.speech import services, voices
from apps.speech.management.commands.seed_speech_voices import STARTERS
from apps.speech.models import ClipScope, SpeechClip, VoiceProfile
from apps.speech.polly import Boto3PollyClient, SpeechError, looks_like_mp3
from apps.speech.storage import SpeechStorageError, get_speech_storage, storage_key

SAMPLE = "Ahoy! Welcome to Treasure Cove. Let us count the shells together."
MIN_AUDIO_BYTES = 1000


@dataclass
class Step:
    name: str
    outcome: str  # PASS, FAIL, WARN
    detail: str


class CountingClient:
    """Wraps the real client and counts synthesis calls (the cache check)."""

    def __init__(self, inner: Boto3PollyClient):
        self.inner = inner
        self.calls = 0

    def synthesize(self, **kwargs) -> bytes:
        self.calls += 1
        return self.inner.synthesize(**kwargs)


def _profile_for(profile_id: str) -> VoiceProfile:
    found = VoiceProfile.objects.filter(profile_id=profile_id).first()
    if found is not None:
        return found
    for starter_id, name, voice, engine, rate, character in STARTERS:
        if starter_id == profile_id:
            # Not saved: the smoke test never creates configuration.
            return VoiceProfile(
                profile_id=starter_id,
                display_name=name,
                polly_voice_id=voice,
                language_code="en-US",
                engine=engine,
                speaking_rate_percent=rate,
                character_id=character,
            )
    raise CommandError(f"No voice profile or starter named {profile_id}.")


class Command(BaseCommand):
    help = "LIVE Amazon Polly smoke test. Calls AWS; needs --confirm-live-aws."

    def add_arguments(self, parser):
        parser.add_argument(
            "--confirm-live-aws",
            action="store_true",
            help="Required: acknowledge that this calls Amazon Polly (and S3) and is billable.",
        )
        parser.add_argument("--profile", default="pirate-pip", help="Voice profile to test.")
        parser.add_argument("--save-mp3", default="", help="Write the sample here for listening.")
        parser.add_argument("--keep", action="store_true", help="Keep the cached sample clip.")
        parser.add_argument(
            "--skip-url-fetch",
            action="store_true",
            help="Do not fetch the presigned URL (S3 delivery only).",
        )

    def handle(self, *args, **options):
        if not options["confirm_live_aws"]:
            raise CommandError("Refusing to call AWS without --confirm-live-aws. Nothing was run.")
        if settings.LAI_SPEECH_PROVIDER != "polly":
            raise CommandError("Set LAI_SPEECH_PROVIDER=polly to run the live smoke test.")
        if not settings.LAI_SPEECH_AWS_REGION:
            raise CommandError("Set LAI_SPEECH_AWS_REGION.")
        client = self.make_client()
        profile = _profile_for(options["profile"])
        steps: list[Step] = []
        self.stdout.write(
            f"Live Polly smoke test: region={settings.LAI_SPEECH_AWS_REGION} "
            f"profile={profile.profile_id} voice={profile.polly_voice_id} "
            f"engine={profile.engine} language={profile.language_code} "
            f"storage={settings.LAI_SPEECH_STORAGE} delivery={settings.LAI_SPEECH_DELIVERY}"
        )
        steps.extend(self.check_region(client, profile))
        audio = self.check_synthesis(client, profile, steps, options["save_mp3"])
        if audio is not None:
            steps.extend(self.check_cache(client, profile, options))
        steps.extend(self.check_fallback(client, profile))

        for step in steps:
            self.stdout.write(f"  {step.outcome:<4} {step.name}: {step.detail}")
        failed = [step for step in steps if step.outcome == "FAIL"]
        if failed:
            raise CommandError(f"LIVE SMOKE TEST FAILED ({len(failed)} step(s)).")
        self.stdout.write("LIVE SMOKE TEST PASSED.")

    # Test seam: the real client unless a test installs another.
    def make_client(self) -> Boto3PollyClient:
        return Boto3PollyClient()

    # --- steps -------------------------------------------------------------------------------

    def check_region(self, client, profile) -> list[Step]:
        steps: list[Step] = []
        try:
            offered: dict[str, tuple[str, ...]] = {}
            for language in voices.LANGUAGES:
                offered.update(
                    {f"{language}:{k}": v for k, v in client.voice_report(language).items()}
                )
        except Exception as error:  # noqa: BLE001
            code = getattr(error, "response", {}).get("Error", {}).get("Code", "")
            return [
                Step("region", "FAIL", f"DescribeVoices failed ({code or type(error).__name__})")
            ]
        gaps = []
        for voice_id, languages in voices.SUPPORTED_VOICES.items():
            for language, engines in languages.items():
                available = offered.get(f"{language}:{voice_id}")
                if available is None:
                    gaps.append(f"{voice_id} ({language}) not offered")
                    continue
                missing = [engine for engine in engines if engine not in available]
                if missing:
                    gaps.append(f"{voice_id} ({language}) lacks {','.join(missing)}")
        chosen = offered.get(f"{profile.language_code}:{profile.polly_voice_id}")
        if chosen is None or profile.engine not in chosen:
            steps.append(
                Step(
                    "region",
                    "FAIL",
                    f"{profile.polly_voice_id} {profile.engine} is not offered in "
                    f"{settings.LAI_SPEECH_AWS_REGION}",
                )
            )
        else:
            steps.append(
                Step("region", "PASS", f"{profile.polly_voice_id} supports {', '.join(chosen)}")
            )
        steps.append(
            Step(
                "voice table",
                "WARN" if gaps else "PASS",
                "; ".join(gaps) if gaps else "every allowed voice and engine is offered",
            )
        )
        return steps

    def check_synthesis(self, client, profile, steps, save_path) -> bytes | None:
        text, text_type = voices.build_request_text(
            SAMPLE, profile.engine, profile.speaking_rate_percent
        )
        started = time.monotonic()
        try:
            audio = client.synthesize(
                text=text,
                text_type=text_type,
                voice_id=profile.polly_voice_id,
                engine=profile.engine,
                language=profile.language_code,
            )
        except SpeechError as error:
            steps.append(Step("synthesis", "FAIL", f"{error.code} ({error.reason})"))
            return None
        ms = int((time.monotonic() - started) * 1000)
        if not looks_like_mp3(audio) or len(audio) < MIN_AUDIO_BYTES:
            steps.append(Step("synthesis", "FAIL", f"not playable MP3 ({len(audio)} bytes)"))
            return None
        steps.append(
            Step("synthesis", "PASS", f"{len(audio)} bytes MP3, {len(SAMPLE)} chars, {ms} ms")
        )
        if save_path:
            with open(save_path, "wb") as handle:
                handle.write(audio)
            steps.append(Step("saved", "PASS", f"sample written to {save_path} for listening"))
        return audio

    def check_cache(self, client, profile, options) -> list[Step]:
        resolved = services.Resolved(SAMPLE, profile, ClipScope.AUTHORED, "smoke:sample")
        key = services.cache_key(resolved, None)
        path = storage_key(key, ClipScope.AUTHORED)
        self._remove(key, path)  # a clean start, so the first call always synthesizes
        counting = CountingClient(client)
        steps: list[Step] = []
        try:
            first = services.prepare_shared_clip(resolved, client=counting)
            second = services.prepare_shared_clip(resolved, client=counting)
        except SpeechError as error:
            return [Step("cache", "FAIL", f"{error.code} ({error.reason})")]
        if first and not second and counting.calls == 1:
            steps.append(Step("cache", "PASS", "second request served from cache, 1 Polly call"))
        else:
            steps.append(Step("cache", "FAIL", f"{counting.calls} Polly calls for one line"))
        try:
            stored = get_speech_storage().read(path)
        except SpeechStorageError:
            steps.append(Step("storage", "FAIL", "stored clip could not be read back"))
            stored = b""
        if stored:
            ok = looks_like_mp3(stored)
            steps.append(
                Step(
                    "storage",
                    "PASS" if ok else "FAIL",
                    f"{settings.LAI_SPEECH_STORAGE} read back {len(stored)} bytes",
                )
            )
        if settings.LAI_SPEECH_DELIVERY == "s3" and stored:
            steps.append(self._check_presigned(path, options["skip_url_fetch"]))
        if not options["keep"]:
            self._remove(key, path)
        return steps

    def _check_presigned(self, path, skip_fetch) -> Step:
        try:
            url = get_speech_storage().presigned_url(
                path, expires_in=settings.LAI_SPEECH_URL_TTL_SECONDS
            )
        except SpeechStorageError:
            return Step("presigned url", "FAIL", "could not sign")
        if not url or not url.startswith("https://"):
            return Step("presigned url", "FAIL", "no https url")
        if skip_fetch:
            return Step("presigned url", "PASS", "signed (not fetched)")
        try:
            with urllib.request.urlopen(url, timeout=10) as response:  # noqa: S310 - https only
                kind = response.headers.get("Content-Type", "")
                body = response.read(16)
        except Exception as error:  # noqa: BLE001
            return Step("presigned url", "FAIL", f"fetch failed ({type(error).__name__})")
        ok = kind.startswith("audio/mpeg") and looks_like_mp3(body)
        return Step("presigned url", "PASS" if ok else "FAIL", f"answered {kind or 'no type'}")

    def _remove(self, key: str, path: str) -> None:
        SpeechClip.objects.filter(cache_key=key).delete()
        try:
            get_speech_storage().delete(path)
        except SpeechStorageError:
            pass

    def check_fallback(self, client, profile) -> list[Step]:
        steps: list[Step] = []
        try:
            client.synthesize(
                text="Hello.",
                text_type="text",
                voice_id="NotARealVoice",
                engine=profile.engine,
                language=profile.language_code,
            )
            steps.append(Step("fallback (aws)", "FAIL", "an invalid voice was accepted"))
        except SpeechError as error:
            safe = error.message in {
                "This voice is not available.",
                "Speech could not be made right now.",
            }
            # Only a refusal BECAUSE of the voice proves the mapping; a credential or network
            # refusal here proves nothing about it.
            verified = (
                safe and error.code == "speech_unavailable" and error.reason == "invalid_voice"
            )
            steps.append(
                Step(
                    "fallback (aws)",
                    "PASS" if verified else "FAIL",
                    f"invalid voice refused as {error.code} ({error.reason}); captions remain"
                    if verified
                    else f"not verified: AWS answered {error.code} ({error.reason})",
                )
            )
        outside = VoiceProfile(
            profile_id="smoke-outside",
            polly_voice_id="NotARealVoice",
            language_code=profile.language_code,
            engine=profile.engine,
            speaking_rate_percent=100,
        )
        counting = CountingClient(client)
        try:
            services._synthesize(  # noqa: SLF001 - the exact pre-AWS gate a child request uses
                services.Resolved("Hello.", outside, ClipScope.AUTHORED, "smoke:outside"), counting
            )
            steps.append(Step("fallback (table)", "FAIL", "a voice outside the table was used"))
        except SpeechError as error:
            ok = counting.calls == 0 and error.reason == "invalid_voice"
            steps.append(
                Step(
                    "fallback (table)",
                    "PASS" if ok else "FAIL",
                    "voice outside the table refused before any AWS call",
                )
            )
        return steps
