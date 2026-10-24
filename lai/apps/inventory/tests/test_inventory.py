import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.inventory.models import GrantedRule, InventoryItem

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def test_an_item_is_owned_once_and_a_rule_is_granted_once_per_child(families):
    now = timezone.now()
    InventoryItem.objects.create(child=families.a1, item_id="spiral-shell", acquired_at=now)
    InventoryItem.objects.create(child=families.b1, item_id="spiral-shell", acquired_at=now)
    GrantedRule.objects.create(child=families.a1, rule_id="bridge-shell", granted_at=now)
    with pytest.raises(IntegrityError), transaction.atomic():
        InventoryItem.objects.create(child=families.a1, item_id="spiral-shell", acquired_at=now)
    with pytest.raises(IntegrityError), transaction.atomic():
        GrantedRule.objects.create(child=families.a1, rule_id="bridge-shell", granted_at=now)
    assert InventoryItem.objects.for_child(families.b1).count() == 1
