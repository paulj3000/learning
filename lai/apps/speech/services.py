"""Speech synthesis, authorization, caching and limits (SM-P8-04, SM-P8-05, SM-P8-08).

The one entry point is `speak(child, reference)`. A `reference` names something the SERVER
already approved; it never carries text:

- `{"kind": "utterance", "id": <uuid>}`: an `ApprovedUtterance` for this child, made from a
  validated AI turn (see `integration.py`) and unexpired;
- `{"kind": "line", "id": "<line id>"}`: an enabled `SpeechLine` written by staff;
- `{"kind": "npcNode", "npcId": ..., "nodeId": ...}`: an authored NPC narration node already in
  the catalog;
- `{"kind": "npcDialogueNode", "npcId", "release", "dialogueKey", "nodeKey"}`: an authored NPC
  Manager dialogue node, read only from the named ACTIVE `NpcRelease` snapshot and voiced by the
  character's published voice profile (ADR-054, LAI-NPC-028). Never draft rows.

Flow: resolve the reference to (text, voice profile) -> re-check the text with the AI output
rules -> limits (kill switch, per-child and global daily caps, process concurrency) -> cache
lookup by a key over text, voice, engine, language, rate and cache version (plus the child for a
child-scoped clip) -> on a miss, synthesize once under a database lock so identical concurrent
requests share one Polly call -> store -> short-lived authorized URL.

Nothing here is added to the Sound Library: generated speech is cache and expires. Counts and
sizes are recorded; text never is.
"""

import hashlib
import logging
import threading
import uuid
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.db import DatabaseError, connection, transaction
from django.db.models import F
from django.utils.timezone import now

from apps.ai.content_safety import boundary_violations, contains_url, requests_personal_information

from . import voices
from .models import (
    ApprovedUtterance,
    ClipScope,
    SpeechClip,
    SpeechDailyTotal,
    SpeechLine,
    SpeechUsage,
    VoiceProfile,
)
from .polly import PollyClient, SpeechError, get_polly_client
from .storage import SpeechStorageError, get_speech_storage, storage_key

logger = logging.getLogger("lai.speech")

DELIVERY_SALT = "lai.speech.delivery"
_concurrency: threading.BoundedSemaphore | None = None
_concurrency_size = 0


@dataclass(frozen=True)
class Resolved:
    text: str
    profile: VoiceProfile
    scope: str  # ClipScope value
    reference: str  # a log-safe label, never text


@dataclass(frozen=True)
class SpeechResult:
    url: str
    expires_in: int
    text: str
    voice_profile: str
    language: str
    characters: int
    cached: bool


def speech_enabled() -> bool:
    return settings.LAI_SPEECH_PROVIDER != "disabled"


def text_problem(text: str) -> str | None:
    """Why this text may not be spoken, or None. The same rules the AI output passes."""
    body = (text or "").strip()
    if not body:
        return "The text is empty."
    if len(body) > settings.LAI_SPEECH_MAX_CHARS:
        return f"The text is longer than {settings.LAI_SPEECH_MAX_CHARS} characters."
    if contains_url(body):
        return "The text contains a web address."
    if requests_personal_information(body):
        return "The text asks for personal information."
    if boundary_violations(body):
        return "The text breaks a companion boundary."
    return None


# --- references ---------------------------------------------------------------------------------


def _profile(profile_id: str) -> VoiceProfile | None:
    return VoiceProfile.objects.filter(profile_id=profile_id, enabled=True).first()


def resolve(child, reference: dict) -> Resolved:
    """The approved text and voice a reference names, or a `SpeechError` (404 for the unknown)."""
    kind = reference.get("kind")
    missing = SpeechError("not_found", "That line is not available.", status=404)
    if kind == "utterance":
        try:
            utterance_id = uuid.UUID(str(reference.get("id")))
        except ValueError:
            raise missing from None
        utterance = (
            ApprovedUtterance.objects.for_child(child)
            .select_related("voice_profile")
            .filter(pk=utterance_id, expires_at__gt=now())
            .first()
        )
        if utterance is None or not utterance.voice_profile.enabled:
            raise missing
        return Resolved(
            utterance.text, utterance.voice_profile, ClipScope.CHILD, f"utterance:{utterance.pk}"
        )
    if kind == "line":
        line = (
            SpeechLine.objects.select_related("voice_profile")
            .filter(line_id=str(reference.get("id", "")), enabled=True)
            .first()
        )
        if line is None or not line.voice_profile.enabled:
            raise missing
        return Resolved(line.text, line.voice_profile, ClipScope.AUTHORED, f"line:{line.line_id}")
    if kind == "npcNode":
        from apps.ai.services.context import ContextNotFound, load_npc_narration

        npc_id, node_id = str(reference.get("npcId", "")), str(reference.get("nodeId", ""))
        try:
            narration = load_npc_narration(npc_id, node_id)
        except ContextNotFound:
            raise missing from None
        profile = VoiceProfile.objects.filter(
            character_id=npc_id, enabled=True
        ).first() or _profile("narrator")
        if profile is None:
            raise missing
        return Resolved(
            narration.fallback_text, profile, ClipScope.AUTHORED, f"npc:{npc_id}:{node_id}"
        )
    if kind == "npcDialogueNode":
        return _resolve_npc_dialogue_node(child, reference, missing)
    raise SpeechError("invalid_reference", "That is not something that can be spoken.", status=400)


