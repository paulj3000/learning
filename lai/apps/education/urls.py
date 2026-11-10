from django.urls import path

from . import views

CHILD = "children/<uuid:child_id>/"

urlpatterns = [
    path(f"{CHILD}skill-progress/", views.SkillProgressView.as_view(), name="skill-progress"),
    path(f"{CHILD}story-artifacts/", views.StoryArtifactListView.as_view(), name="story-artifacts"),
    path(
        f"{CHILD}story-artifacts/<uuid:artifact_id>/",
        views.StoryArtifactDetailView.as_view(),
        name="story-artifact",
    ),
    path(
        f"{CHILD}next-learning-activity/",
        views.NextLearningActivityView.as_view(),
        name="next-learning-activity",
    ),
]
