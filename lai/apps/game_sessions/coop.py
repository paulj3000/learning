"""Household co-op sessions on Django (AMP-05; ADR-006, replaces the Amplify `CoopSession` model
writes and the `claimCoopSlot` Lambda).

Rules, unchanged from Amplify (`amplify/functions/claim-coop-slot/handler.ts`,
docs/ADVENTURE_ENGINE.md "Co-op sessions"):

* household only: the host parent owns both children; nobody else can see the session;
* exactly two different children, both in an age band the adventure is authored for;
* a slot is a co-op-eligible step of the adventure (NUMBER_INPUT, ORDERING, MATCHING,
  WORLD_CHANGE). The first claim wins. A second claim by the same child changes nothing
  (idempotent); a claim on a slot the other child holds is not an error, the caller simply
  re-renders the current state;
* presence is a best-effort join/leave flag, never continuous telemetry;
* only an ACTIVE session accepts claims; completing is idempotent.

Every write locks the session row (`select_for_update`), so two near-simultaneous claims are
serialised and exactly one wins: the PostgreSQL equivalent of DynamoDB's conditional write.
Nothing a child types crosses to the other child: the shared state holds step ids and child
ids only (ADR-006).
"""

import json
from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone

from apps.catalog.models import Adventure
from apps.users import services as user_services

from .models import CoopParticipant, CoopSession, CoopSessionStatus

COOP_ELIGIBLE_STEP_TYPES = frozenset({"NUMBER_INPUT", "ORDERING", "MATCHING", "WORLD_CHANGE"})


class CoopError(Exception):
    pass


class CoopNotFound(CoopError):
    """Unknown, another family's, or not this child's session: indistinguishable."""


class PartnerInvalid(CoopError):
    """The partner is the same child, not this parent's, or inactive."""


class AdventureInvalid(CoopError):
    """Unknown or inactive adventure, or not authored for both children's age bands."""


class SlotInvalid(CoopError):
    """Not a co-op-eligible step of this session's adventure."""


class CoopNotActive(CoopError):
    pass


def shared_state(session: CoopSession) -> dict:
    """`{slots: {stepId: childId}, presence: [childId]}`, read defensively.

    Rows imported from Amplify may hold the AWSJSON string form; anything malformed reads as
    empty, the same rule as `parseCoopSharedState` in the client.
    """
    raw = session.shared_state
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = None
    if not isinstance(raw, dict):
        raw = {}
    slots = raw.get("slots") if isinstance(raw.get("slots"), dict) else {}
    presence = raw.get("presence") if isinstance(raw.get("presence"), list) else []
    return {
        "slots": {str(k): v for k, v in slots.items() if isinstance(v, str)},
        "presence": [p for p in presence if isinstance(p, str)],
    }


def participant_ids(session: CoopSession) -> list[str]:
    return [
        str(cid) for cid in session.participants.order_by("id").values_list("child_id", flat=True)
    ]


def represent(session: CoopSession) -> dict:
    """The wire shape: the fields the Amplify `CoopSession` type carried, minus the parent id."""
    return {
        "id": str(session.id),
        "templateSlug": session.adventure.slug,
        "templateVersion": session.template_version,
        "participantChildProfileIds": participant_ids(session),
        "status": session.status,
        "sharedState": shared_state(session),
        "startedAt": session.started_at.isoformat(),
        "lastActivityAt": session.last_activity_at.isoformat(),
        "completedAt": session.completed_at.isoformat() if session.completed_at else None,
    }


def start(parent, host_child, *, adventure_slug: str, partner_child_id) -> CoopSession:
    """A new ACTIVE session for two of this parent's children."""
    try:
        partner = user_services.get_owned_child_profile(parent, partner_child_id)
    except user_services.ChildProfileNotFound:
        raise PartnerInvalid from None
    if partner.pk == host_child.pk or not partner.active or not host_child.active:
        raise PartnerInvalid
    adventure = Adventure.objects.filter(slug=adventure_slug, active=True).first()
    if adventure is None or not {host_child.age_band, partner.age_band} <= set(adventure.age_bands):
        raise AdventureInvalid
    now = timezone.now()
    with transaction.atomic():
        session = CoopSession.objects.create(
            host_parent=parent,
            adventure=adventure,
            template_version=adventure.version,
            status=CoopSessionStatus.ACTIVE,
            shared_state={"slots": {}, "presence": []},
            started_at=now,
            last_activity_at=now,
        )
        for child in (host_child, partner):
            CoopParticipant.objects.create(coop_session=session, child=child)
    return session


def _scoped(parent, child):
    """Sessions this parent hosts and this child takes part in. Everything else is not found."""
    return CoopSession.objects.filter(host_parent=parent, participants__child=child).select_related(
        "adventure"
    )


def get(parent, child, coop_id) -> CoopSession:
    session = _scoped(parent, child).filter(pk=coop_id).first()
    if session is None:
        raise CoopNotFound
    return session


def _locked(parent, child, coop_id) -> CoopSession:
    """Must run inside `transaction.atomic()`."""
    session = _scoped(parent, child).select_for_update(of=("self",)).filter(pk=coop_id).first()
    if session is None:
        raise CoopNotFound
    return session


@dataclass(frozen=True)
class ClaimOutcome:
    session: CoopSession
    outcome: str  # "claimed" | "already_held" | "held_by_partner"


def claim_slot(parent, child, coop_id, slot_key: str) -> ClaimOutcome:
    """First claim wins; see the module docstring."""
    with transaction.atomic():
        session = _locked(parent, child, coop_id)
        eligible = session.adventure.steps.filter(
            step_id=slot_key, step_type__in=COOP_ELIGIBLE_STEP_TYPES
        ).exists()
        if not eligible:
            raise SlotInvalid
        if session.status != CoopSessionStatus.ACTIVE:
            raise CoopNotActive
        state = shared_state(session)
        holder = state["slots"].get(slot_key)
        child_id = str(child.pk)
        if holder == child_id:
            return ClaimOutcome(session, "already_held")
        if holder:
            return ClaimOutcome(session, "held_by_partner")
        state["slots"][slot_key] = child_id
        session.shared_state = state
        session.last_activity_at = timezone.now()
        session.save(update_fields=["shared_state", "last_activity_at"])
        return ClaimOutcome(session, "claimed")


def set_presence(parent, child, coop_id, present: bool) -> CoopSession:
    """Join or leave. Last write wins; a lost toggle has no gameplay consequence (ADR-006)."""
    with transaction.atomic():
        session = _locked(parent, child, coop_id)
        state = shared_state(session)
        child_id = str(child.pk)
        if (child_id in state["presence"]) == present:
            return session
        others = [p for p in state["presence"] if p != child_id]
        presence = [*others, child_id] if present else others
        state["presence"] = presence
        session.shared_state = state
        session.last_activity_at = timezone.now()
        session.save(update_fields=["shared_state", "last_activity_at"])
        return session


def complete(parent, child, coop_id) -> CoopSession:
    """ACTIVE -> COMPLETED once; completing a completed session changes nothing."""
    with transaction.atomic():
        session = _locked(parent, child, coop_id)
        if session.status == CoopSessionStatus.COMPLETED:
            return session
        if session.status != CoopSessionStatus.ACTIVE:
            raise CoopNotActive
        now = timezone.now()
        session.status = CoopSessionStatus.COMPLETED
        session.completed_at = now
        session.last_activity_at = now
        session.save(update_fields=["status", "completed_at", "last_activity_at"])
        return session
