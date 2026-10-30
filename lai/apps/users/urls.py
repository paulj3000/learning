from django.urls import path

from .views import ChildDetailView, ChildListView, MeView

urlpatterns = [
    path("me/", MeView.as_view(), name="me"),
    path("children/", ChildListView.as_view(), name="children"),
    path("children/<uuid:child_id>/", ChildDetailView.as_view(), name="child-detail"),
]
