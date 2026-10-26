from django.urls import path

from .views import RewardDetailView, RewardHistoryView

CHILD = "children/<uuid:child_id>/"

urlpatterns = [
    path(f"{CHILD}rewards/", RewardHistoryView.as_view(), name="rewards"),
    path(f"{CHILD}rewards/<uuid:grant_id>/", RewardDetailView.as_view(), name="reward-detail"),
]
