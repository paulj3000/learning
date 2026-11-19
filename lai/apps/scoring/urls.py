from django.urls import path

from . import views

urlpatterns = [
    path(
        "children/<uuid:child_id>/scoring/",
        views.ScoringSummaryView.as_view(),
        name="child-scoring",
    ),
    path(
        "children/<uuid:child_id>/scoring/awards/",
        views.AwardFeedView.as_view(),
        name="child-scoring-awards",
    ),
]
