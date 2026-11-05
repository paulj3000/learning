"""Interaction API (workstream C, LAI-NPC-012/013/017). Foundation stubs: answer 501.

Contract: docs/NPC_MANAGER_CONTRACTS.md section 5.2.
"""

from .api import NotImplementedYet, NpcScopedView


class InteractionStartView(NpcScopedView):
    """POST .../npcs/<npc>/interactions/ {"trigger": ...}: start or continue a conversation."""

    def post(self, request, child_id, npc_id, **scope):
        raise NotImplementedYet


class InteractionActionView(NpcScopedView):
    """POST .../interactions/<conversation>/(choose|advance|end)/."""

    def post(self, request, child_id, npc_id, conversation_id, action, **scope):
        raise NotImplementedYet