def _resolve_npc_dialogue_node(child, reference: dict, missing: SpeechError) -> Resolved:
    from apps.npcs.speech import published_node

    try:
        release = int(reference.get("release"))
    except (TypeError, ValueError):
        raise missing from None
    node = published_node(
        str(reference.get("npcId", "")),
        release,
        str(reference.get("dialogueKey", "")),
        str(reference.get("nodeKey", "")),
    )
    # A node this child's age band does not see is the same 404 as one that does not exist.
    if node is None or not node.admits(child.age_band):
        raise missing
    profile = _profile(node.voice_profile)
    if profile is None:
        raise missing
    return Resolved(node.text, profile, ClipScope.AUTHORED, node.label)


# --- limits and counts ----------------------------------------------------------------------------


def _semaphore() -> threading.BoundedSemaphore:
    global _concurrency, _concurrency_size
    size = max(1, settings.LAI_SPEECH_MAX_CONCURRENT)
    if _concurrency is None or _concurrency_size != size:
        _concurrency, _concurrency_size = threading.BoundedSemaphore(size), size
    return _concurrency


def _bump_usage(child, **counts) -> SpeechUsage:
    today = now().date()
    usage, _ = SpeechUsage.objects.get_or_create(child=child, day=today)
    SpeechUsage.objects.filter(pk=usage.pk).update(**{k: F(k) + v for k, v in counts.items()})
    usage.refresh_from_db()
    return usage


def _bump_total(**counts) -> None:
    today = now().date()
    SpeechDailyTotal.objects.get_or_create(day=today)
    SpeechDailyTotal.objects.filter(day=today).update(**{k: F(k) + v for k, v in counts.items()})
    price = settings.LAI_SPEECH_PRICE_PER_MCHAR_USD
    if price is not None and counts.get("characters_synthesized"):
        total = SpeechDailyTotal.objects.get(day=today)
        SpeechDailyTotal.objects.filter(day=today).update(
            estimated_cost_microusd=int(total.characters_synthesized * price)
        )


def _check_limits(child, characters: int) -> None:
    usage = _bump_usage(child, requests=1, characters=characters)
    if (
        usage.requests > settings.LAI_SPEECH_CHILD_DAILY_REQUESTS
        or usage.characters > settings.LAI_SPEECH_CHILD_DAILY_CHARS
    ):
        raise SpeechError("rate_limited", "Too much speech today. Try again tomorrow.", status=429)
    today = SpeechDailyTotal.objects.filter(day=now().date()).first()
    already = today.characters_synthesized if today else 0
    if already + characters > settings.LAI_SPEECH_GLOBAL_DAILY_CHARS:
        raise SpeechError(
            "speech_unavailable", "Speech is resting. Please read along.", reason="global_cap"
        )


# --- cache ----------------------------------------------------------------------------------------


def cache_key(resolved: Resolved, child) -> str:
    profile = resolved.profile
    parts = [
        settings.LAI_SPEECH_CACHE_VERSION,
        resolved.text,
        profile.polly_voice_id,
        profile.engine,
        profile.language_code,
        str(profile.speaking_rate_percent),
        # A child's own text never shares a clip with another child's.
        str(child.pk) if resolved.scope == ClipScope.CHILD else "shared",
    ]
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()


def _lock(key: str) -> None:
    """Serialize identical syntheses across processes (PostgreSQL only; held until commit)."""
    if connection.vendor == "postgresql":
        digest = int(hashlib.sha256(key.encode()).hexdigest()[:15], 16)
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [digest])


def _live_clip(key: str) -> SpeechClip | None:
    clip = SpeechClip.objects.filter(cache_key=key).first()
    if clip is None:
        return None
    if clip.expires_at is not None and clip.expires_at <= now():
        return None
    return clip


