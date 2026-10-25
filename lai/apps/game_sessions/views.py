"""The play API (TR-5): thin views over `services.py` (writes) and `play_state.py` (reads).

Every route is child-scoped (`ChildScopedAPIView`, LAI-0403): the child comes from the URL and is
resolved through the authenticated parent, and every nested record is looked up *with* that
child, so another child's session or attempt is the same 404 as one that does not exist.
No view grades, grants, or records anything itself.
"""

from rest_framework import exceptions
from rest_framework.response import Response

from apps.education.challenges import InvalidAnswer
from apps.islands.models import TreasureChest
from apps.quests.services import QuestUnavailable, start_quest
from apps.users.scoping import ChildScopedAPIView

from . import play_state, services
from .serializers import (
    AnswerRequest,
    BootstrapSerializer,
    ChallengeResponseSerializer,
    EmptyRequest,
    ItemSerializer,
    OutcomeSerializer,
    ProgressSerializer,
    QuestEntrySerializer,
    SessionSerializer,
)


class PlayConflict(exceptions.APIException):
    status_code = 409
    default_detail = "Conflict."


def _conflict(code: str) -> exceptions.APIException:
    # The error handler takes the code from the class, so each code gets its own class.
    return type(f"PlayConflict_{code}", (PlayConflict,), {"default_code": code})()


def api_error(error: Exception) -> exceptions.APIException:
    if isinstance(error, services.AttemptNotFound | services.SessionNotFound | LookupError):
        return exceptions.NotFound()
    if isinstance(error, QuestUnavailable):
        return _conflict("quest_unavailable")
    if isinstance(error, services.PlayError):
        return _conflict(error.code)
    raise error


def _empty_body(request) -> None:
    EmptyRequest(data=request.data or {}).is_valid(raise_exception=True)


def _status(created: bool) -> int:
    return 201 if created else 200


class RegionView(ChildScopedAPIView):
    """GET: everything the client needs to build the region for this child."""

    def get(self, request, child_id, region_id):
        try:
            region = play_state.published_region(region_id)
        except play_state.RegionNotFound as error:
            raise api_error(error) from None
        state = play_state.region_bootstrap(self.child, region)
        return Response(BootstrapSerializer().to_representation(state))


class RegionSessionView(ChildScopedAPIView):
    """POST: start or resume this child's session in the region (201 new, 200 resumed)."""

    def post(self, request, child_id, region_id):
        _empty_body(request)
        try:
            region = play_state.published_region(region_id)
            session, created = services.start_or_resume_region_session(self.child, region)
        except (play_state.RegionNotFound, services.PlayError) as error:
            raise api_error(error) from None
        return Response(SessionSerializer(session).data, status=_status(created))


class SessionView(ChildScopedAPIView):
    def get(self, request, child_id, session_id):
        try:
            session = services.get_child_session(self.child, session_id)
        except services.PlayError as error:
            raise api_error(error) from None
        return Response(SessionSerializer(session).data)


class SessionActionView(ChildScopedAPIView):
    """POST pause | resume | complete | abandon. Repeating the current state is a no-op."""

    def post(self, request, child_id, session_id, action):
        _empty_body(request)
        try:
            session = services.change_session_status(self.child, session_id, action)
        except services.PlayError as error:
            raise api_error(error) from None
        return Response(SessionSerializer(session).data)


class ChestChallengeView(ChildScopedAPIView):
    """POST: the challenge for a chest (201 new, 200 the one already outstanding)."""

    def post(self, request, child_id, session_id, entity_id):
        _empty_body(request)
        try:
            session = services.get_child_session(self.child, session_id)
            chest = (
                TreasureChest.objects.select_related("region__location")
                .filter(region__region_id=session.region_id, entity_id=entity_id)
                .first()
            )
            if chest is None:
                raise exceptions.NotFound
            attempt, created = services.issue_chest_challenge(session, chest)
        except services.PlayError as error:
            raise api_error(error) from None
        return Response(
            ChallengeResponseSerializer().to_representation(attempt), status=_status(created)
        )


class AttemptAnswerView(ChildScopedAPIView):
    """POST {answer, hintLevel?, durationMs?}: graded on the server, never by the client."""

    def post(self, request, child_id, attempt_id):
        body = AnswerRequest(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            outcome = services.submit_chest_answer(
                self.child,
                attempt_id,
                body.validated_data["answer"],
                hint_level=body.validated_data["hint_level"],
                duration_ms=body.validated_data.get("duration_ms"),
            )
        except InvalidAnswer:
            raise exceptions.ValidationError(
                {"answer": [exceptions.ErrorDetail("Not a possible answer.", "invalid_answer")]}
            ) from None
        except services.PlayError as error:
            raise api_error(error) from None
        context = {}
        if outcome.reward and outcome.reward.granted:
            chest = outcome.attempt.chest
            rule = chest.reward_rule if chest else None
            if rule is not None:
                context = {
                    "items": ItemSerializer(rule.items.order_by("item_id"), many=True).data,
                    "reward_message": rule.message,
                }
        return Response(OutcomeSerializer(context=context).to_representation(outcome))


class QuestAcceptView(ChildScopedAPIView):
    """POST: the child accepts a quest (201 accepted, 200 already accepted or finished)."""

    def post(self, request, child_id, quest_id):
        _empty_body(request)
        try:
            quest = play_state.published_quest(quest_id)
            progress, created = start_quest(self.child, quest)
        except (LookupError, QuestUnavailable) as error:
            raise api_error(error) from None
        [entry] = play_state.quest_entries(self.child, [quest])
        return Response(
            QuestEntrySerializer().to_representation(entry), status=_status(created)
        )


class ProgressView(ChildScopedAPIView):
    """GET: the child's sessions, world changes, chests, inventory, quests, and practice."""

    def get(self, request, child_id):
        return Response(ProgressSerializer().to_representation(play_state.child_progress(self.child)))
