"""Create the starter voice profiles (SM-P8-03). Idempotent; never changes an existing profile.

    python manage.py seed_speech_voices

Creates `keeper-quill`, `chatty`, `pirate-pip`, `narrator` and `tutor` if they do not exist,
using allowed voices only. Pirate Pip (SM-P8-LIVE) uses Justin, a young en-US voice with both the
standard and neural engines, at a slightly brisk rate; the profile id matches the NPC id so
`seed_npc_pip` and the `npcNode` speech reference find it. Existing profiles are left exactly as
staff configured them. It does not turn speech on: `LAI_SPEECH_PROVIDER` does that, per
environment.
"""

from django.core.management.base import BaseCommand

from apps.speech.models import VoiceProfile

STARTERS = (
    ("keeper-quill", "Keeper Quill", "Matthew", "neural", 95, "keeper-quill"),
    ("chatty", "Chatty the Parrot", "Ivy", "neural", 105, "chatty"),
    ("pirate-pip", "Pirate Pip", "Justin", "neural", 105, "pirate-pip"),
    ("narrator", "Narrator", "Joanna", "neural", 95, ""),
    ("tutor", "Tutor", "Kevin", "neural", 100, ""),
)


class Command(BaseCommand):
    help = "Create missing starter voice profiles. Never changes an existing one."

    def handle(self, *args, **options):
        created = []
        for profile_id, name, voice, engine, rate, character in STARTERS:
            profile = VoiceProfile(
                profile_id=profile_id,
                display_name=name,
                polly_voice_id=voice,
                language_code="en-US",
                engine=engine,
                speaking_rate_percent=rate,
                character_id=character,
            )
            profile.full_clean(validate_unique=False)
            _, was_created = VoiceProfile.objects.get_or_create(
                profile_id=profile_id,
                defaults={
                    "display_name": name,
                    "polly_voice_id": voice,
                    "language_code": "en-US",
                    "engine": engine,
                    "speaking_rate_percent": rate,
                    "character_id": character,
                },
            )
            if was_created:
                created.append(profile_id)
        self.stdout.write(f"Created: {', '.join(created) or 'none'}. Existing profiles untouched.")
