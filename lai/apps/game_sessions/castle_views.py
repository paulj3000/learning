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
from apps.npcs import castle_flavour
from apps.regions import castle_events, castle_rooms, great_storybook
from apps.regions.models import CastleEventShown
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
    only write is the display counter. The events are Django's revisioned catalog (ADR-065). See
    `apps/regions/castle_events.py` and
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
        events = castle_events.catalog()  # approved, published, active events only (ADR-065)
        eligible = castle_events.eligible_events(events, state)
        default = castle_events.default_event(events, state)
        if default is None:
            # No approved event for this room and band: the client shows its own quiet line.
            raise NotFound
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


class FlavourRequest(ClosedSerializer):
    eventId = serializers.SlugField(max_length=100)


class CastleFlavourView(ChildScopedAPIView):
    """POST Keeper Quill's flavour line for an ambient event this child was just shown.

    The body is closed and carries only an event id. The server decides everything: the event must
    be an approved, active catalog event that suits this child's band, Quill's, and one the
    Director already showed this child (a display counter row exists). The answer is the line the
    shared `npc_hint` route re-voiced through Quill's published persona (`source: "AI"`) or the
    authored line (`source: "FALLBACK"`) on AI off, kill switch, no persona, rate limit, provider
    failure or any failed safety check. The only writes are the pipeline's own audit, safety and
    usage rows: no flag, relationship, world change or progress. See
    `apps/npcs/castle_flavour.py`.
    """

    def post(self, request, child_id):
        body = FlavourRequest(data=request.data)
        body.is_valid(raise_exception=True)
        event_id = body.validated_data["eventId"]
        event = next((e for e in castle_events.catalog() if e["id"] == event_id), None)
        shown = CastleEventShown.objects.for_child(self.child).filter(
            event_id=event_id
        )
        if (
            event is None
            or event.get("npcId") != castle_flavour.QUILL
            or self.child.age_band not in event["bands"]
            or not shown.exists()
        ):
            raise NotFound  # one 404 for unknown, other NPC, wrong band, never shown
        hint = castle_flavour.quill_flavour(self.child, event)
        return Response({"eventId": event_id, "line": hint.text, "source": hint.source})
