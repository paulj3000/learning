from django.urls import path

from . import views

CHILD = "children/<uuid:child_id>/"

urlpatterns = [
    path(f"{CHILD}quests/", views.QuestListView.as_view(), name="quests"),
    path(f"{CHILD}quests/<slug:quest_slug>/", views.QuestStateView.as_view(), name="quest-state"),
]
