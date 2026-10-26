"""Step-adventure sessions (LAI-0608) and their answers and hints (LAI-0601). Child-scoped, deny
by default (LAI-0403). Contract: docs/PLAY_API.md, "Step adventures".

POST /api/v1/children/{child_id}/adventures/{adventure_id}/sessions/
    no body. 201 new session, 200 the child's ACTIVE one resumed. Same body as the read.
GET  /api/v1/children/{child_id}/adventures/{adventure_id}/availability/
    200: {"adventureId", "available", "reasons": [...], "status", "resumeSessionId"}
GET  /api/v1/children/{child_id}/adventures/{adventure_id}/sessions/{session_id}/
    200: {"session", "step", "progress", "contentCurrent", "allowedActions", "canComplete"}
POST /api/v1/children/{child_id}/adventures/{adventure_id}/sessions/{session_id}/complete/
    no body. 200 with the read body; idempotent. 409 `session_not_complete` before the end.

POST /api/v1/children/{child_id}/sessions/{session_id}/answers/
    body: {"stepId": str, "answer": {...a StepAnswer...}, "requestId": uuid}
    200:  {"correctness", "supportLevel", "action", "nextStepId", "attemptNumber", "replayed",
           "session": {...}}
POST /api/v1/children/{child_id}/sessions/{session_id}/hints/
    body: {"stepId": str, "fromLevel": int}
    200:  {"hintLevel", "hintText", "session": {...}}

The first four response fields keep `submitAdventureAnswer`'s shape. The client sends what the
child did, never correctness, hint level, the next step or completion. A repeated `requestId`
returns the stored outcome with `replayed: true` and changes nothing. Errors use the API error
contract: 404 `not_found` for a session that is not this child's, 400 `validation_error` or
`answer_invalid`, 409 `session_not_active`, `step_not_current`, `content_version_changed`,
`request_conflict`.
"""

from rest_framework import serializers, status
from rest_framework.exceptions import APIException, NotFound
from rest_framework.response import Response

from apps.catalog.models import Adventure
from apps.game_sessions import adventure_state, services
from apps.game_sessions.adventure_state import session_state
from apps.game_sessions.models import AdventureSession, SessionKind
from apps.inventory import services as inventory
from apps.inventory.serializers import rewards_body
from apps.users.scoping import ChildScopedAPIView


class _Coded(APIException):
    status_code = status.HTTP_409_CONFLICT


