"""The generic, client-initiated world-change write, with its proof of play.

`POST world-changes/` is for the island's own runtime (a placed plank, a collected gear). It must
never be a way to claim progress that only playing earns, so a **protected** key
(`protected_changes`) is accepted only when it is backed by a finished producer the child owns:

- an adventure key needs a COMPLETED `AdventureSession` of the child whose template is a
  registered producer of that key and whose action trail reached the producing step;
- a story key needs the child's own completed `StoryProgress` of a producing story;
- a quest, discovery or castle-room key can never be written here (Django writes it when it accepts
  the quest state, the discovery or the room).

Session ids are looked up through the child's own rows, so another family's (or another child's)
session is `SessionNotFound`, the same answer as an unknown one. The whole write runs in one
transaction that first locks the child row, so the cap check, the proof and the insert cannot race;
the unique constraint still makes a replay return the one row (`created=False`).
"""

import uuid
from dataclasses import dataclass

from django.db import transaction

from apps.game_sessions.models import AdventureSession, SessionKind, SessionStatus
from apps.users.models import ChildProfile

from . import protected_changes as protected
from .models import StoryProgress, WorldChange
from .services import record_world_change

MAX_WORLD_CHANGES = 1000


class ClientChangeError(Exception):
    """A refused client write. `code` is the safe, machine-readable reason."""

    status = 400
    code = "invalid"


class ProtectedKey(ClientChangeError):
    code = "protected_change_key"


class WrongLocation(ClientChangeError):
    code = "protected_change_key"


class SessionNotFound(ClientChangeError):
    status = 404
    code = "not_found"


class WrongProducer(ClientChangeError):
    code = "wrong_producer"


class NotCompleted(ClientChangeError):
    code = "session_not_completed"


class StepNotReached(ClientChangeError):
    code = "step_not_reached"


class LimitReached(ClientChangeError):
    status = 409
    code = "world_change_limit"


@dataclass(frozen=True)
class Recorded:
    change: WorldChange
    created: bool


def _step_reached(session: AdventureSession, step_id: str) -> bool:
    """The child answered, or moved on from, the producing step in this session."""
    actions = session.actions
    return actions.filter(next_step_id=step_id).exists() or actions.filter(step_id=step_id).exists()


def _verify_adventure(child, entry: protected.ProtectedKey, session_id: uuid.UUID):
    session = (
        AdventureSession.objects.for_child(child)
        .select_for_update(of=("self",))
        .select_related("adventure")
        .filter(pk=session_id, kind=SessionKind.ADVENTURE)
        .first()
    )
    if session is None:
        raise SessionNotFound
    producers = {p.slug: p for p in entry.producers if p.kind == protected.ADVENTURE}
    producer = producers.get(session.adventure.slug) if session.adventure else None
    if producer is None:
        raise WrongProducer
    if session.status != SessionStatus.COMPLETED:
        raise NotCompleted
    if not _step_reached(session, producer.step_id):
        raise StepNotReached
    return session


def _verify_story(child, entry: protected.ProtectedKey, progress_id: uuid.UUID):
    progress = StoryProgress.objects.for_child(child).filter(pk=progress_id).first()
    if progress is None:
        raise SessionNotFound
    if progress.story_slug not in {p.slug for p in entry.producers if p.kind == protected.STORY}:
        raise WrongProducer
    if progress.completed_at is None:
        raise NotCompleted
    return progress


def record_client_world_change(
    child,
    *,
    location_slug: str,
    change_type: str,
    change_key: str,
    source: str = "",
    session_id: uuid.UUID | None = None,
) -> Recorded:
    """Record a change the client asked for. `source` is a provenance label (never a session id);
    `session_id` is an adventure session or a completed story's progress id."""
    entry = protected.lookup(change_key)
    if entry is None and protected.is_protected(change_key):
        raise ProtectedKey  # a reserved name the export does not define: nobody may write it
    with transaction.atomic():
        # Serialises this child's client writes: the cap check and insert cannot interleave.
        ChildProfile.objects.select_for_update().get(pk=child.pk)
        source_session = None
        source_id = source
        if entry is not None:
            if not entry.client_writable:
                raise ProtectedKey
            if location_slug != entry.location_slug:
                raise WrongLocation
            if session_id is None:
                raise ProtectedKey
            change_type = entry.change_type  # the registered type, never the client's
            source_id = ""
            if any(p.kind == protected.ADVENTURE for p in entry.producers):
                source_session = _verify_adventure(child, entry, session_id)
            else:
                source_id = f"story:{_verify_story(child, entry, session_id).pk}"
        elif session_id is not None:
            # An ordinary key: the session only has to be the child's own (as before).
            source_session = AdventureSession.objects.for_child(child).filter(pk=session_id).first()
            if source_session is None:
                raise SessionNotFound
            source_id = ""
        existing = WorldChange.objects.for_child(child).filter(
            location_slug=location_slug, change_key=change_key
        )
        if (
            not existing.exists()
            and WorldChange.objects.for_child(child).count() >= MAX_WORLD_CHANGES
        ):
            raise LimitReached
        change, created = record_world_change(
            child,
            location_slug=location_slug,
            change_type=change_type,
            change_key=change_key,
            source_session=source_session,
            source_session_id=source_id,
        )
        return Recorded(change, created)
