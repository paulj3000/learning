"""A child's backpack as the client's reward engine reads it (AMP-03). Child-scoped (LAI-0403).

GET    children/{id}/rewards/   {"ownedItemIds": [...], "grantedRuleIds": [...]}
DELETE children/{id}/rewards/   a parent clears the backpack (items and granted rules)

There is no write route: rewards are granted only by server code that has just decided the child
earned them (a chest, a pickup, a discovery, a finished quest), through
`services.grant_reward_rule`, once per rule and child. The item list with names is
`inventory/` (LAI-ANDROID-API-001).
"""

from django.db import transaction
from rest_framework.response import Response

from apps.users.scoping import ChildScopedAPIView

from .models import GrantedRule, InventoryItem


class RewardsView(ChildScopedAPIView):
    def get(self, request, child_id):
        items = self.scoped(InventoryItem.objects).order_by("acquired_at", "item__item_id")
        rules = self.scoped(GrantedRule.objects).order_by("granted_at", "rule__rule_id")
        return Response(
            {
                "ownedItemIds": list(items.values_list("item__item_id", flat=True)),
                "grantedRuleIds": list(rules.values_list("rule__rule_id", flat=True)),
            }
        )

    def delete(self, request, child_id):
        with transaction.atomic():
            self.scoped(InventoryItem.objects).delete()
            self.scoped(GrantedRule.objects).delete()
        return Response(status=204)
