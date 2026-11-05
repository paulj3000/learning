"""NPC Manager API routes (contract v1, docs/NPC_MANAGER_CONTRACTS.md section 5).

Frozen by the foundation. Each view module belongs to one workstream:
`views_runtime` (B, LAI-NPC-007), `views_dialogue` (C, LAI-NPC-012/013/017), `views_ai` (F,
LAI-NPC-030/032). Two scopes: a 3D Area (`regions/<region_id>`, callable by the game runtime's
region-scoped cookie as well as the parent's bearer token) and a Place without a 3D Area
(`places/<place_slug>`, bearer only).
"""

from django.urls import path, re_path

from . import views_ai, views_dialogue, views_runtime

CHILD = "children/<uuid:child_id>/"
AREA = CHILD + "regions/<slug:region_id>/npcs/"
PLACE = CHILD + "places/<slug:place_slug>/npcs/"
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"


def _interaction_routes(prefix: str, scope: str) -> list:
    regex_prefix = (
        r"^children/(?P<child_id>"
        + UUID
        + r")/"
        + (r"regions/(?P<region_id>[-a-zA-Z0-9_]+)/npcs/" if scope == "area" else "")
        + (r"places/(?P<place_slug>[-a-zA-Z0-9_]+)/npcs/" if scope == "place" else "")
        + r"(?P<npc_id>[-a-zA-Z0-9_]+)/interactions/(?P<conversation_id>"
        + UUID
        + r")/"
    )
    return [
        path(
            prefix + "<slug:npc_id>/interactions/",
            views_dialogue.InteractionStartView.as_view(),
            name=f"npc-{scope}-interaction-start",
        ),
        re_path(
            regex_prefix + r"(?P<action>choose|advance|end)/$",
            views_dialogue.InteractionActionView.as_view(),
            name=f"npc-{scope}-interaction-action",
        ),
        re_path(
            regex_prefix + r"hint/$",
            views_ai.InteractionHintView.as_view(),
            name=f"npc-{scope}-interaction-hint",
        ),
    ]


urlpatterns = [
    path(CHILD + "npcs/", views_runtime.NpcCatalogView.as_view(), name="npc-catalog"),
    path(AREA, views_runtime.AreaNpcsView.as_view(), name="npc-area"),
    path(PLACE, views_runtime.PlaceNpcsView.as_view(), name="npc-place"),
    *_interaction_routes(AREA, "area"),
    *_interaction_routes(PLACE, "place"),
]
