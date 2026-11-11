"""Hybrid AI hints (workstream F, LAI-NPC-030/032/033).

Contract: docs/NPC_MANAGER_CONTRACTS.md section 5.3.

POST .../npcs/<npc_id>/interactions/<conversation_id>/hint/  body: {} (or no body)
200: {"contractVersion": 1, "hint": {"text", "source": "AI"|"FALLBACK", "speech": null}}

Errors (same as the interaction routes): 400 for a non-empty body, 404 `npc_not_found` /
`conversation_not_found` / another family's child, 409 `conversation_ended`, 409
`dialogue_unavailable` when the node or the character's mode does not allow a hint. AI off,
rate limits, provider failures and unsafe output are never errors: the persona's authored line
comes back with `source: "FALLBACK"`. Nothing here changes gameplay state.

`speech` is always null in contract v1: the existing approved-utterance path
(`apps.speech.integration.approve_turn`) is keyed to Chatty's and the tutor's voices and sources,
so it would voice an NPC hint as the wrong character. A per-NPC utterance needs workstream E.
"""

from __future__ import annotations

from rest_framework.response import Response

from . import ai, state
from .api import NpcScopedView, npc_error
from .views_dialogue import EmptyRequest, _body
from .vocabulary import CONTRACT_VERSION


class InteractionHintView(NpcScopedView):
    """POST .../interactions/<conversation>/hint/: an AI hint at a node that allows one."""

    def post(self, request, child_id, npc_id, conversation_id, **scope):
        body = EmptyRequest(data=_body(request) if request.data else {})
        body.is_valid(raise_exception=True)
        self.published_character(npc_id)  # scope, age band and placement checks (404)
        release = self.release()
        character = release.characters.get(npc_id)
        if character is None:
            raise npc_error("npc_not_found", 404)
        try:
            hint = ai.request_hint(self.child, release, character, conversation_id)
        except state.ConversationNotFound:
            raise npc_error("conversation_not_found", 404) from None
        except state.ConversationEnded:
            raise npc_error("conversation_ended", 409) from None
        except ai.HintUnavailable:
            raise npc_error("dialogue_unavailable", 409) from None
        return Response(
            {
                "contractVersion": CONTRACT_VERSION,
                "hint": {"text": hint.text, "source": hint.source, "speech": None},
            }
        )
