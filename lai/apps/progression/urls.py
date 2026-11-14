from django.urls import path

from . import views

CHILD = "children/<uuid:child_id>/"
STORY = f"{CHILD}stories/<slug:story_slug>/"

urlpatterns = [
    path(f"{CHILD}world-changes/", views.WorldChangeListView.as_view(), name="world-changes"),
    path(f"{CHILD}world-state/", views.WorldStateView.as_view(), name="world-state"),
    path(f"{CHILD}stories/", views.StoryListView.as_view(), name="stories"),
    path(f"{STORY}start/", views.StoryStartView.as_view(), name="story-start"),
    path(f"{STORY}flags/", views.StoryFlagView.as_view(), name="story-flags"),
    path(
        f"{STORY}chapters/<slug:chapter_id>/complete/",
        views.StoryChapterCompleteView.as_view(),
        name="story-chapter-complete",
    ),
    path(f"{STORY}reflections/", views.StoryReflectionView.as_view(), name="story-reflections"),
    path(f"{CHILD}npc-memory/", views.NpcListView.as_view(), name="npc-memory"),
    path(
        f"{CHILD}npc-memory/<slug:npc_id>/dialogue/",
        views.NpcDialogueView.as_view(),
        name="npc-dialogue",
    ),
]
