from django.urls import path

from . import child_auth_views as child_auth
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
    # Independent child sign-in (ADR-075): the child's own routes (no parent token) ...
    path("child-auth/session/", child_auth.ChildSessionView.as_view(), name="child-session"),
    path(
        "child-auth/session/restore/",
        child_auth.ChildSessionRestoreView.as_view(),
        name="child-session-restore",
    ),
    path(
        "child-auth/session/end/",
        child_auth.ChildSessionEndView.as_view(),
        name="child-session-end",
    ),
    # ... and the parent's management of one child's sign-in (parent token only).
    path(
        "children/<uuid:child_id>/sign-in/",
        child_auth.ChildSignInView.as_view(),
        name="child-sign-in",
    ),
    path(
        "children/<uuid:child_id>/sign-in/password/",
        child_auth.ChildPasswordView.as_view(),
        name="child-sign-in-password",
    ),
    path(
        "children/<uuid:child_id>/sign-in/suspend/",
        child_auth.ChildSuspendView.as_view(),
        name="child-sign-in-suspend",
    ),
    path(
        "children/<uuid:child_id>/sign-in/resume/",
        child_auth.ChildResumeView.as_view(),
        name="child-sign-in-resume",
    ),
    path(
        "children/<uuid:child_id>/sign-in/sign-out-everywhere/",
        child_auth.ChildSignOutEverywhereView.as_view(),
        name="child-sign-in-sign-out-everywhere",
    ),
    path(
        "children/<uuid:child_id>/sign-in/devices/",
        child_auth.ChildDeviceListView.as_view(),
        name="child-sign-in-devices",
    ),
    path(
        "children/<uuid:child_id>/sign-in/devices/<uuid:device_id>/",
        child_auth.ChildDeviceView.as_view(),
        name="child-sign-in-device",
    ),
    path(
        "children/<uuid:child_id>/consents/child-sign-in/",
        child_auth.ChildSignInConsentView.as_view(),
        name="child-sign-in-consent",
    ),
]
