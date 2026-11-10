from django.urls import path

from . import views

urlpatterns = [
    path("children/<uuid:child_id>/rewards/", views.RewardsView.as_view(), name="child-rewards"),
]
