"""Step-based adventure sessions outside a 3D Area (AMP-03): the classic adventure routes.

Child-scoped and bearer-only (`ChildScopedAPIView`, LAI-0403). Thin views over
`services.start_or_resume_session` (LAI-0601); answers and hints stay `views.py`.

GET  children/{id}/sessions/                       the child's adventure sessions, newest first
GET  children/{id}/adventures/{slug}/session/      {"session": the ACTIVE session or null}
POST children/{id}/adventures/{slug}/session/      start (201) or resume (200) it
GET  children/{id}/adventure-actions/              the child's step attempts (parent dashboard)
GET  children/{id}/availability/                   which places and adventures are in play

Nothing here grades, advances or completes a session: the answers route does, on the server.
"""

import json

from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.catalog.models import Adventure, Location
from apps.users.scoping import ChildScopedAPIView

from . import services
from .models import AdventureAction, AdventureSession, SessionKind
from .native_views import AdventureUnavailable
from .serializers import EmptyRequest
from .views import session_state

MAX_SESSIONS = 500
MAX_ACTIONS = 2000


def answer_label(stored: str) -> str | None:
    """The short form of a stored structured answer, as the client always summarised it
    (`normalizeAnswer`): an option id, a number, an order or pairs. Never free text."""
    try:
        answer = json.loads(stored) if stored else None
    except ValueError:
        return None
    if not isinstance(answer, dict):
        return None
    kind = answer.get("kind")
    if kind == "number-input" and isinstance(answer.get("value"), int | float):
        return str(answer["value"])
    if kind in ("choice", "short-response", "creative-choice"):
        option = answer.get("optionId")
        return option if isinstance(option, str) else None
    if kind == "ordering" and isinstance(answer.get("order"), list):
        return ",".join(str(item) for item in answer["order"])
    if kind == "matching" and isinstance(answer.get("pairs"), list):
        return ",".join(
            f"{pair.get('leftId')}:{pair.get('rightId')}"
            for pair in answer["pairs"]
            if isinstance(pair, dict)
        )
    return None


def classic_session(session: AdventureSession) -> dict:
    return {**session_state(session), "locationSlug": session.adventure.location_slug}


def _adventure(slug: str) -> Adventure:
    adventure = (
        Adventure.objects.select_related("location__world", "world").filter(slug=slug).first()
    )
    if adventure is None:
        raise NotFound
    return adventure


def _in_play(adventure: Adventure) -> bool:
    """Active adventure, active Place and Island (ADR-031), as `is_playable` plus the Island."""
    worlds = [adventure.world, adventure.location.world if adventure.location else None]
    return services.is_playable(adventure) and all(w.active for w in worlds if w is not None)


class SessionListView(ChildScopedAPIView):
    def get(self, request, child_id):
        sessions = (
            self.scoped(AdventureSession.objects.select_related("adventure"))
            .filter(kind=SessionKind.ADVENTURE)
            .order_by("-last_activity_at", "-started_at")[:MAX_SESSIONS]
        )
        return Response({"sessions": [classic_session(s) for s in sessions]})


class AdventureSessionView(ChildScopedAPIView):
    def get(self, request, child_id, adventure_slug):
        adventure = _adventure(adventure_slug)
        session = (
            self.scoped(AdventureSession.objects.select_related("adventure"))
            .filter(adventure=adventure, status="ACTIVE")
            .first()
        )
        return Response({"session": classic_session(session) if session else None})

    def post(self, request, child_id, adventure_slug):
        EmptyRequest(data=request.data or {}).is_valid(raise_exception=True)
        adventure = _adventure(adventure_slug)
        if not _in_play(adventure):
            raise AdventureUnavailable
        try:
            session, created = services.start_or_resume_session(self.child, adventure)
        except (services.InvalidTransition, services.ProgressNotFound):
            raise AdventureUnavailable from None
        return Response(classic_session(session), status=201 if created else 200)


class AdventureActionListView(ChildScopedAPIView):
    def get(self, request, child_id):
        actions = AdventureAction.objects.filter(session__child=self.child).order_by(
            "-created_at", "-attempt_number"
        )[:MAX_ACTIONS]
        return Response(
            {
                "actions": [
                    {
                        "id": str(action.pk),
                        "sessionId": str(action.session_id),
                        "stepId": action.step_id,
                        "actionType": action.action_type,
                        "correctness": action.correctness,
                        "normalizedAnswer": answer_label(action.normalized_answer),
                        "hintLevel": action.hint_level,
                        "attemptNumber": action.attempt_number,
                        "nextStepId": action.next_step_id or None,
                        "createdAt": action.created_at.isoformat(),
                    }
                    for action in actions
                ]
            }
        )


class AvailabilityView(ChildScopedAPIView):
    """Release flags only (ADR-031): an inactive place or adventure is listed with
    `active: false` rather than left out, so the client can tell "taken out of play" from "not in
    the catalog". No titles, no content and nothing about the child."""

    def get(self, request, child_id):
        places = [
            {
                "slug": location.slug,
                "active": location.active and location.world.active,
            }
            for location in Location.objects.select_related("world").order_by("slug")
        ]
        adventures = [
            {
                "slug": adventure.slug,
                "placeSlug": adventure.location_slug,
                "active": adventure.active,
            }
            for adventure in Adventure.objects.order_by("slug")
        ]
        return Response({"places": places, "adventures": adventures})
