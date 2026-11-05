import json

from apps.speech.models import SpeechLine, VoiceProfile


def profile(profile_id="narrator", voice="Joanna", engine="neural", rate=100, **fields):
    return VoiceProfile.objects.create(
        profile_id=profile_id,
        display_name=profile_id.title(),
        polly_voice_id=voice,
        language_code="en-US",
        engine=engine,
        speaking_rate_percent=rate,
        **fields,
    )


def line(line_id="quill-hello", text="Welcome to the castle library.", voice=None, **fields):
    return SpeechLine.objects.create(
        line_id=line_id, text=text, voice_profile=voice or profile(), **fields
    )


def url(child):
    return f"/api/v1/children/{child.pk}/audio/speech/"


def post(client, child, reference, **extra):
    return client.post(
        url(child), json.dumps({"reference": reference, **extra}), content_type="application/json"
    )
