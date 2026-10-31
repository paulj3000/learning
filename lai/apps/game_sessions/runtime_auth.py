"""The game runtime's credential (LAI-ANDROID-API-001, ADR-036).

The standalone Three.js game in the Android WebView holds no Cognito token. It holds the game
session cookie made by `launch.redeem_ticket`, and this module is the only thing that reads it.

- `GameSessionCookieAuthentication` is never a default authenticator. Only views that mix in
  `GameRuntimeAccessMixin` (the region play routes and the asset resolver) or the runtime's own
  routes list it, so the cookie authenticates nothing else: account, child management, launch,
  progress and inventory routes answer it with 401.
- Writes need CSRF proof: the `X-LAI-Game-CSRF` header (a value only same-origin script can read,
  from `GET /api/v1/game-session/`) and, when the browser sends one, an approved `Origin`. The
  cookie itself is SameSite=Strict and HttpOnly.
- A grant reaches only its own child and region. Any other child, region, session, attempt or
  quest is the same 404 as a record that does not exist.
- A bearer token wins when both are present (it is authenticated first).
"""

import logging
from dataclasses import dataclass
from uuid import UUID

from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed, NotFound, PermissionDenied
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.regions.models import WorldRegion
from apps.users.authentication import CognitoJWTAuthentication
from apps.users.models import ParentAccount
from apps.users.permissions import IsProvisionedParent

from . import launch
from .models import AdventureSession, ChallengeAttempt, GameBrowserSession

logger = logging.getLogger("lai.auth")

CSRF_HEADER = "HTTP_X_LAI_GAME_CSRF"


class GameCsrfFailed(PermissionDenied):
    default_code = "game_csrf_failed"
    default_detail = "This request could not be verified."


@dataclass(frozen=True)
class GameRuntimeGrant:
    """`request.auth` for the game runtime. Never carries the cookie value."""

    session: GameBrowserSession

    @property
    def child_id(self) -> UUID:
        return self.session.child_id

    @property
    def region_id(self) -> str:
        return self.session.region_id


def _origin_allowed(request) -> bool:
    origin = request.META.get("HTTP_ORIGIN")
    if origin is None:
        return True  # not every WebView sends one; the CSRF header is the proof
    own = f"{request.scheme}://{request.get_host()}"
    return origin == own or origin in settings.LAI_GAME_ALLOWED_ORIGINS


class GameSessionCookieAuthentication(BaseAuthentication):
    def authenticate(self, request):
        value = request.COOKIES.get(settings.LAI_GAME_COOKIE_NAME)
        if not value:
            return None
        session = launch.session_for_cookie(value)
        if session is None:
            logger.info("authentication rejected: game_session_invalid")  # reason code only
            raise AuthenticationFailed
        if request.method not in SAFE_METHODS:
            if not _origin_allowed(request) or not launch.csrf_matches(
                session, request.META.get(CSRF_HEADER)
            ):
                logger.info("authentication rejected: game_csrf_failed")
                raise GameCsrfFailed
        return session.parent, GameRuntimeGrant(session)

    def authenticate_header(self, request):
        return "Bearer"


class IsGameRuntime(BasePermission):
    """The runtime's own routes: a live game session cookie, nothing else."""

    def has_permission(self, request, view):
        return isinstance(request.auth, GameRuntimeGrant) and isinstance(
            request.user, ParentAccount
        )


class IsProvisionedParentOrGameRuntime(BasePermission):
    """A bearer-authenticated parent (the default rule), or the game runtime's grant."""

    def has_permission(self, request, view):
        if isinstance(request.auth, GameRuntimeGrant):
            return isinstance(request.user, ParentAccount) and request.user.is_active
        return IsProvisionedParent().has_permission(request, view)


class GameRuntimeAccessMixin:
    """Lets the game runtime call a child-scoped view, only for its own child and region.

    Put it before `ChildScopedAPIView` in the bases. The bearer path is unchanged.
    """

    authentication_classes = [CognitoJWTAuthentication, GameSessionCookieAuthentication]
    permission_classes = [IsProvisionedParentOrGameRuntime]

    def initial(self, request, *args, **kwargs):
        # Resolves self.child for the authenticated account, as every child-scoped view does.
        super().initial(request, *args, **kwargs)
        grant = request.auth
        if isinstance(grant, GameRuntimeGrant) and not self._grant_covers(grant, kwargs):
            raise NotFound

    def _grant_covers(self, grant: GameRuntimeGrant, kwargs) -> bool:
        if self.child.pk != grant.child_id:
            return False
        if "region_id" in kwargs and kwargs["region_id"] != grant.region_id:
            return False
        if "session_id" in kwargs:
            session = (
                AdventureSession.objects.for_child(self.child)
                .filter(pk=kwargs["session_id"])
                .first()
            )
            if session is None or session.region_id != grant.region_id:
                return False
        if "attempt_id" in kwargs:
            attempt = (
                ChallengeAttempt.objects.for_child(self.child)
                .select_related("session")
                .filter(pk=kwargs["attempt_id"])
                .first()
            )
            if attempt is None or attempt.session.region_id != grant.region_id:
                return False
        if "quest_id" in kwargs:
            offered = WorldRegion.objects.filter(
                region_id=grant.region_id, offered_quests__slug=kwargs["quest_id"]
            )
            if not offered.exists():
                return False
        return True
