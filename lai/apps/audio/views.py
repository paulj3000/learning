"""The audio manifest API (SM-P2-06). Read-only: there is no write route.

`GET /api/v1/children/<child_id>/audio/manifests/{islands|places|regions}/<id>/`

Child-scoped like every play route (the caller is the parent of that child, or the game runtime
for its own child), so the existing authorization rules apply unchanged. Only active Islands and
Places and published 3D Areas have a manifest. The response never carries a URL, an unpublished
sound, a draft, or anything about who edited what.
"""

from django.http import HttpResponseNotModified
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.catalog.models import Location, World
from apps.core.content_status import ContentStatus
from apps.game_sessions.runtime_auth import GameRuntimeAccessMixin
from apps.regions.models import WorldRegion
from apps.users.scoping import ChildScopedAPIView

from .manifest import SCOPE_NAMES, build_manifest
from .vocabulary import Scope

GLOBAL = (Scope.GLOBAL, None)


class ManifestView(GameRuntimeAccessMixin, ChildScopedAPIView):
    """Subclasses say how to find the scope and its ancestry."""

    scope_kind = ""

    def chain(self, identifier: str) -> list[tuple[str, str | None]]:
        raise NotImplementedError

    def get(self, request, child_id, identifier):
        manifest = build_manifest(self.scope_kind, identifier, self.chain(identifier))
        etag = f'"{manifest["revision"]}"'
        if request.headers.get("If-None-Match") == etag:
            response = HttpResponseNotModified()
        else:
            response = Response(manifest)
        response["ETag"] = etag
        # Revalidate every time: the revision is cheap and a stale copy would outlive a rollback.
        response["Cache-Control"] = "private, no-cache"
        return response


class IslandManifestView(ManifestView):
    scope_kind = SCOPE_NAMES[Scope.ISLAND]

    def chain(self, identifier):
        if not World.objects.filter(slug=identifier, active=True).exists():
            raise NotFound
        return [GLOBAL, (Scope.ISLAND, identifier)]


class PlaceManifestView(ManifestView):
    scope_kind = SCOPE_NAMES[Scope.PLACE]

    def chain(self, identifier):
        place = (
            Location.objects.select_related("world").filter(slug=identifier, active=True).first()
        )
        if place is None or not place.world.active:
            raise NotFound
        return [GLOBAL, (Scope.ISLAND, place.world.slug), (Scope.PLACE, identifier)]


class RegionManifestView(ManifestView):
    scope_kind = SCOPE_NAMES[Scope.AREA]

    def chain(self, identifier):
        region = (
            WorldRegion.objects.select_related("location__world")
            .filter(region_id=identifier, status=ContentStatus.PUBLISHED, location__active=True)
            .first()
        )
        if region is None or not region.location.world.active:
            raise NotFound
        place = region.location
        return [
            GLOBAL,
            (Scope.ISLAND, place.world.slug),
            (Scope.PLACE, place.slug),
            (Scope.AREA, identifier),
        ]
