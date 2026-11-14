from django.urls import path

from .views import (
    ChildCompanionView,
    ChildDetailView,
    ChildListView,
    ChildPhotoContentView,
    ChildPhotoView,
    MeView,
)

urlpatterns = [
    path("me/", MeView.as_view(), name="me"),
    path("children/", ChildListView.as_view(), name="children"),
    path("children/<uuid:child_id>/", ChildDetailView.as_view(), name="child-detail"),
    path("children/<uuid:child_id>/photo/", ChildPhotoView.as_view(), name="child-photo"),
    path(
        "children/<uuid:child_id>/companion/", ChildCompanionView.as_view(), name="child-companion"
    ),
    path(
        "children/<uuid:child_id>/photo/content/",
        ChildPhotoContentView.as_view(),
        name="child-photo-content",
    ),
]
