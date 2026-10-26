"""Child profile request and response shapes (LAI-ANDROID-API-001). Contract:
docs/android/ANDROID_API_CONTRACT.md.

camelCase keys, as the play API uses. Request bodies are closed: an unknown field (an `id`,
`parent`, `avatarPhotoKey`, timestamps) is a validation error, never silently applied. The
allowed avatar and interest values mirror react/src/features/child-profile/constants.ts.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import MAX_INTERESTS, NICKNAME_MAX_LENGTH, AgeBand, ReadingMode

AVATAR_KEYS = ("FOX", "OWL", "OTTER", "DRAGON", "ROBOT", "MERMAID")
INTEREST_OPTIONS = (
    "Animals",
    "Space",
    "Dinosaurs",
    "Ocean",
    "Vehicles",
    "Art",
    "Music",
    "Cooking",
    "Sports",
    "Nature",
    "Robots",
    "Fantasy",
)

# Request field -> model field. Only these can be written by a parent.
WRITABLE_FIELDS = {
    "nickname": "nickname",
    "ageBand": "age_band",
    "avatarKey": "avatar_key",
    "interests": "interests",
    "readingMode": "reading_mode",
    "sessionMinutes": "session_minutes",
    "active": "active",
    "aiEnabled": "ai_enabled",
}


class ChildProfileWrite(serializers.Serializer):
    """POST (every required field) and PATCH (`partial=True`) bodies."""

    nickname = serializers.CharField(max_length=NICKNAME_MAX_LENGTH, trim_whitespace=True)
    ageBand = serializers.ChoiceField(choices=AgeBand.values)
    avatarKey = serializers.ChoiceField(choices=AVATAR_KEYS)
    interests = serializers.ListField(
        child=serializers.ChoiceField(choices=INTEREST_OPTIONS),
        max_length=MAX_INTERESTS,
        required=False,
    )
    readingMode = serializers.ChoiceField(choices=ReadingMode.values)
    sessionMinutes = serializers.IntegerField(min_value=1, max_value=60)
    active = serializers.BooleanField(required=False)
    aiEnabled = serializers.BooleanField(required=False)

    def validate_interests(self, value):
        if len(set(value)) != len(value):
            raise serializers.ValidationError("Choose each interest once.", code="duplicate")
        return value

    def validate(self, attrs):
        unknown = set(self.initial_data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError(
                {name: ["This field is not accepted."] for name in sorted(unknown)},
                code="unknown_field",
            )
        if self.partial and not attrs:
            raise serializers.ValidationError("Change at least one field.", code="empty")
        return attrs

    def model_fields(self) -> dict:
        return {WRITABLE_FIELDS[key]: value for key, value in self.validated_data.items()}


def model_errors(error: DjangoValidationError) -> serializers.ValidationError:
    """A model `full_clean` failure, keyed by the request's field names."""
    by_model = {model: key for key, model in WRITABLE_FIELDS.items()}
    details = {}
    errors = getattr(error, "error_dict", None) or {"__all__": error.error_list}
    for field, messages in errors.items():
        key = by_model.get(field, "non_field_errors")
        details[key] = [
            serializers.ErrorDetail(message.messages[0], code=message.code or "invalid")
            for message in messages
        ]
    return serializers.ValidationError(details)


class ChildProfileSerializer(serializers.Serializer):
    """What a parent sees of their own child. The photo's storage path is never exposed."""

    id = serializers.UUIDField()
    nickname = serializers.CharField()
    ageBand = serializers.CharField(source="age_band")
    avatarKey = serializers.CharField(source="avatar_key")
    hasPhoto = serializers.SerializerMethodField()
    interests = serializers.ListField(child=serializers.CharField())
    readingMode = serializers.CharField(source="reading_mode")
    sessionMinutes = serializers.IntegerField(source="session_minutes")
    active = serializers.BooleanField()
    aiEnabled = serializers.BooleanField(source="ai_enabled")
    createdAt = serializers.DateTimeField(source="created_at")
    updatedAt = serializers.DateTimeField(source="updated_at")

    def get_hasPhoto(self, child) -> bool:
        return bool(child.avatar_photo_key)
