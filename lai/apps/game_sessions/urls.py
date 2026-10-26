"""Child-scoped session routes. Every route is under a child and served by a child-scoped view,
except the game launch redemption and the game runtime's own routes (LAI-ANDROID-API-001), which
are parent-scoped or game-session-scoped (see `launch_views.py`).

LAI-0601's answers and hints come first: Treasure Rush's lifecycle route
`sessions/<id>/<slug:action>/` would otherwise also match them (an unknown action there is a
409 `invalid_transition`).
"""

from django.urls import path

from . import launch_views, native_views, play_views
from .views import (
    AdventureAvailabilityView,
    AdventureSessionCompleteView,
    AdventureSessionsView,
    AdventureSessionView,
    AnswersView,
    HintsView,
)

CHILD = "children/<uuid:child_id>/"

urlpatterns = [
    path(
        f"{CHILD}sessions/<uuid:session_id>/answers/", AnswersView.as_view(), name="session-answers"
    ),
    path(f"{CHILD}sessions/<uuid:session_id>/hints/", HintsView.as_view(), name="session-hints"),
    # Step-adventure session lifecycle (LAI-0608). Under `adventures/` because `sessions/<id>/`
    # and `sessions/<id>/<action>/` are Treasure Rush's region-session contract (TR-5).
    path(
        f"{CHILD}adventures/<slug:adventure_id>/availability/",
        AdventureAvailabilityView.as_view(),
        name="adventure-availability",
    ),
    path(
        f"{CHILD}adventures/<slug:adventure_id>/sessions/",
        AdventureSessionsView.as_view(),
        name="adventure-sessions",
    ),
    path(
        f"{CHILD}adventures/<slug:adventure_id>/sessions/<uuid:session_id>/",
        AdventureSessionView.as_view(),
        name="adventure-session",
    ),
    path(
        f"{CHILD}adventures/<slug:adventure_id>/sessions/<uuid:session_id>/complete/",
        AdventureSessionCompleteView.as_view(),
        name="adventure-session-complete",
    ),
    path(f"{CHILD}home/", native_views.ChildHomeView.as_view(), name="child-home"),
    path(f"{CHILD}regions/", native_views.RegionListView.as_view(), name="child-regions"),
    path(f"{CHILD}inventory/", native_views.InventoryView.as_view(), name="child-inventory"),
    path(
        f"{CHILD}game-launches/", launch_views.GameLaunchView.as_view(), name="game-launches"
    ),
    path("game-launches/redeem/", launch_views.GameLaunchRedeemView.as_view(), name="game-redeem"),
    path("game-launches/revoke/", launch_views.GameLaunchRevokeView.as_view(), name="game-revoke"),
    path("game-session/", launch_views.GameRuntimeSessionView.as_view(), name="game-session"),
    path("game-session/end/", launch_views.GameRuntimeEndView.as_view(), name="game-session-end"),
    path(f"{CHILD}regions/<slug:region_id>/", play_views.RegionView.as_view(), name="play-region"),
    path(
        f"{CHILD}regions/<slug:region_id>/adventures/",
        native_views.RegionAdventuresView.as_view(),
        name="child-region-adventures",
    ),
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
