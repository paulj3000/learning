"""Runtime read API (workstream B, LAI-NPC-007).

Contract: docs/NPC_MANAGER_CONTRACTS.md section 5.1. Every route is child-scoped
(`NpcScopedView`); only the 3D Area route accepts the game runtime's cookie. Content comes only
from the ACTIVE release; no active release is `404 no_active_release`, which clients treat as
"no NPCs here".
"""

from rest_framework.response import Response

from . import runtime
from .api import NpcScopedView


class NpcCatalogView(NpcScopedView):
    """GET children/<child>/npcs/: published characters this child may meet."""

    def get(self, request, child_id):
        return Response(runtime.catalog(self.release(), self.child))


class AreaNpcsView(NpcScopedView):
    """GET children/<child>/regions/<region>/npcs/: spawnable placements in a 3D Area."""

    def get(self, request, child_id, region_id):
        return Response(runtime.scene(self.release(), self.child, self.scope))


class PlaceNpcsView(NpcScopedView):
    """GET children/<child>/places/<place>/npcs/: spawnable placements in a Place."""

    def get(self, request, child_id, place_slug):
        return Response(runtime.scene(self.release(), self.child, self.scope))
