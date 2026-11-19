"""Scoring API (GE-104). Child-scoped and bearer-only (`ChildScopedAPIView`, LAI-0403).

GET    children/{id}/scoring/          summary (enabled: false when scoring is off)
GET    children/{id}/scoring/awards/   ledger feed after ?after=<entry id>, for confirming
                                       pending notifications
DELETE children/{id}/scoring/          a parent's privacy erasure of the scoring record

There is no write route. Awards are derived by Django from its own records (`reconcile.py`);
a client can never send an amount, a currency, a total or an award.
"""

import uuid

from rest_framework.exceptions import APIException
from rest_framework.response import Response

from apps.users.scoping import ChildScopedAPIView

from . import ledger, policies, projections
from .models import AwardLedgerEntry


class InvalidCursor(APIException):
    status_code = 400
    default_code = "invalid_cursor"
    default_detail = "That cursor is not accepted."


class ScoringSummaryView(ChildScopedAPIView):
    def get(self, request, child_id):
        return Response(projections.summary(self.child))

    def delete(self, request, child_id):
        ledger.erase_child_scoring(self.child)
        return Response(status=204)


class AwardFeedView(ChildScopedAPIView):
    def get(self, request, child_id):
        if policies.awarding_policy() is None:
            return Response({"awards": [], "cursor": None, "hasMore": False})
        after = None
        raw = request.query_params.get("after")
        if raw:
            try:
                entry_id = uuid.UUID(raw)
            except ValueError:
                raise InvalidCursor from None
            # Only this child's own entry is a cursor; anyone else's is as unknown as a typo.
            after = self.scoped(AwardLedgerEntry.objects).filter(pk=entry_id).first()
            if after is None:
                raise InvalidCursor
        return Response(projections.award_feed(self.child, after))
