from django.urls import path

from .views import MasteryDetailView, MasteryListView

CHILD = "children/<uuid:child_id>/"

urlpatterns = [
    path(f"{CHILD}mastery/", MasteryListView.as_view(), name="mastery"),
    path(f"{CHILD}mastery/<slug:objective_id>/", MasteryDetailView.as_view(), name="mastery-detail"),
]
