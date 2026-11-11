"""NPC Manager API routes (contract v1, docs/NPC_MANAGER_CONTRACTS.md section 5).

Frozen by the foundation. Each view module belongs to one workstream:
`views_runtime` (B, LAI-NPC-007), `views_dialogue` (C, LAI-NPC-012/013/017), `views_ai` (F,
LAI-NPC-030/032). Two scopes: a 3D Area (`regions/<region_id>`, callable by the game runtime's
region-scoped cookie as well as the parent's bearer token) and a Place without a 3D Area
(`places/<place_slug>`, bearer only).
"""

from django.urls import path

from . import views_ai, views_dialogue, views_runtime
from .api import bearer_only

CHILD = "children/<uuid:child_id>/"
AREA = CHILD + "regions/<slug:region_id>/npcs/"
PLACE = CHILD + "places/<slug:place_slug>/npcs/"
CONVERSATION = "<slug:npc_id>/interactions/<uuid:conversation_id>/"
ACTIONS = ("choose", "advance", "end")


def _interaction_routes(prefix: str, scope: str) -> list:
    """Start, choose/advance/end and hint. Place routes are bearer-only (no game cookie)."""

    def view(cls):
        return (cls if scope == "area" else bearer_only(cls)).as_view()

    return [
        path(
            prefix + "<slug:npc_id>/interactions/",
            view(views_dialogue.InteractionStartView),
            name=f"npc-{scope}-interaction-start",
        ),
        *(
            path(
                prefix + CONVERSATION + f"{action}/",
                view(views_dialogue.InteractionActionView),
                {"action": action},
                name=f"npc-{scope}-interaction-{action}",
            )
            for action in ACTIONS
        ),
        path(
            prefix + CONVERSATION + "hint/",
            view(views_ai.InteractionHintView),
            name=f"npc-{scope}-interaction-hint",
        ),
    ]


urlpatterns = [
    path(CHILD + "npcs/", bearer_only(views_runtime.NpcCatalogView).as_view(), name="npc-catalog"),
    path(AREA, views_runtime.AreaNpcsView.as_view(), name="npc-area"),
    path(PLACE, bearer_only(views_runtime.PlaceNpcsView).as_view(), name="npc-place"),
    *_interaction_routes(AREA, "area"),
    *_interaction_routes(PLACE, "place"),
]
