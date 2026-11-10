from django.urls import path

from .views import NextLearningActivityView

urlpatterns = [
    path(
        "children/<uuid:child_id>/next-learning-activity/",
        NextLearningActivityView.as_view(),
        name="next-learning-activity",
    ),
]
