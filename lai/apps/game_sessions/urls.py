"""Play API routes (TR-5). Every route is under a child and served by a child-scoped view."""

from django.urls import path

from . import views

CHILD = "children/<uuid:child_id>/"

urlpatterns = [
    path(f"{CHILD}regions/<slug:region_id>/", views.RegionView.as_view(), name="play-region"),
    path(
        f"{CHILD}regions/<slug:region_id>/session/",
        views.RegionSessionView.as_view(),
        name="play-region-session",
    ),
    path(
        f"{CHILD}sessions/<uuid:session_id>/", views.SessionView.as_view(), name="play-session"
    ),
    path(
        f"{CHILD}sessions/<uuid:session_id>/<slug:action>/",
        views.SessionActionView.as_view(),
        name="play-session-action",
    ),
    path(
        f"{CHILD}sessions/<uuid:session_id>/chests/<slug:entity_id>/challenge/",
        views.ChestChallengeView.as_view(),
        name="play-chest-challenge",
    ),
    path(
        f"{CHILD}attempts/<uuid:attempt_id>/answer/",
        views.AttemptAnswerView.as_view(),
        name="play-attempt-answer",
    ),
    path(
        f"{CHILD}quests/<slug:quest_id>/accept/",
        views.QuestAcceptView.as_view(),
        name="play-quest-accept",
    ),
    path(f"{CHILD}progress/", views.ProgressView.as_view(), name="play-progress"),
]
