"""The speech API (SM-P8-04).

`GET  /api/v1/children/<child_id>/audio/speech/`   -> `{"enabled": bool}`
`POST /api/v1/children/<child_id>/audio/speech/`   -> synthesize something the server approved
`GET  /api/v1/speech-files/<token>/speech.mp3`     -> the audio, for a short-lived signed token

The POST body names a reference (`{"reference": {"kind": "utterance", "id": ...}}`), never text.
Kinds: `utterance`, `line`, `npcNode`, and `npcDialogueNode` (`npcId`, `release`, `dialogueKey`,
`nodeKey`; an NPC Manager node of the ACTIVE release, LAI-NPC-028).
Child-scoped like every child route: the parent's Cognito token resolves the child, and another
family's child is the same 404 as a child that does not exist. There is no public text-to-speech.
"""

from django.http import HttpResponse
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.request_context import get_request_id
from apps.users.scoping import ChildScopedAPIView

from . import services
from .polly import SpeechError
from .storage import SpeechStorageError

MAX_BODY_BYTES = 1024


class ReferenceSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=["utterance", "line", "npcNode", "npcDialogueNode"])
    id = serializers.CharField(max_length=80, required=False)
    npcId = serializers.SlugField(max_length=64, required=False)
    nodeId = serializers.CharField(max_length=64, required=False)
    # npcDialogueNode (LAI-NPC-028): an authored node of the named ACTIVE NPC release.
    release = serializers.IntegerField(min_value=1, max_value=2_000_000_000, required=False)
    dialogueKey = serializers.SlugField(max_length=80, required=False)
    nodeKey = serializers.SlugField(max_length=80, required=False)

    NEEDED = {
        "utterance": ("id",),
        "line": ("id",),
        "npcNode": ("npcId", "nodeId"),
        "npcDialogueNode": ("npcId", "release", "dialogueKey", "nodeKey"),
    }

    def to_internal_value(self, data):
        if isinstance(data, dict) and set(data) - set(self.fields):
            raise serializers.ValidationError({"detail": "Unknown field."})
        return super().to_internal_value(data)

    def validate(self, attrs):
        kind = attrs["kind"]
        needed = self.NEEDED[kind]
        missing = [name for name in needed if attrs.get(name) in (None, "")]
        if missing:
            raise serializers.ValidationError({name: "This field is required." for name in missing})
        extra = [name for name in attrs if name != "kind" and name not in needed]
        if extra:
            raise serializers.ValidationError({name: "Not used by this kind." for name in extra})
        return attrs


class SpeechRequestSerializer(serializers.Serializer):
    reference = ReferenceSerializer()

    def to_internal_value(self, data):
        if isinstance(data, dict) and set(data) - set(self.fields):
            raise serializers.ValidationError({"detail": "Unknown field."})
        return super().to_internal_value(data)


def error_response(error: SpeechError) -> Response:
    return Response(
        {"error": {"code": error.code, "message": error.message}, "request_id": get_request_id()},
        status=error.status,
    )


class SpeechView(ChildScopedAPIView):
    def get(self, request, child_id):
        return Response({"enabled": services.speech_enabled()})

    def post(self, request, child_id):
        if len(request.body) > MAX_BODY_BYTES:
            return error_response(
                SpeechError("invalid_reference", "That request is too large.", status=400)
            )
        body = SpeechRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        reference = {k: v for k, v in body.validated_data["reference"].items()}
        try:
            result = services.speak(self.child, reference)
        except SpeechError as error:
            return error_response(error)
        return Response(
            {
                "speech": {
                    "url": result.url,
                    "expiresInSeconds": result.expires_in,
                    "text": result.text,
                    "voiceProfile": result.voice_profile,
                    "language": result.language,
                    "characters": result.characters,
                    "cached": result.cached,
                }
            }
        )


class SpeechFileView(APIView):
    """Streams a clip for a signed, expiring token (an `<audio>` element cannot send a bearer).

    The token names one clip and lapses with `LAI_SPEECH_URL_TTL_SECONDS`; it is issued only by
    the authorized POST above. Nothing is cached by browsers or proxies.
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def get(self, request, token):
        clip = services.clip_for_token(token)
        if clip is None:
            return HttpResponse(status=404)
        try:
            data = services.read_clip(clip)
        except SpeechStorageError:
            return HttpResponse(status=404)
        response = HttpResponse(data, content_type="audio/mpeg")
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "sandbox"
        return response
