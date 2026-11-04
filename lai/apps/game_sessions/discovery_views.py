"""Discoveries (SC-R04-00): child-scoped, bearer-only. See `apps/progression/discoveries.py`.

GET lists the discovery ids this child has found; POST records one. The server decides whether
it opens, whether this was the first time, and what finding it grants. The body is closed and
carries only a discovery id.
"""

from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.progression import discoveries
from apps.users.scoping import ChildScopedAPIView

from .serializers import ClosedSerializer


class RecordDiscoveryRequest(ClosedSerializer):
    discoveryId = serializers.SlugField(max_length=100)


class DiscoveriesView(ChildScopedAPIView):
    def get(self, request, child_id):
        return Response({"discoveries": discoveries.discovered_ids(self.child)})

    def post(self, request, child_id):
        body = RecordDiscoveryRequest(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            outcome = discoveries.record_discovery(self.child, body.validated_data["discoveryId"])
        except discoveries.UnknownDiscovery:
            raise NotFound from None
        payload = {"discoveryId": outcome.discovery_id, "status": outcome.status}
        if outcome.status == discoveries.LOCKED:
            payload["message"] = outcome.locked_message
        if outcome.status == discoveries.FOUND_NOW:
            payload["rewardMessages"] = list(outcome.reward_messages)
            payload["newItemIds"] = list(outcome.new_item_ids)
        return Response(payload, status=201 if outcome.status == discoveries.FOUND_NOW else 200)
