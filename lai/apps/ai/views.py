"""AI turn endpoints (LAI-0702, LAI-0703). Child-scoped, deny by default (LAI-0403).

POST /api/v1/children/{child_id}/ai/companion-turns/
    body: {"intent", "templateId", "stepSummary", "authoredBaseText"?, "learningObjectiveCode"?,
           "hintLevel"?, "allowedChoiceIds"?, "sessionId"?, "stepId"?, "contextSource"?}
    200:  {"turn": {spokenText, emotion, intent, choices?, safetyDisposition},
           "source": "AI"|"FALLBACK", "requestId"}
POST /api/v1/children/{child_id}/ai/tutor-turns/
    body: {"skillId", "templateId", "hintLevel", "authoredBaseText"?, "sessionId"?, "stepId"?,
           "contextSource"?}
    200:  {"turn": {spokenText, strategy, representation?, emotion, safetyDisposition},
           "source", "requestId"}

`turn` and `source` are the `CompanionTurnResult` / `TutorTurnResult` shapes the React client
renders today. A turn is always safe to render: provider failures, invalid output, Guardrail
blocks and screened input all return 200 with authored content (`source: "FALLBACK"`), never
an error that names the cause. Errors are only for the request itself: 400 `validation_error`,
401/403 authentication, 404 `not_found` for another family's child or (DJANGO_SESSION) a session
or step that is not this child's.
"""

from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from apps.core.request_context import get_request_id
from apps.users.scoping import ChildScopedAPIView

from .serializers import CompanionTurnRequest, TutorTurnRequest
from .services.companion import request_companion_turn
from .services.context import ContextNotFound
from .services.tutor import SkillNotInStep, request_tutor_turn


def _response(result) -> Response:
    return Response({"turn": result.turn, "source": result.source, "requestId": get_request_id()})


class CompanionTurnView(ChildScopedAPIView):
    def post(self, request, child_id):
        body = CompanionTurnRequest(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            return _response(request_companion_turn(self.child, body.validated_data))
        except ContextNotFound:
            raise NotFound from None


class TutorTurnView(ChildScopedAPIView):
    def post(self, request, child_id):
        body = TutorTurnRequest(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            return _response(request_tutor_turn(self.child, body.validated_data))
        except ContextNotFound:
            raise NotFound from None
        except SkillNotInStep:
            raise ValidationError({"skillId": "Not an objective of this step."}) from None