def _synthesize(resolved: Resolved, client: PollyClient | None = None) -> bytes:
    profile = resolved.profile
    problem = voices.voice_problem(profile.polly_voice_id, profile.language_code, profile.engine)
    if problem:
        raise SpeechError(
            "speech_unavailable", "This voice is not available.", reason="invalid_voice"
        )
    text, text_type = voices.build_request_text(
        resolved.text, profile.engine, profile.speaking_rate_percent
    )
    gate = _semaphore()
    if not gate.acquire(blocking=False):
        raise SpeechError("speech_unavailable", "Speech is busy. Please read along.", reason="busy")
    try:
        return (client or get_polly_client()).synthesize(
            text=text,
            text_type=text_type,
            voice_id=profile.polly_voice_id,
            engine=profile.engine,
            language=profile.language_code,
        )
    finally:
        gate.release()


# --- delivery -------------------------------------------------------------------------------------


def delivery_token(clip: SpeechClip) -> str:
    return signing.TimestampSigner(salt=DELIVERY_SALT).sign(str(clip.pk))


def clip_for_token(token: str) -> SpeechClip | None:
    try:
        raw = signing.TimestampSigner(salt=DELIVERY_SALT).unsign(
            token, max_age=settings.LAI_SPEECH_URL_TTL_SECONDS
        )
        clip = SpeechClip.objects.filter(pk=int(raw)).first()
    except (signing.BadSignature, ValueError):
        return None
    if clip is None or (clip.expires_at is not None and clip.expires_at <= now()):
        return None
    return clip


def read_clip(clip: SpeechClip) -> bytes:
    """The clip's bytes. A missing object invalidates the row, so the next request re-makes it."""
    try:
        return get_speech_storage().read(clip.storage_key)
    except SpeechStorageError:
        # The object is gone (a lifecycle rule, a manual delete, a failed write): drop the row so
        # the cache does not keep pointing at nothing. The caller answers 404 and the child's
        # app keeps the caption; asking again synthesizes a fresh clip.
        SpeechClip.objects.filter(pk=clip.pk).delete()
        logger.warning("speech object missing; cache entry invalidated")
        raise


def _url_for(clip: SpeechClip) -> str:
    ttl = settings.LAI_SPEECH_URL_TTL_SECONDS
    if settings.LAI_SPEECH_DELIVERY == "s3":
        try:
            presigned = get_speech_storage().presigned_url(clip.storage_key, expires_in=ttl)
        except SpeechStorageError:
            # Signing failed (credentials, clock): the Django route still serves the same clip.
            logger.warning("speech presign failed; serving through django")
            presigned = None
        if presigned:
            return presigned
    return f"/api/v1/speech-files/{delivery_token(clip)}/speech.mp3"


# --- the entry point ------------------------------------------------------------------------------


def speak(child, reference: dict) -> SpeechResult:
    """Authorize, limit, cache and (if needed) synthesize. Raises `SpeechError`."""
    if not speech_enabled():
        raise SpeechError("speech_disabled", "Spoken dialogue is turned off.")
    if not child.ai_enabled and reference.get("kind") == "utterance":
        # The parent switched AI off: AI-made text is never spoken either.
        raise SpeechError("not_found", "That line is not available.", status=404)
    resolved = resolve(child, reference)
    problem = text_problem(resolved.text)
    if problem:
        # Approved text that no longer passes (a rule tightened since): refuse, quietly.
        logger.warning("speech refused by output rules: %s", resolved.reference.split(":")[0])
        raise SpeechError("speech_rejected", "That line cannot be spoken.", status=422)
    characters = len(resolved.text)
    kind = resolved.reference.split(":")[0]
    try:
        result = _serve(child, resolved, characters)
    except SpeechError as error:
        # Kind, profile, code and reason only: never the text, the child or an AWS message.
        logger.warning(
            "speech failed kind=%s profile=%s code=%s reason=%s",
            kind,
            resolved.profile.profile_id,
            error.code,
            error.reason,
        )
        # Counted outside the transaction that failed, so the count survives the rollback.
        if error.code in {"speech_unavailable", "speech_rejected"}:
            try:
                _bump_usage(child, failures=1)
                _bump_total(failures=1)
            except DatabaseError:
                logger.exception("could not count a speech failure")
        raise
    except DatabaseError:
        logger.exception("speech counters failed")
        raise SpeechError("speech_unavailable", "Speech could not be made right now.") from None
    logger.info(
        "speech served kind=%s profile=%s cached=%s chars=%d",
        kind,
        resolved.profile.profile_id,
        result.cached,
        characters,
    )
    return result


