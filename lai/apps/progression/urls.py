from django.urls import path

from .views import NpcChoiceView, NpcDetailView, NpcListView, NpcTalkView

CHILD = "children/<uuid:child_id>/"

urlpatterns = [
    path(f"{CHILD}npcs/", NpcListView.as_view(), name="npcs"),
    path(f"{CHILD}npcs/<slug:npc_id>/", NpcDetailView.as_view(), name="npc"),
    path(f"{CHILD}npcs/<slug:npc_id>/talk/", NpcTalkView.as_view(), name="npc-talk"),
    path(f"{CHILD}npcs/<slug:npc_id>/choices/", NpcChoiceView.as_view(), name="npc-choice"),
]
