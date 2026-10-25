import pytest
from django.db import IntegrityError, transaction

from apps.catalog.importer import import_content
from apps.catalog.models import ItemDefinition, RewardRule
from apps.inventory.models import GrantedRule, InventoryItem

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def test_an_item_is_owned_once_and_a_rule_is_granted_once_per_child(families):
    import_content()
    shell = ItemDefinition.objects.get(item_id="spiral-shell")
    rule = RewardRule.objects.first()
    InventoryItem.objects.create(child=families.a1, item=shell)
    InventoryItem.objects.create(child=families.b1, item=shell)
    GrantedRule.objects.create(child=families.a1, rule=rule)
    with pytest.raises(IntegrityError), transaction.atomic():
        InventoryItem.objects.create(child=families.a1, item=shell)
    with pytest.raises(IntegrityError), transaction.atomic():
        GrantedRule.objects.create(child=families.a1, rule=rule)
    assert InventoryItem.objects.for_child(families.b1).count() == 1