def _store_clip(key: str, resolved: Resolved, audio: bytes, *, owner_child_id=None) -> SpeechClip:
    path = storage_key(key, resolved.scope)
    try:
        get_speech_storage().put(path, audio)
    except SpeechStorageError:
        raise SpeechError(
            "speech_unavailable", "Speech could not be saved.", reason="storage"
        ) from None
    expires = (
        None
        if resolved.scope == ClipScope.AUTHORED
        else now() + timedelta(hours=settings.LAI_SPEECH_CLIP_TTL_HOURS)
    )
    SpeechClip.objects.filter(cache_key=key).delete()
    return SpeechClip.objects.create(
        cache_key=key,
        storage_key=path,
        scope=resolved.scope,
        owner_child_id=owner_child_id,
        voice_profile_id=resolved.profile.profile_id,
        voice=resolved.profile.polly_voice_id,
        engine=resolved.profile.engine,
        language=resolved.profile.language_code,
        characters=len(resolved.text),
        byte_size=len(audio),
        expires_at=expires,
    )


def prepare_shared_clip(resolved: Resolved, *, client: PollyClient | None = None) -> bool:
    """Make sure a shared (authored) clip is cached, with no child involved (LAI-NPC-028).

    For pre-generation after a publish. Same kill switch, output rules, voice table, global daily
    cap, concurrency gate, cache key and lock as `speak`; no per-child counters (no child asked).
    Returns True when it synthesized, False when the clip was already cached. Raises
    `SpeechError` (`daily_cap` when the global cap would be passed).
    """
    if not speech_enabled():
        raise SpeechError("speech_disabled", "Spoken dialogue is turned off.")
    if resolved.scope != ClipScope.AUTHORED:
        raise SpeechError("invalid_reference", "Only shared lines can be prepared.", status=400)
    if text_problem(resolved.text):
        raise SpeechError("speech_rejected", "That line cannot be spoken.", status=422)
    key = cache_key(resolved, None)
    characters = len(resolved.text)
    with transaction.atomic():
        _lock(key)
        if _live_clip(key) is not None:
            return False
        today = SpeechDailyTotal.objects.filter(day=now().date()).first()
        already = today.characters_synthesized if today else 0
        if already + characters > settings.LAI_SPEECH_GLOBAL_DAILY_CHARS:
            raise SpeechError("daily_cap", "Speech is resting. Please read along.")
        _store_clip(key, resolved, _synthesize(resolved, client))
        _bump_total(cache_misses=1, characters_synthesized=characters)
    return True


def _serve(child, resolved: Resolved, characters: int) -> SpeechResult:
    _check_limits(child, characters)
    key = cache_key(resolved, child)
    cached = True
    with transaction.atomic():
        _lock(key)
        clip = _live_clip(key)
        if clip is None:
            cached = False
            clip = _store_clip(
                key,
                resolved,
                _synthesize(resolved),
                owner_child_id=child.pk if resolved.scope == ClipScope.CHILD else None,
            )
            _bump_total(requests=1, cache_misses=1, characters_synthesized=characters)
        else:
            _bump_usage(child, cache_hits=1)
            _bump_total(requests=1, cache_hits=1)
        SpeechClip.objects.filter(pk=clip.pk).update(hits=F("hits") + 1, last_used_at=now())
    return SpeechResult(
        url=_url_for(clip),
        expires_in=settings.LAI_SPEECH_URL_TTL_SECONDS,
        text=resolved.text,
        voice_profile=resolved.profile.profile_id,
        language=resolved.profile.language_code,
        characters=characters,
        cached=cached,
    )


# --- cleanup --------------------------------------------------------------------------------------


def cleanup(*, dry_run: bool = False) -> dict[str, int]:
    """Delete expired utterances and clips (and their objects). Returns what it removed."""
    stamp = now()
    removed = {"utterances": 0, "clips": 0, "objects_failed": 0}
    expired_utterances = ApprovedUtterance.objects.filter(expires_at__lte=stamp)
    removed["utterances"] = expired_utterances.count()
    expired_clips = list(SpeechClip.objects.filter(expires_at__lte=stamp))
    removed["clips"] = len(expired_clips)
    if dry_run:
        return removed
    expired_utterances.delete()
    for clip in expired_clips:
        try:
            get_speech_storage().delete(clip.storage_key)
        except SpeechStorageError:
            removed["objects_failed"] += 1
            continue  # keep the row so the next run retries the object
        clip.delete()
    return removed


def purge_child(child_id) -> int:
    """Remove a deleted child's clips straight away (their rows would also expire on their own)."""
    clips = list(SpeechClip.objects.filter(owner_child_id=child_id))
    for clip in clips:
        try:
            get_speech_storage().delete(clip.storage_key)
        except SpeechStorageError:
            continue
        clip.delete()
    return len(clips)
