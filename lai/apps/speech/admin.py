"""Voice profiles and authored lines in Django Admin (SM-P8-03). Staff only; no React screen.

Voice profiles are the only place a Polly voice is chosen, and only combinations in `voices.py`
can be saved. Generated clips and daily totals are read-only here: they are an operational view
(counts, sizes, a labelled cost estimate), not content, and never show text.
"""

from django import forms
from django.contrib import admin

from . import voices
from .models import SpeechClip, SpeechDailyTotal, SpeechLine, VoiceProfile


class VoiceProfileForm(forms.ModelForm):
    polly_voice_id = forms.ChoiceField(
        label="Polly voice", choices=[(v, v) for v in sorted(voices.SUPPORTED_VOICES)]
    )
    language_code = forms.ChoiceField(choices=[(c, c) for c in voices.LANGUAGES])
    engine = forms.ChoiceField(choices=[(e, e) for e in voices.ENGINES])

    class Meta:
        model = VoiceProfile
        fields = "__all__"


@admin.register(VoiceProfile)
class VoiceProfileAdmin(admin.ModelAdmin):
    form = VoiceProfileForm
    list_display = (
        "profile_id",
        "display_name",
        "polly_voice_id",
        "language_code",
        "engine",
        "enabled",
    )
    list_filter = ("enabled", "engine", "language_code")
    search_fields = ("profile_id", "display_name", "character_id")
    readonly_fields = ("created_at", "updated_at")

    def get_readonly_fields(self, request, obj=None):
        fixed = list(super().get_readonly_fields(request, obj))
        return [*fixed, "profile_id"] if obj is not None else fixed

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(SpeechLine)
class SpeechLineAdmin(admin.ModelAdmin):
    list_display = ("line_id", "voice_profile", "context", "enabled")
    list_filter = ("enabled", "context", "voice_profile")
    search_fields = ("line_id", "text", "context")
    readonly_fields = ("created_at", "updated_at")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)


class ReadOnlyAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(SpeechClip)
class SpeechClipAdmin(ReadOnlyAdmin):
    list_display = (
        "id",
        "scope",
        "voice_profile_id",
        "engine",
        "characters",
        "byte_size",
        "hits",
        "expires_at",
    )
    list_filter = ("scope", "engine")
    # No cache key, storage key or owner is shown: nothing that identifies a child or an object.
    fields = (
        "scope",
        "voice_profile_id",
        "voice",
        "engine",
        "language",
        "characters",
        "byte_size",
        "hits",
        "created_at",
        "last_used_at",
        "expires_at",
    )
    readonly_fields = fields


@admin.register(SpeechDailyTotal)
class SpeechDailyTotalAdmin(ReadOnlyAdmin):
    list_display = (
        "day",
        "requests",
        "cache_hits",
        "cache_misses",
        "characters_synthesized",
        "failures",
        "estimated_cost",
    )

    @admin.display(description="Estimated cost (USD, an estimate, not a bill)")
    def estimated_cost(self, obj):
        if obj.estimated_cost_microusd is None:
            return "no price configured"
        return f"{obj.estimated_cost_microusd / 1_000_000:.4f}"
