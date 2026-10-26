"""Reward history (LAI-0604). Child-scoped, bearer only, read-only (LAI-0403).

GET /api/v1/children/{child_id}/rewards/
    200: {"rewards": [grant, ...]}, every reward rule that has fired for this child, newest
         first.
GET /api/v1/children/{child_id}/rewards/{grant_id}/
    200: one grant; 404 for an unknown id or another child's.

There is no write route: rewards are granted only by server code after a graded gameplay
outcome (`apps.inventory.services`). The backpack itself is `GET inventory/` (native API).
"""

from rest_framework.response import Response

from apps.users.scoping import ChildScopedAPIView

from .models import GrantedRule
from .serializers import grant_body


def history_entry(grant) -> dict:
    body = grant_body(grant, newly_granted=False)
    del body["newlyGranted"]  # meaningful only on the response of the event that granted it
    body["sourceSessionId"] = str(grant.source_session_id) if grant.source_session_id else None
    return body


class RewardHistoryView(ChildScopedAPIView):
    def get(self, request, child_id):
        grants = (
            self.scoped(GrantedRule.objects.select_related("rule"))
            .prefetch_related("rule__items")
            .order_by("-granted_at", "rule__rule_id")
        )
        return Response({"rewards": [history_entry(grant) for grant in grants]})


class RewardDetailView(ChildScopedAPIView):
    def get(self, request, child_id, grant_id):
        grant = self.get_scoped_object(GrantedRule.objects.select_related("rule"), grant_id)
        return Response(history_entry(grant))
