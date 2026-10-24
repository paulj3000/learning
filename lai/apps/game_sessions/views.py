"""Adventure answers and hints (LAI-0601). Child-scoped, deny by default (LAI-0403).

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

from apps.game_sessions import services
from apps.game_sessions.models import AdventureSession
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


# Most specific first: the service exceptions form a small hierarchy.
_ERRORS = [
    (services.ProgressNotFound, NotFound),
    (services.SessionNotActive, SessionNotActive),
    (services.StepNotCurrent, StepNotCurrent),
    (services.ContentVersionChanged, ContentVersionChanged),
    (services.RequestConflict, RequestConflict),
    (services.InvalidAnswer, AnswerInvalid),
    (services.InvalidTransition, InvalidTransition),
]


def _api_error(error: services.ProgressError) -> APIException:
    for service_error, api_error in _ERRORS:
        if isinstance(error, service_error):
            return api_error()
    return InvalidTransition()


def session_state(session: AdventureSession) -> dict:
    return {
        "id": str(session.pk),
        "adventureSlug": session.adventure.slug,
        "templateVersion": session.template_version,
        "status": session.status,
        "currentStepId": session.current_step_id,
        "hintLevel": int(session.hint_levels.get(session.current_step_id, 0)),
        "startedAt": session.started_at.isoformat(),
        "lastActivityAt": session.last_activity_at.isoformat(),
        "completedAt": session.completed_at.isoformat() if session.completed_at else None,
    }


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
                self.child, session_id, step_id=data["stepId"], answer=data["answer"],
                request_id=data["requestId"],
            )
        except services.ProgressError as error:
            raise _api_error(error) from None
        return Response({
            "correctness": outcome.correctness,
            "supportLevel": outcome.support_level,
            "action": outcome.action,
            "nextStepId": outcome.next_step_id,
            "attemptNumber": outcome.attempt_number,
            "replayed": outcome.replayed,
            "session": session_state(outcome.session),
        })


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
