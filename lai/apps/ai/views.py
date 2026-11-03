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

from django.conf import settings
from django.db import transaction
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from apps.core.request_context import get_request_id
from apps.speech.integration import approve_turn
from apps.users.scoping import ChildScopedAPIView

from .models import AIInteractionAudit, SafetyAction, SafetyEvent
from .serializers import CompanionTurnRequest, TutorTurnRequest
from .services.companion import request_companion_turn
from .services.context import ContextNotFound
from .services.tutor import SkillNotInStep, request_tutor_turn


def _check_size(request) -> None:
    """Bounds the body before parsing anything (LAI-0708): authored context is small."""
    if len(request.body) > settings.LAI_AI_MAX_REQUEST_BYTES:
        raise ValidationError({"non_field_errors": "Request too large."})


def _response(result, child=None, route: str = "", npc_id: str | None = None) -> Response:
    body = {"turn": result.turn, "source": result.source, "requestId": get_request_id()}
    # SM-P8-08: a validated turn may be spoken. The reference is made here, after every check; the
    # app asks the speech API for audio by it. `None` (speech off, no voice) adds nothing.
    speech = approve_turn(child, route, result.turn, npc_id) if child is not None else None
    if speech:
        body["speech"] = speech
    return Response(body)


class CompanionTurnView(ChildScopedAPIView):
    def post(self, request, child_id):
        _check_size(request)
        body = CompanionTurnRequest(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            return _response(
                request_companion_turn(self.child, body.validated_data),
                self.child,
                "companion",
                body.validated_data.get("npcId"),
            )
        except ContextNotFound:
            raise NotFound from None


class TutorTurnView(ChildScopedAPIView):
    def post(self, request, child_id):
        _check_size(request)
        body = TutorTurnRequest(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            return _response(
                request_tutor_turn(self.child, body.validated_data), self.child, "tutor"
            )
        except ContextNotFound:
            raise NotFound from None
        except SkillNotInStep:
            raise ValidationError({"skillId": "Not an objective of this step."}) from None


# --- Parent transparency and control (LAI-0706, LAI-0707) ---------------------------------------

SAFETY_EVENT_PAGE = 100


def _safety_event(event: SafetyEvent) -> dict:
    """The fields the parent dashboard shows. `actionTaken` keeps Amplify's sentence."""
    return {
        "id": str(event.pk),
        "category": event.category,
        "severity": event.severity,
        "source": event.source,
        "actionTaken": SafetyAction(event.action_taken).label,
        "reviewStatus": event.review_status,
        "createdAt": event.created_at.isoformat(),
    }


class SafetyEventsView(ChildScopedAPIView):
    """GET .../ai/safety-events/: this child's safety events, newest first, metadata only."""

    def get(self, request, child_id):
        events = self.scoped(SafetyEvent.objects.all()).order_by("-created_at")[:SAFETY_EVENT_PAGE]
        return Response({"results": [_safety_event(e) for e in events]})


class AIHistoryView(ChildScopedAPIView):
    """DELETE .../ai/history/: the parent's retention control (Amplify `clearAIHistory`).

    Deletes every audit row and safety event for this child and nothing else: no gameplay,
    progress or story rows. Returns the counts, never the rows.
    """

    def delete(self, request, child_id):
        with transaction.atomic():
            events, _ = self.scoped(SafetyEvent.objects.all()).delete()
            audits, _ = self.scoped(AIInteractionAudit.objects.all()).delete()
        return Response(
            {"deleted": {"safetyEvents": events, "audits": audits}}, status=status.HTTP_200_OK
        )
