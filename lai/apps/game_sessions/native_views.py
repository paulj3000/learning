"""Native selection screens (LAI-ANDROID-API-001): home, regions, adventures, inventory.

Read-only, child-scoped (`ChildScopedAPIView`, LAI-0403), bearer-only: the game runtime's
cookie cannot reach these. Read models are `discovery.py`; the contract is
docs/android/ANDROID_API_CONTRACT.md. Region progress and the play routes stay in
`play_views.py` (TR-5), unchanged.
"""

from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.catalog.models import ContentRelease, Quest
from apps.inventory.models import InventoryItem
from apps.users.scoping import ChildScopedAPIView

from . import discovery
from .serializers import (
    HomeSerializer,
    InventoryEntrySerializer,
    adventure_entry,
    quest_status_entry,
    region_entry,
)

MAX_INVENTORY = 500


class ChildHomeView(ChildScopedAPIView):
    def get(self, request, child_id):
        return Response(HomeSerializer().to_representation(discovery.child_home(self.child)))


class RegionListView(ChildScopedAPIView):
    def get(self, request, child_id):
        entries = discovery.region_entries(self.child, discovery.visible_regions(self.child))
        return Response({"regions": [region_entry(e) for e in entries]})


class RegionAdventuresView(ChildScopedAPIView):
    def get(self, request, child_id, region_id):
        try:
            region = discovery.visible_region(self.child, region_id)
        except discovery.RegionNotVisible:
            raise NotFound from None
        [entry] = discovery.region_entries(self.child, [region])
        return Response(
            {
                "region": region_entry(entry),
                "adventures": [
                    adventure_entry(e)
                    for e in discovery.adventure_entries(self.child, region.location)
                ],
                "quests": [
                    quest_status_entry(e) for e in discovery.region_quests(self.child, region)
                ],
            }
        )


class InventoryView(ChildScopedAPIView):
    def get(self, request, child_id):
        items = (
            self.scoped(InventoryItem.objects.select_related("item"))
            .order_by("-acquired_at", "item__item_id")[: MAX_INVENTORY + 1]
        )
        rows = list(items)
        return Response(
            {
                "items": InventoryEntrySerializer(rows[:MAX_INVENTORY], many=True).data,
                "truncated": len(rows) > MAX_INVENTORY,
            }
        )


# --- Quests (LAI-0605) ------------------------------------------------------------------------


def _visible_quests(child):
    """Active quests in the latest content release for this child's age band."""
    release = ContentRelease.objects.order_by("-imported_at", "-id").first()
    quests = Quest.objects.filter(active=True, last_seen_release=release).order_by(
        "sort_order", "slug"
    )
    return [quest for quest in quests if child.age_band in quest.age_bands]


class QuestListView(ChildScopedAPIView):
    """GET: every quest this child can see, with status (LOCKED, AVAILABLE, ACTIVE, COMPLETED)."""

    def get(self, request, child_id):
        entries = discovery.quest_status_entries(self.child, _visible_quests(self.child))
        return Response({"quests": [quest_status_entry(e) for e in entries]})


class QuestDetailView(ChildScopedAPIView):
    """GET: one quest with its stages and objective progress. 404 when not visible."""

    def get(self, request, child_id, quest_id):
        quest = next((q for q in _visible_quests(self.child) if q.slug == quest_id), None)
        if quest is None:
            raise NotFound
        [entry] = discovery.quest_status_entries(self.child, [quest])
        return Response(quest_status_entry(entry))
