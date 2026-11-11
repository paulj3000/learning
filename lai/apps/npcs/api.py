"""Shared API plumbing for NPC views (foundation-owned, contract v1).

`NpcScopedView` resolves the child (404 for another family's child), the scope (a published 3D
Area or an active Place) and the ACTIVE release. The game runtime's cookie is accepted only on
3D Area routes, and only for its own child and region (`GameRuntimeAccessMixin`).
"""

from __future__ import annotations

from dataclasses import dataclass

from rest_framework import exceptions

from apps.catalog.models import Location
from apps.game_sessions import play_state
from apps.game_sessions.runtime_auth import (
    GameRuntimeAccessMixin,
    GameRuntimeGrant,
    GameSessionCookieAuthentication,
)
from apps.users.scoping import ChildScopedAPIView

from . import published


class NpcApiError(exceptions.APIException):
    status_code = 409
    default_detail = "Conflict."


def npc_error(code: str, status: int = 409) -> exceptions.APIException:
    """An API error whose body code is `code` (registered in `apps.core.exceptions._CODED`)."""
    return type(
        f"NpcApiError_{code}", (NpcApiError,), {"default_code": code, "status_code": status}
    )()


@dataclass(frozen=True)
class Scope:
    place: str
    area: str | None  # the 3D Area's region_id, or None for a Place-level route


class NpcScopedView(GameRuntimeAccessMixin, ChildScopedAPIView):
    """Base for every NPC endpoint. Sets `self.child`, `self.scope` (when the route has one)."""

    scope: Scope | None = None

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if isinstance(request.auth, GameRuntimeGrant) and "region_id" not in kwargs:
            raise exceptions.NotFound  # the game cookie is limited to its 3D Area
        if "region_id" in kwargs:
            try:
                region = play_state.published_region(kwargs["region_id"])
            except play_state.RegionNotFound:
                raise npc_error("area_not_found", 404) from None
            self.scope = Scope(place=region.location.slug, area=region.region_id)
        elif "place_slug" in kwargs:
            exists = Location.objects.filter(
                slug=kwargs["place_slug"], active=True, world__active=True
            ).exists()
            if not exists:
                raise npc_error("place_not_found", 404)
            self.scope = Scope(place=kwargs["place_slug"], area=None)

    def release(self) -> published.PublishedRelease:
        try:
            return published.current()
        except published.NoActiveRelease:
            raise npc_error("no_active_release", 404) from None

    def published_character(self, npc_id: str) -> dict:
        """A published character this child may meet in this scope, or 404."""
        release = self.release()
        try:
            character = release.character(npc_id)
        except published.NpcNotPublished:
            raise npc_error("npc_not_found", 404) from None
        if not published.eligible_for(character, self.child.age_band):
            raise npc_error("npc_not_found", 404)
        if self.scope is not None:
            here = release.placements(place=self.scope.place, area=self.scope.area)
            if not any(p["npcId"] == npc_id for p in here):
                raise npc_error("npc_not_found", 404)
        return character


def bearer_only(view_cls: type[NpcScopedView]) -> type[NpcScopedView]:
    """The same view without the game runtime cookie: for routes outside a 3D Area.

    The game cookie is region-scoped (contract section 7, rule 2), so Place and catalog routes
    authenticate with the parent's bearer token only, exactly like any other child-scoped view.
    `NpcScopedView.initial` still refuses a cookie defensively. Only the cookie authentication
    class is removed: without it no request can carry a `GameRuntimeGrant`, so the inherited
    `IsProvisionedParentOrGameRuntime` permission reduces to the provisioned-parent check.
    """
    return type(
        f"BearerOnly{view_cls.__name__}",
        (view_cls,),
        {
            "__module__": view_cls.__module__,
            "authentication_classes": [
                cls
                for cls in view_cls.authentication_classes
                if cls is not GameSessionCookieAuthentication
            ],
        },
    )


class NotImplementedYet(exceptions.APIException):
    status_code = 501
    default_detail = "Not implemented."
    default_code = "not_implemented"
