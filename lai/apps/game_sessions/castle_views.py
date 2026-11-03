"""Storykeeper Castle room discovery (SC-R03-06): child-scoped, bearer-only.

GET lists the rooms this child has discovered; POST records one. The server decides everything:
which ids it accepts, whether a secret may be recorded, and whether this was the first time. The
body is closed and carries only a room id. See `apps/regions/castle_rooms.py` for the rules and
`docs/PLAY_API.md` for the contract.
"""

from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.regions import castle_rooms
from apps.users.scoping import ChildScopedAPIView

from .serializers import ClosedSerializer


class DiscoverRoomRequest(ClosedSerializer):
    roomId = serializers.SlugField(max_length=64)


class CastleRoomsView(ChildScopedAPIView):
    def get(self, request, child_id):
        return Response({"rooms": castle_rooms.discovered_rooms(self.child)})

    def post(self, request, child_id):
        body = DiscoverRoomRequest(data=request.data)
        body.is_valid(raise_exception=True)
        room_id = body.validated_data["roomId"]
        try:
            created = castle_rooms.discover_room(self.child, room_id)
        except castle_rooms.UnknownRoom:
            # The same 404 for an unknown room and for a secret not yet found.
            raise NotFound from None
        return Response(
            {"roomId": room_id, "newlyDiscovered": created}, status=201 if created else 200
        )
