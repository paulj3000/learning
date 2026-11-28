"""The child session as an API credential (LAI-AUTH-03, ADR-075).

A child who signed in on their own holds one HttpOnly, SameSite=Strict cookie
(`LAI_CHILD_SESSION_COOKIE_NAME`) naming a `ChildPlaySession`. This module is the only thing
that reads it, and it is deny-by-default:

- `ChildSessionAuthentication` is never a default authenticator. `ChildScopedMixin` adds it only
  when the matched route *and method* are on `CHILD_SESSION_ROUTES` below. Every other route
  (account, child management, sign-in management, consent, photo upload, deletion, launches,
  every parent dashboard read) never reads the cookie, so a child session there is simply
  unauthenticated: 401.
- On an allowed route, the child in the URL must be the session's own child. A sibling's id,
  another family's child and an unknown id are the same 404.
- Writes need CSRF proof: the `X-LAI-Child-CSRF` header (an HMAC of the session only
  same-origin script can read from `GET /api/v1/child-auth/session/`) and, when the browser
  sends one, a same-origin `Origin`.
- A child-pool Cognito token is never accepted here or anywhere as a bearer token: the default
  authenticator checks the parent pool's issuer, so it answers 401.
- `request.user` is the child's parent (so `ChildScopedMixin` resolves the child through its
  owner exactly as for a parent) and `request.auth` is a `ChildSessionGrant`. Views on the
  allowlist are reviewed so they act only on `self.child`; `tests/test_child_session_routes.py`
  pins the list, and a route is added only with that review.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from uuid import UUID

from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework.permissions import SAFE_METHODS, BasePermission

from . import child_auth
from .models import ChildPlaySession, ParentAccount

logger = logging.getLogger("lai.auth")

CSRF_HEADER = "HTTP_X_LAI_CHILD_CSRF"
_CHILD = "api/v1/children/<uuid:child_id>/"
_READ = frozenset({"GET", "HEAD", "OPTIONS"})
_PLAY = _READ | {"POST"}

# Child gameplay routes a child session may call, and with which methods. Everything a parent
# controls is absent: profile edits and deletion, photos (upload; the photo itself is LAI 07's
# private-asset review), launches, AI history and safety events, resets (DELETE), audio and
# educational settings writes, co-op sessions (they span siblings; pending LAI 04 review).
# Skill progress stays readable: quest loading and the adaptive adventure entrance need it
# (LAI 06, 2026-11-28); it is the child's own rows, and parent summaries add no other data.
CHILD_SESSION_ROUTES: dict[str, frozenset[str]] = {
    f"{_CHILD}": _READ,  # the child's own profile: nickname, age band, avatar, companion
    f"{_CHILD}companion/": _READ | {"PUT"},  # the child chooses their companion
    f"{_CHILD}avatar/": _READ,
    f"{_CHILD}home/": _READ,
    f"{_CHILD}islands/": _READ,
    f"{_CHILD}regions/": _READ,
    f"{_CHILD}inventory/": _READ,
    f"{_CHILD}progress/": _READ,
    f"{_CHILD}availability/": _READ,
    f"{_CHILD}adventure-actions/": _READ,
    f"{_CHILD}sessions/": _READ,
    f"{_CHILD}sessions/<uuid:session_id>/": _READ,
    f"{_CHILD}sessions/<uuid:session_id>/step/": _READ,
    f"{_CHILD}sessions/<uuid:session_id>/answers/": _PLAY,
    f"{_CHILD}sessions/<uuid:session_id>/hints/": _PLAY,
    f"{_CHILD}sessions/<uuid:session_id>/<slug:action>/": _PLAY,
    f"{_CHILD}sessions/<uuid:session_id>/chests/<slug:entity_id>/challenge/": _PLAY,
    f"{_CHILD}sessions/<uuid:session_id>/puzzles/<slug:puzzle_id>/solve/": _PLAY,
    f"{_CHILD}sessions/<uuid:session_id>/pickups/<slug:entity_id>/": _PLAY,
    f"{_CHILD}sessions/<uuid:session_id>/npcs/<slug:entity_id>/talk/": _PLAY,
    f"{_CHILD}attempts/<uuid:attempt_id>/answer/": _PLAY,
    f"{_CHILD}adventures/<slug:adventure_slug>/session/": _PLAY,
    f"{_CHILD}content/adventures/<slug:slug>/start/": _PLAY,
    f"{_CHILD}regions/<slug:region_id>/": _READ,
    f"{_CHILD}regions/<slug:region_id>/session/": _PLAY,
    f"{_CHILD}regions/<slug:region_id>/adventures/": _READ,
    f"{_CHILD}regions/<slug:region_id>/launch-points/<slug:launch_id>/start/": _PLAY,
    f"{_CHILD}quests/": _READ,
    f"{_CHILD}quests/<slug:quest_slug>/": _READ | {"PUT"},
    f"{_CHILD}quests/<slug:quest_id>/accept/": _PLAY,
    f"{_CHILD}castle/rooms/": _PLAY,
    f"{_CHILD}castle/storybook/": _READ,
    f"{_CHILD}castle/director/": _PLAY,
    f"{_CHILD}discoveries/": _PLAY,
    f"{_CHILD}content/adventures/": _READ,
    f"{_CHILD}content/adventures/<slug:slug>/": _READ,
    f"{_CHILD}content/quests/": _READ,
    f"{_CHILD}content/quests/<slug:slug>/": _READ,
    f"{_CHILD}content/items/": _READ,
    f"{_CHILD}content/reward-rules/": _READ,
    f"{_CHILD}content/learning-objectives/": _READ,
    f"{_CHILD}content/stories/": _READ,
    f"{_CHILD}content/stories/<slug:slug>/": _READ,
    f"{_CHILD}content/npcs/": _READ,
    f"{_CHILD}content/npcs/<slug:slug>/": _READ,
    f"{_CHILD}world-changes/": _PLAY,
    f"{_CHILD}world-state/": _READ | {"PATCH"},
    f"{_CHILD}stories/": _READ,
    f"{_CHILD}stories/<slug:story_slug>/start/": _PLAY,
    f"{_CHILD}stories/<slug:story_slug>/flags/": _PLAY,
    f"{_CHILD}stories/<slug:story_slug>/chapters/<slug:chapter_id>/complete/": _PLAY,
    f"{_CHILD}stories/<slug:story_slug>/reflections/": _PLAY,
    f"{_CHILD}npc-memory/": _READ,
    f"{_CHILD}npc-memory/<slug:npc_id>/dialogue/": _PLAY,
    f"{_CHILD}story-artifacts/": _PLAY,
    f"{_CHILD}story-artifacts/written/": _PLAY,
    f"{_CHILD}skill-progress/": _READ,
    f"{_CHILD}next-learning-activity/": _READ,
    f"{_CHILD}rewards/": _READ,
    f"{_CHILD}scoring/": _READ,
    f"{_CHILD}scoring/awards/": _READ,
    f"{_CHILD}assets/": _READ,
    f"{_CHILD}audio/settings/": _READ,
    f"{_CHILD}audio/manifests/islands/<slug:identifier>/": _READ,
    f"{_CHILD}audio/manifests/places/<slug:identifier>/": _READ,
    f"{_CHILD}audio/manifests/regions/<slug:identifier>/": _READ,
    # Speech and AI turns check the parent's per-child AI and voice settings themselves.
    f"{_CHILD}audio/speech/": _PLAY,
    f"{_CHILD}ai/companion-turns/": _PLAY,
    f"{_CHILD}ai/tutor-turns/": _PLAY,
    f"{_CHILD}npcs/": _READ,
    f"{_CHILD}regions/<slug:region_id>/npcs/": _READ,
    f"{_CHILD}places/<slug:place_slug>/npcs/": _READ,
    f"{_CHILD}regions/<slug:region_id>/npcs/<slug:npc_id>/interactions/": _PLAY,
    f"{_CHILD}regions/<slug:region_id>/npcs/<slug:npc_id>/interactions/"
    "<uuid:conversation_id>/<str:verb>/": _PLAY,
    f"{_CHILD}places/<slug:place_slug>/npcs/<slug:npc_id>/interactions/": _PLAY,
    f"{_CHILD}places/<slug:place_slug>/npcs/<slug:npc_id>/interactions/"
    "<uuid:conversation_id>/<str:verb>/": _PLAY,
}


def _route_of(request) -> str | None:
    match = getattr(request, "resolver_match", None)
    route = getattr(match, "route", None)
    return route if isinstance(route, str) else None


def _normalized(route: str) -> str:
    """NPC interaction verbs are separate literal routes; they share one allowlist entry."""
    for verb in ("choose", "advance", "end", "hint"):
        suffix = f"<uuid:conversation_id>/{verb}/"
        if route.endswith(suffix):
            return route[: -len(suffix)] + "<uuid:conversation_id>/<str:verb>/"
    return route


def child_session_allowed(request) -> bool:
    """True only for an allowlisted route with an allowlisted method."""
    route = _route_of(request)
    if route is None:
        return False
    methods = CHILD_SESSION_ROUTES.get(_normalized(route))
    return methods is not None and request.method in methods


@dataclass(frozen=True)
class ChildSessionGrant:
    """`request.auth` for a child session. Never carries the cookie value."""

    session: ChildPlaySession

    @property
    def child_id(self) -> UUID:
        return self.session.child_id


def grant_of(request) -> ChildSessionGrant | None:
    """The child-session grant of an authenticated DRF request, or None (never authenticates)."""
    grant = getattr(request, "auth", None)  # a DRF Request has authenticated by now
    return grant if isinstance(grant, ChildSessionGrant) else None


class ChildCsrfFailed(PermissionDenied):
    default_code = "child_csrf_failed"
    default_detail = "This request could not be verified."


def origin_allowed(request) -> bool:
    origin = request.META.get("HTTP_ORIGIN")
    if origin is None:
        return True  # same-origin fetches may omit it; the CSRF header is the proof
    return origin == f"{request.scheme}://{request.get_host()}"


class ChildSessionAuthentication(BaseAuthentication):
    def authenticate(self, request):
        value = request.COOKIES.get(settings.LAI_CHILD_SESSION_COOKIE_NAME)
        if not value:
            return None
        session = child_auth.session_for_value(value)
        if session is None:
            logger.info("authentication rejected: child_session_invalid")  # reason code only
            raise AuthenticationFailed
        if request.method not in SAFE_METHODS:
            if not origin_allowed(request) or not child_auth.session_csrf_matches(
                session, request.META.get(CSRF_HEADER)
            ):
                logger.info("authentication rejected: child_csrf_failed")
                raise ChildCsrfFailed
        return session.child.parent, ChildSessionGrant(session)

    def authenticate_header(self, request):
        return "Bearer"


class IsChildSession(BasePermission):
    """A live child session on an allowlisted route and method. Nothing else."""

    def has_permission(self, request, view):
        return (
            isinstance(request.auth, ChildSessionGrant)
            and isinstance(request.user, ParentAccount)
            and request.user.is_active
            and child_session_allowed(request)
        )
