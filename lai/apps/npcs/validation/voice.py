"""Release validation: voice. Owner: Workstream E (LAI-NPC-026/028): voice profile validity and
speech pre-generation readiness.

Called by `apps.npcs.validation.release_problems` with the built snapshot; returns problems in
words staff can act on, never raises. Must not query child data.

A voiced character (snapshot `voiceProfile` set) reuses `speech.VoiceProfile` (ADR-049); there is
no NPC-specific voice model. Its profile must exist, be enabled and name an allowed Polly voice,
language and engine (`speech.voices.voice_problem`), and every authored line it would speak must
pass the same output rules speech re-checks at request time (`speech.services.text_problem`), so
a published line is never refused when a child hears it. Characters without a profile are
captions only and are not checked here. Problems name keys, never quote dialogue text.
"""

from __future__ import annotations

from apps.speech import voices
from apps.speech.models import VoiceProfile
from apps.speech.services import text_problem


def _profile_problems(npc_id: str, profile_id: str, profile: VoiceProfile | None) -> list[str]:
    if profile is None:
        return [f"{npc_id} voice profile {profile_id} does not exist"]
    found: list[str] = []
    if not profile.enabled:
        # Same words as the snapshot builder's own check, so the report lists it once.
        found.append(f"{npc_id} voice profile {profile_id} is disabled")
    problem = voices.voice_problem(profile.polly_voice_id, profile.language_code, profile.engine)
    if problem:
        found.append(f"{npc_id} voice profile {profile_id}: {problem}")
    if not voices.MIN_RATE <= profile.speaking_rate_percent <= voices.MAX_RATE:
        found.append(
            f"{npc_id} voice profile {profile_id}: speaking rate must be between "
            f"{voices.MIN_RATE} and {voices.MAX_RATE} percent"
        )
    return found


def _line_problems(npc_id: str, character: dict) -> list[str]:
    found: list[str] = []
    for dialogue in character.get("dialogues") or []:
        for node in dialogue.get("nodes") or []:
            text = node.get("text") or ""
            if not text.strip() or node.get("audio"):
                continue  # nothing to say, or a recorded line plays instead
            problem = text_problem(text)
            if problem:
                found.append(
                    f"{npc_id} dialogue {dialogue.get('dialogueKey')} node {node.get('nodeKey')} "
                    f"cannot be spoken: {problem}"
                )
    return found


def problems(snapshot: dict) -> list[str]:
    characters = snapshot.get("characters") or {}
    voiced = {
        npc_id: character["voiceProfile"]
        for npc_id, character in characters.items()
        if isinstance(character, dict) and character.get("voiceProfile")
    }
    if not voiced:
        return []
    profiles = {
        profile.profile_id: profile
        for profile in VoiceProfile.objects.filter(profile_id__in=set(voiced.values()))
    }
    found: list[str] = []
    for npc_id, profile_id in sorted(voiced.items()):
        found.extend(_profile_problems(npc_id, profile_id, profiles.get(profile_id)))
        found.extend(_line_problems(npc_id, characters[npc_id]))
    return found
