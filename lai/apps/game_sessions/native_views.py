"""Native selection screens (LAI-ANDROID-API-001): home, regions, adventures, inventory.

Read-only, child-scoped (`ChildScopedAPIView`, LAI-0403), bearer-only: the game runtime's
cookie cannot reach these. Read models are `discovery.py`; the contract is
docs/android/ANDROID_API_CONTRACT.md. Region progress and the play routes stay in
`play_views.py` (TR-5), unchanged.
"""

from rest_framework import exceptions
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.inventory.models import InventoryItem
from apps.users.scoping import ChildScopedAPIView

from . import adventure_launch, discovery
from .serializers import (
    EmptyRequest,
    HomeSerializer,
    InventoryEntrySerializer,
    adventure_entry,
    island_entry,
    quest_status_entry,
    region_entry,
)
from .views import session_state

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
        items = self.scoped(InventoryItem.objects.select_related("item")).order_by(
            "-acquired_at", "item__item_id"
        )[: MAX_INVENTORY + 1]
        rows = list(items)
        return Response(
            {
                "items": InventoryEntrySerializer(rows[:MAX_INVENTORY], many=True).data,
                "truncated": len(rows) > MAX_INVENTORY,
            }
        )


class IslandListView(ChildScopedAPIView):
    """GET Island > Place > 3D Area for this child (ADR-041). `autoSelectIslandId` is set when
    exactly one Island is available, so the client can skip the Island choice."""

    def get(self, request, child_id):
        islands = [island_entry(e) for e in discovery.child_islands(self.child)]
        return Response(
            {
                "islands": islands,
                "autoSelectIslandId": islands[0]["islandId"] if len(islands) == 1 else None,
            }
        )


class AdventureUnavailable(exceptions.APIException):
    status_code = 409
    default_code = "content_unavailable"
    default_detail = "This is not available right now."


class LaunchPointStartView(ChildScopedAPIView):
    """POST: start or resume the Adventure an object in the 3D Area offers (201 new, 200 resumed).

    Bearer only (the game runtime cookie does not reach it). The client names the launch point;
    the server decides whether this child may start its Adventure (`adventure_launch`).
    """

    def post(self, request, child_id, region_id, launch_id):
        EmptyRequest(data=request.data or {}).is_valid(raise_exception=True)
        try:
            session, created, point = adventure_launch.start_from_launch_point(
                self.child, region_id, launch_id
            )
        except adventure_launch.LaunchPointNotFound:
            raise NotFound from None
        except adventure_launch.AdventureNotAvailable:
            raise AdventureUnavailable from None
        adventure = point.adventure
        return Response(
            {
                "launchId": point.launch_id,
                "regionId": point.region.region_id,
                "adventureId": adventure.slug,
                "placeSlug": adventure.location.slug,
                "session": session_state(session),
                "returnTo": {"regionId": point.region.region_id},
            },
            status=201 if created else 200,
        )
