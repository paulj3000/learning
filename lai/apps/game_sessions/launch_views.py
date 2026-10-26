"""Game-only WebView launch routes (LAI-ANDROID-API-001, ADR-036). Thin views over `launch.py`.

Native app (bearer token):
    POST /api/v1/children/{child_id}/game-launches/   {"regionId"}  -> 201 ticket
    POST /api/v1/game-launches/redeem/                {"ticket"}    -> 201 + game session cookie
    POST /api/v1/game-launches/revoke/                {}            -> 200, every game session ends
Game runtime (game session cookie; writes need `X-LAI-Game-CSRF`):
    GET  /api/v1/game-session/                                      -> launch context
    POST /api/v1/game-session/end/                    {}            -> 200, this session ends

Flow, cookie attributes and threat model: docs/android/ANDROID_GAME_LAUNCH.md.
"""

from django.conf import settings
from rest_framework import exceptions
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from apps.users.scoping import ChildScopedAPIView

from . import discovery, launch
from .runtime_auth import GameRuntimeGrant, GameSessionCookieAuthentication, IsGameRuntime
from .serializers import EmptyRequest, LaunchRequest, RedeemRequest

REDEEM_PATH = "/api/v1/game-launches/redeem/"
RUNTIME_SESSION_PATH = "/api/v1/game-session/"


class GameLaunchThrottle(UserRateThrottle):
    scope = "game_launch"


class _Conflict(exceptions.APIException):
    status_code = 409


class ChildInactive(_Conflict):
    default_code = "child_inactive"


class TicketInvalid(_Conflict):
    default_code = "launch_ticket_invalid"


def _iso(value) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _no_store(response: Response) -> Response:
    response["Cache-Control"] = "no-store"
    return response


def _set_game_cookie(response: Response, value: str, max_age: int) -> None:
    response.set_cookie(
        settings.LAI_GAME_COOKIE_NAME,
        value,
        max_age=max_age,
        path=settings.LAI_GAME_COOKIE_PATH,
        secure=settings.LAI_GAME_COOKIE_SECURE,
        httponly=True,
        samesite="Strict",
    )


def _clear_game_cookie(response: Response) -> None:
    response.delete_cookie(
        settings.LAI_GAME_COOKIE_NAME, path=settings.LAI_GAME_COOKIE_PATH, samesite="Strict"
    )


class GameLaunchView(ChildScopedAPIView):
    throttle_classes = [GameLaunchThrottle]

    def post(self, request, child_id):
        body = LaunchRequest(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            ticket, row = launch.create_launch(
                request.user, self.child, body.validated_data["regionId"]
            )
        except launch.ChildInactive:
            raise ChildInactive from None
        except discovery.RegionNotVisible:
            raise exceptions.NotFound from None
        return _no_store(
            Response(
                {
                    "ticket": ticket,
                    "expiresAt": _iso(row.expires_at),
                    "childId": str(self.child.pk),
                    "regionId": row.region_id,
                    "redeemUrl": REDEEM_PATH,
                    "gameUrl": settings.LAI_GAME_ENTRY_URL,
                },
                status=201,
            )
        )


class GameLaunchRedeemView(APIView):
    """Bearer-only and parent-scoped: the ticket must be this parent's own."""

    throttle_classes = [GameLaunchThrottle]

    def post(self, request):
        body = RedeemRequest(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            value, session = launch.redeem_ticket(request.user, body.validated_data["ticket"])
        except launch.TicketInvalid:
            raise TicketInvalid from None
        response = Response(
            {
                "childId": str(session.child_id),
                "regionId": session.region_id,
                "expiresAt": _iso(session.expires_at),
                "gameUrl": settings.LAI_GAME_ENTRY_URL,
                "cookie": {
                    "name": settings.LAI_GAME_COOKIE_NAME,
                    "path": settings.LAI_GAME_COOKIE_PATH,
                },
            },
            status=201,
        )
        _set_game_cookie(response, value, settings.LAI_GAME_SESSION_TTL_SECONDS)
        return _no_store(response)


class GameLaunchRevokeView(APIView):
    """Native sign-out or exit: ends every game session of this parent and voids unused tickets."""

    def post(self, request):
        EmptyRequest(data=request.data or {}).is_valid(raise_exception=True)
        revoked = launch.revoke_all(request.user)
        response = Response({"revokedSessions": revoked})
        _clear_game_cookie(response)
        return _no_store(response)


class GameRuntimeSessionView(APIView):
    """What the runtime may know about its launch. No nickname, no parent id, no token."""

    authentication_classes = [GameSessionCookieAuthentication]
    permission_classes = [IsGameRuntime]

    def get(self, request):
        grant: GameRuntimeGrant = request.auth
        session = grant.session
        child = session.child
        base = f"/api/v1/children/{child.pk}/"
        return _no_store(
            Response(
                {
                    "childId": str(child.pk),
                    "regionId": session.region_id,
                    "ageBand": child.age_band,
                    "readingMode": child.reading_mode,
                    "sessionMinutes": child.session_minutes,
                    "aiEnabled": child.ai_enabled,
                    "expiresAt": _iso(session.expires_at),
                    "csrfHeader": "X-LAI-Game-CSRF",
                    "csrfToken": launch.csrf_token(session),
                    "endpoints": {
                        "region": f"{base}regions/{session.region_id}/",
                        "startSession": f"{base}regions/{session.region_id}/session/",
                        "session": f"{base}sessions/{{sessionId}}/",
                        "sessionAction": f"{base}sessions/{{sessionId}}/{{action}}/",
                        "chestChallenge": f"{base}sessions/{{sessionId}}/chests/{{entityId}}/"
                        "challenge/",
                        "attemptAnswer": f"{base}attempts/{{attemptId}}/answer/",
                        "questAccept": f"{base}quests/{{questId}}/accept/",
                        "assets": f"{base}assets/",
                        "end": "/api/v1/game-session/end/",
                    },
                }
            )
        )


class GameRuntimeEndView(APIView):
    authentication_classes = [GameSessionCookieAuthentication]
    permission_classes = [IsGameRuntime]

    def post(self, request):
        EmptyRequest(data=request.data or {}).is_valid(raise_exception=True)
        launch.revoke_session(request.auth.session)
        response = Response({"ended": True})
        _clear_game_cookie(response)
        return _no_store(response)
