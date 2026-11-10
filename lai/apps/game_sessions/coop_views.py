"""Household co-op routes (AMP-05). Child-scoped and bearer-only; rules in `coop.py`.

POST /api/v1/children/{child_id}/coop-sessions/
    body: {"adventureSlug": slug, "partnerChildId": uuid}           201: session
GET  /api/v1/children/{child_id}/coop-sessions/{coop_id}/            200: session
POST /api/v1/children/{child_id}/coop-sessions/{coop_id}/slots/
    body: {"slotKey": step id}                         200: {"outcome", "session"}
POST /api/v1/children/{child_id}/coop-sessions/{coop_id}/presence/
    body: {"present": bool}                                          200: session
POST /api/v1/children/{child_id}/coop-sessions/{coop_id}/complete/   200: session

session: {"id", "templateSlug", "templateVersion", "participantChildProfileIds", "status",
          "sharedState": {"slots": {stepId: childId}, "presence": [childId]},
          "startedAt", "lastActivityAt", "completedAt"}

The child in the URL is the one acting (claiming, joining, leaving). A session this parent does
not host, or this child is not in, is the same 404 as an unknown id. Errors: 400
`partner_invalid`, `adventure_invalid`, `slot_invalid`; 409 `coop_session_not_active`.
The GET route is what clients poll for the other child's claims and presence; it replaces the
AppSync `onUpdate` subscription (ADR-026 keeps continuous real-time play on the room server).
"""

from rest_framework import serializers, status
from rest_framework.exceptions import APIException, NotFound
from rest_framework.response import Response

from apps.users.scoping import ChildScopedAPIView

from . import coop
from .serializers import ClosedSerializer


class _BadRequest(APIException):
    status_code = status.HTTP_400_BAD_REQUEST


class PartnerInvalid(_BadRequest):
    default_code = "partner_invalid"
    default_detail = "Choose another one of your children to play with."


class AdventureInvalid(_BadRequest):
    default_code = "adventure_invalid"
    default_detail = "This adventure cannot be shared by these children."


class SlotInvalid(_BadRequest):
    default_code = "slot_invalid"
    default_detail = "That step cannot be shared."


class CoopNotActive(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "coop_session_not_active"
    default_detail = "This shared adventure is no longer active."


_ERRORS = [
    (coop.CoopNotFound, NotFound),
    (coop.PartnerInvalid, PartnerInvalid),
    (coop.AdventureInvalid, AdventureInvalid),
    (coop.SlotInvalid, SlotInvalid),
    (coop.CoopNotActive, CoopNotActive),
]


def _translate(error: coop.CoopError) -> APIException:
    for source, target in _ERRORS:
        if isinstance(error, source):
            return target()
    raise error


class StartRequest(ClosedSerializer):
    adventureSlug = serializers.SlugField(max_length=100)
    partnerChildId = serializers.UUIDField()


class ClaimRequest(ClosedSerializer):
    slotKey = serializers.CharField(max_length=100)


class PresenceRequest(ClosedSerializer):
    present = serializers.BooleanField()


def _body(serializer_class, request):
    body = serializer_class(data=request.data)
    body.is_valid(raise_exception=True)
    return body.validated_data


class CoopSessionListView(ChildScopedAPIView):
    def post(self, request, child_id):
        data = _body(StartRequest, request)
        try:
            session = coop.start(
                request.user,
                self.child,
                adventure_slug=data["adventureSlug"],
                partner_child_id=data["partnerChildId"],
            )
        except coop.CoopError as error:
            raise _translate(error) from None
        return Response(coop.represent(session), status=status.HTTP_201_CREATED)


class CoopSessionView(ChildScopedAPIView):
    def get(self, request, child_id, coop_id):
        try:
            return Response(coop.represent(coop.get(request.user, self.child, coop_id)))
        except coop.CoopError as error:
            raise _translate(error) from None


class CoopSlotView(ChildScopedAPIView):
    def post(self, request, child_id, coop_id):
        data = _body(ClaimRequest, request)
        try:
            result = coop.claim_slot(request.user, self.child, coop_id, data["slotKey"])
        except coop.CoopError as error:
            raise _translate(error) from None
        return Response({"outcome": result.outcome, "session": coop.represent(result.session)})


class CoopPresenceView(ChildScopedAPIView):
    def post(self, request, child_id, coop_id):
        data = _body(PresenceRequest, request)
        try:
            session = coop.set_presence(request.user, self.child, coop_id, data["present"])
        except coop.CoopError as error:
            raise _translate(error) from None
        return Response(coop.represent(session))


class CoopCompleteView(ChildScopedAPIView):
    def post(self, request, child_id, coop_id):
        try:
            session = coop.complete(request.user, self.child, coop_id)
        except coop.CoopError as error:
            raise _translate(error) from None
        return Response(coop.represent(session))
