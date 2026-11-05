"""Runtime read API (workstream B, LAI-NPC-007). Foundation stubs: answer 501 until implemented.

Contract: docs/NPC_MANAGER_CONTRACTS.md section 5.1.
"""

from .api import NotImplementedYet, NpcScopedView


class NpcCatalogView(NpcScopedView):
    """GET children/<child>/npcs/: published characters this child may meet."""

    def get(self, request, child_id):
        raise NotImplementedYet


class AreaNpcsView(NpcScopedView):
    """GET children/<child>/regions/<region>/npcs/: spawnable placements in a 3D Area."""

    def get(self, request, child_id, region_id):
        raise NotImplementedYet


class PlaceNpcsView(NpcScopedView):
    """GET children/<child>/places/<place>/npcs/: spawnable placements in a Place."""

    def get(self, request, child_id, place_slug):
        raise NotImplementedYet
