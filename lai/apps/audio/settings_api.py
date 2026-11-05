"""The child's audio settings API (SM-P5).

`GET|PATCH /api/v1/children/<child_id>/audio/settings/`

Child-scoped by the parent's token like every child route (`ChildScopedAPIView`): another
family's child is the same 404 as a child that does not exist. Writes are strict: only known
fields, volumes from 0 to 1, booleans for mutes; anything else is a 400 and nothing is saved.
A GET before any save returns the calm defaults without creating a row.
"""

from rest_framework import serializers
from rest_framework.response import Response

from apps.users.scoping import ChildScopedAPIView

from .models import ChildAudioSettings

CHANNELS = ("music", "ambient", "sfx", "voice", "ui")


class _ChannelWrite(serializers.Serializer):
    volume = serializers.FloatField(min_value=0.0, max_value=1.0, required=False)
    muted = serializers.BooleanField(required=False)

    def to_internal_value(self, data):
        if isinstance(data, dict) and set(data) - set(self.fields):
            raise serializers.ValidationError({"detail": "Unknown setting."})
        return super().to_internal_value(data)


class AudioSettingsWrite(serializers.Serializer):
    masterVolume = serializers.FloatField(min_value=0.0, max_value=1.0, required=False)
    masterMuted = serializers.BooleanField(required=False)
    reducedIntensity = serializers.BooleanField(required=False)
    channels = serializers.DictField(child=_ChannelWrite(), required=False)

    def validate_channels(self, value):
        unknown = set(value) - set(CHANNELS)
        if unknown:
            raise serializers.ValidationError("Unknown audio channel.")
        return value

    def to_internal_value(self, data):
        if isinstance(data, dict):
            extra = set(data) - set(self.fields)
            if extra:
                raise serializers.ValidationError({"detail": "Unknown setting."})
        return super().to_internal_value(data)


def defaults() -> ChildAudioSettings:
    """An unsaved row holding the model defaults."""
    return ChildAudioSettings()


def to_payload(row: ChildAudioSettings) -> dict:
    return {
        "masterVolume": row.master_volume,
        "masterMuted": row.master_muted,
        "reducedIntensity": row.reduced_intensity,
        "channels": {
            name: {"volume": getattr(row, f"{name}_volume"), "muted": getattr(row, f"{name}_muted")}
            for name in CHANNELS
        },
    }


class ChildAudioSettingsView(ChildScopedAPIView):
    def get(self, request, child_id):
        row = self.scoped(ChildAudioSettings.objects.all()).first() or defaults()
        return Response(to_payload(row))

    def patch(self, request, child_id):
        write = AudioSettingsWrite(data=request.data)
        write.is_valid(raise_exception=True)
        data = write.validated_data
        row = self.scoped(ChildAudioSettings.objects.all()).first() or ChildAudioSettings(
            child=self.child
        )
        if "masterVolume" in data:
            row.master_volume = data["masterVolume"]
        if "masterMuted" in data:
            row.master_muted = data["masterMuted"]
        if "reducedIntensity" in data:
            row.reduced_intensity = data["reducedIntensity"]
        for name, change in data.get("channels", {}).items():
            if "volume" in change:
                setattr(row, f"{name}_volume", change["volume"])
            if "muted" in change:
                setattr(row, f"{name}_muted", change["muted"])
        row.save()
        return Response(to_payload(row))