class AnswerInvalid(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "answer_invalid"


class SessionNotActive(_Coded):
    default_code = "session_not_active"


class StepNotCurrent(_Coded):
    default_code = "step_not_current"


class ContentVersionChanged(_Coded):
    default_code = "content_version_changed"


class RequestConflict(_Coded):
    default_code = "request_conflict"


class InvalidTransition(_Coded):
    default_code = "invalid_transition"


class AdventureUnavailable(_Coded):
    default_code = "adventure_unavailable"


class ChildInactive(_Coded):
    default_code = "child_inactive"


class SessionNotComplete(_Coded):
    default_code = "session_not_complete"


# Most specific first: the service exceptions form a small hierarchy.
_ERRORS = [
    (services.ProgressNotFound, NotFound),
    (services.SessionNotActive, SessionNotActive),
    (services.StepNotCurrent, StepNotCurrent),
    (services.ContentVersionChanged, ContentVersionChanged),
    (services.RequestConflict, RequestConflict),
    (services.InvalidAnswer, AnswerInvalid),
    (services.SessionNotComplete, SessionNotComplete),
    (services.InvalidTransition, InvalidTransition),
]


def _api_error(error: services.ProgressError) -> APIException:
    for service_error, api_error in _ERRORS:
        if isinstance(error, service_error):
            return api_error()
    return InvalidTransition()


class AnswerRequest(serializers.Serializer):
    stepId = serializers.CharField(max_length=100)
    answer = serializers.JSONField()
    requestId = serializers.UUIDField()


class HintRequest(serializers.Serializer):
    stepId = serializers.CharField(max_length=100)
    fromLevel = serializers.IntegerField(min_value=0, max_value=5)


class AnswersView(ChildScopedAPIView):
    def post(self, request, child_id, session_id):
        body = AnswerRequest(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        try:
            outcome = services.submit_answer(
                self.child,
                session_id,
                step_id=data["stepId"],
                answer=data["answer"],
                request_id=data["requestId"],
            )
        except services.ProgressError as error:
            raise _api_error(error) from None
        return Response(
            {
                "correctness": outcome.correctness,
                "supportLevel": outcome.support_level,
                "action": outcome.action,
                "nextStepId": outcome.next_step_id,
                "attemptNumber": outcome.attempt_number,
                "replayed": outcome.replayed,
                "session": session_state(outcome.session),
                # LAI-0604, additive: what this answer earned (empty for most answers).
                "rewards": rewards_body(outcome.rewards),
            }
        )


class HintsView(ChildScopedAPIView):
    def post(self, request, child_id, session_id):
        body = HintRequest(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        try:
            level, text = services.request_hint(
                self.child, session_id, step_id=data["stepId"], from_level=data["fromLevel"]
            )
            session = AdventureSession.objects.for_child(self.child).get(pk=session_id)
        except services.ProgressError as error:
            raise _api_error(error) from None
        return Response({"hintLevel": level, "hintText": text, "session": session_state(session)})


# --- Session lifecycle (LAI-0608) -----------------------------------------------------------


def _empty_body(request) -> None:
    """These routes take no body: anything sent is refused, never silently applied."""
    if request.data:
        raise serializers.ValidationError(
            {"non_field_errors": ["This request takes no body."]}, code="unexpected_body"
        )


def _visible(child, adventure_id):
    try:
        return adventure_state.visible_adventure(child, adventure_id)
    except adventure_state.AdventureNotVisible:
        raise NotFound from None


def _known(adventure_id):
    """Any catalog adventure by slug: a session started on it stays readable if it is retired."""
    adventure = Adventure.objects.filter(slug=adventure_id).first()
    if adventure is None:
        raise NotFound
    return adventure


def _session_of(child, adventure, session_id) -> AdventureSession:
    session = (
        AdventureSession.objects.for_child(child)
        .select_related("adventure", "child")
        .filter(pk=session_id, kind=SessionKind.ADVENTURE, adventure=adventure)
        .first()
    )
    if session is None:
        raise NotFound  # unknown, another child's, a region session, or another adventure's
    return session


class AdventureAvailabilityView(ChildScopedAPIView):
    def get(self, request, child_id, adventure_id):
        result = adventure_state.availability(self.child, _visible(self.child, adventure_id))
        return Response(
            {
                "adventureId": result.adventure.slug,
                "available": result.available,
                "reasons": result.reasons,
                "status": result.status,
                "resumeSessionId": str(result.active_session.pk) if result.active_session else None,
            }
        )


class AdventureSessionsView(ChildScopedAPIView):
    """POST: start this adventure, or resume the child's ACTIVE session for it."""

    def post(self, request, child_id, adventure_id):
        _empty_body(request)
        adventure = _visible(self.child, adventure_id)
        result = adventure_state.availability(self.child, adventure)
        if not result.available:
            if adventure_state.CHILD_INACTIVE in result.reasons:
                raise ChildInactive
            if adventure_state.ACTIVE_SESSION_CONTENT_CHANGED in result.reasons:
                raise ContentVersionChanged
            raise AdventureUnavailable
        try:
            session, created = services.start_or_resume_session(self.child, adventure)
        except services.ProgressError as error:
            raise _api_error(error) from None
        session = _session_of(self.child, adventure, session.pk)
        return Response(
            adventure_state.session_view(session), status=201 if created else 200
        )


class AdventureSessionView(ChildScopedAPIView):
    def get(self, request, child_id, adventure_id, session_id):
        session = _session_of(self.child, _known(adventure_id), session_id)
        return Response(adventure_state.session_view(session))


class AdventureSessionCompleteView(ChildScopedAPIView):
    def post(self, request, child_id, adventure_id, session_id):
        _empty_body(request)
        adventure = _known(adventure_id)
        try:
            session, completed_now = services.finalize_session(self.child, session_id, adventure)
        except services.ProgressError as error:
            raise _api_error(error) from None
        grants = (
            session.completion_rewards
            if completed_now
            else inventory.grants_recorded_for_completion(session)
        )
        body = adventure_state.session_view(_session_of(self.child, adventure, session_id))
        return Response({**body, "rewards": rewards_body(grants)})
