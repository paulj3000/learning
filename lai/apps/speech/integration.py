"""Bedrock to Polly, safely (SM-P8-08).

The AI views call `approve_turn` after the existing pipeline has validated a companion or tutor
turn (schema, length, URL and personal-information checks, boundary rules and the Bedrock
guardrail all happened before this). It makes a short-lived `ApprovedUtterance` for that child
and returns a reference the child's app can hand to the speech API. It never calls Polly itself,
never sees model output that was not validated, and never fails the turn: any problem returns
`None` and the child simply reads the text.
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.utils.timezone import now

from .models import ApprovedUtterance, UtteranceSource, VoiceProfile
from .services import speech_enabled, text_problem

logger = logging.getLogger("lai.speech")

#: Which voice profile speaks which route. A missing or disabled profile means no speech.
ROUTE_PROFILE = {"companion": "chatty", "tutor": "tutor"}
ROUTE_SOURCE = {"companion": UtteranceSource.COMPANION, "tutor": UtteranceSource.TUTOR}


def approve_turn(child, route: str, turn: dict, npc_id: str | None = None) -> dict | None:
    """`{"utteranceId", "voiceProfile"}` for a validated turn, or None if it is not spoken."""
    try:
        if not speech_enabled() or not child.ai_enabled:
            return None
        text = turn.get("spokenText")
        # A STOP disposition is not a line to perform; nor is anything the rules refuse again.
        if not isinstance(text, str) or turn.get("safetyDisposition") == "STOP":
            return None
        if text_problem(text):
            return None
        # A turn about a character (Keeper Quill's line) is spoken in that character's voice when
        # one is configured; otherwise in the route's voice (Chatty, the tutor).
        profile = (
            VoiceProfile.objects.filter(character_id=npc_id, enabled=True).first()
            if npc_id
            else None
        ) or VoiceProfile.objects.filter(
            profile_id=ROUTE_PROFILE.get(route, ""), enabled=True
        ).first()
        if profile is None:
            return None
        utterance = ApprovedUtterance(
            child=child,
            text=text.strip(),
            voice_profile=profile,
            source=ROUTE_SOURCE[route],
            expires_at=now() + timedelta(minutes=settings.LAI_SPEECH_UTTERANCE_TTL_MINUTES),
        )
        utterance.save()
        return {"utteranceId": str(utterance.pk), "voiceProfile": profile.profile_id}
    except Exception:  # noqa: BLE001 - speech must never break a turn
        logger.exception("could not approve a turn for speech")
        return None
