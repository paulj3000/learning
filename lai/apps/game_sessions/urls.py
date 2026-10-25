"""Child-scoped session routes. Every route is under a child and served by a child-scoped view.

LAI-0601's answers and hints come first: Treasure Rush's lifecycle route
`sessions/<id>/<slug:action>/` would otherwise also match them (an unknown action there is a
409 `invalid_transition`).
"""

from django.urls import path

from . import play_views
from .views import AnswersView, HintsView

CHILD = "children/<uuid:child_id>/"

urlpatterns = [
    path(
        f"{CHILD}sessions/<uuid:session_id>/answers/", AnswersView.as_view(), name="session-answers"
    ),
    path(f"{CHILD}sessions/<uuid:session_id>/hints/", HintsView.as_view(), name="session-hints"),
    path(f"{CHILD}regions/<slug:region_id>/", play_views.RegionView.as_view(), name="play-region"),
    path(
        f"{CHILD}regions/<slug:region_id>/session/",
        play_views.RegionSessionView.as_view(),
        name="play-region-session",
    ),
    path(
        f"{CHILD}sessions/<uuid:session_id>/", play_views.SessionView.as_view(), name="play-session"
    ),
    path(
        f"{CHILD}sessions/<uuid:session_id>/<slug:action>/",
        play_views.SessionActionView.as_view(),
        name="play-session-action",
    ),
    path(
        f"{CHILD}sessions/<uuid:session_id>/chests/<slug:entity_id>/challenge/",
        play_views.ChestChallengeView.as_view(),
        name="play-chest-challenge",
    ),
    path(
        f"{CHILD}attempts/<uuid:attempt_id>/answer/",
        play_views.AttemptAnswerView.as_view(),
        name="play-attempt-answer",
    ),
    path(
        f"{CHILD}quests/<slug:quest_id>/accept/",
        play_views.QuestAcceptView.as_view(),
        name="play-quest-accept",
    ),
    path(f"{CHILD}progress/", play_views.ProgressView.as_view(), name="play-progress"),
]
