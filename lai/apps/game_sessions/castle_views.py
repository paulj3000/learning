"""Storykeeper Castle room discovery (SC-R03-06): child-scoped, bearer-only.

GET lists the rooms this child has discovered; POST records one. The server decides everything:
which ids it accepts, whether a secret may be recorded, and whether this was the first time. The
body is closed and carries only a room id. See `apps/regions/castle_rooms.py` for the rules and
`docs/PLAY_API.md` for the contract.
"""

from rest_framework import serializers
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.ai.services.castle_director import request_castle_choice
from apps.regions import castle_events, castle_rooms, great_storybook
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


class StorybookView(ChildScopedAPIView):
    """GET this child's Great Storybook (SC-R04-02): pages derived from the server's records.

    Read-only: asking grants, records and changes nothing. See `apps/regions/great_storybook.py`.
    """

    def get(self, request, child_id):
        return Response(great_storybook.progress(self.child))


class DirectorRequest(ClosedSerializer):
    roomId = serializers.SlugField(max_length=64)
    visitId = serializers.UUIDField()


class CastleDirectorView(ChildScopedAPIView):
    """POST the Castle Director's pick of one ambient event for this room (SC-R09-01).

    The client sends only a room id and an opaque visit id. The server recomputes the eligible
    events from this child's own rows, asks the model to pick one id from them (never the other
    way round), and answers with the authored lines of the event that was chosen. A failure of
    any kind is the deterministic default event with `source: "FALLBACK"`, never an error. The
    only write is the display counter. See `apps/regions/castle_events.py` and
    `apps/ai/services/castle_director.py`.
    """

    def post(self, request, child_id):
        body = DirectorRequest(data=request.data)
        body.is_valid(raise_exception=True)
        room_id = body.validated_data["roomId"]
        try:
            castle_events.check_room(self.child, room_id)
        except castle_events.UnknownRoom:
            raise NotFound from None  # the same 404 for an unknown room and an unfound secret

        band = self.child.age_band
        visit = castle_events.register_visit(self.child, body.validated_data["visitId"])
        state = castle_events.build_state(self.child, room_id, visit)
        eligible = castle_events.eligible_events(castle_events.CATALOG, state)
        default = castle_events.default_event(castle_events.CATALOG, state)
        if default is None:
            raise NotFound  # the catalog has no event for this room and band
        source, chosen = "FALLBACK", default
        if eligible:
            result = request_castle_choice(
                self.child,
                room_id=room_id,
                candidates=[{"id": e["id"], "tag": castle_events.tag_for(e)} for e in eligible],
                turns={e["id"]: castle_events.turn_for(e, band) for e in eligible},
                default_turn=castle_events.turn_for(default, band),
            )
            source = result.source
            by_id = {e["id"]: e for e in eligible}
            chosen = by_id.get(result.turn["eventId"], default)
        castle_events.record_shown(self.child, chosen["id"], visit)
        return Response({**castle_events.public_event(chosen, band), "source": source})
