"""Runtime read API (workstream B, LAI-NPC-007).

Contract: docs/NPC_MANAGER_CONTRACTS.md section 5.1. Every route is child-scoped
(`NpcScopedView`); only the 3D Area route accepts the game runtime's cookie. Content comes only
from the ACTIVE release. With no active release these reads answer `200` with an empty scene or
catalog and `release: 0` (QA finding F-A); interaction routes still answer
`404 no_active_release`.
"""

from rest_framework.response import Response

from . import published, runtime
from .api import NpcScopedView


def _active_release() -> published.PublishedRelease | None:
    try:
        return published.current()
    except published.NoActiveRelease:
        return None


class NpcCatalogView(NpcScopedView):
    """GET children/<child>/npcs/: published characters this child may meet."""

    def get(self, request, child_id):
        release = _active_release()
        if release is None:
            return Response(runtime.empty_catalog())
        return Response(runtime.catalog(release, self.child))


class AreaNpcsView(NpcScopedView):
    """GET children/<child>/regions/<region>/npcs/: spawnable placements in a 3D Area."""

    def get(self, request, child_id, region_id):
        release = _active_release()
        if release is None:
            return Response(runtime.empty_scene(self.scope))
        return Response(runtime.scene(release, self.child, self.scope))


class PlaceNpcsView(NpcScopedView):
    """GET children/<child>/places/<place>/npcs/: spawnable placements in a Place."""

    def get(self, request, child_id, place_slug):
        release = _active_release()
        if release is None:
            return Response(runtime.empty_scene(self.scope))
        return Response(runtime.scene(release, self.child, self.scope))
