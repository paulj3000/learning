"""Hybrid AI hints (workstream F, LAI-NPC-030/032/033). Foundation stub: answers 501.

Contract: docs/NPC_MANAGER_CONTRACTS.md section 5.3.
"""

from .api import NotImplementedYet, NpcScopedView


class InteractionHintView(NpcScopedView):
    """POST .../interactions/<conversation>/hint/: an AI hint at a node that allows one."""

    def post(self, request, child_id, npc_id, conversation_id, **scope):
        raise NotImplementedYet
