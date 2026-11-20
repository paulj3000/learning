from django.urls import path

from .views import ChildAvatarView

urlpatterns = [
    path("children/<uuid:child_id>/avatar/", ChildAvatarView.as_view(), name="child-avatar"),
]
