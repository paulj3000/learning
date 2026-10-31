from django.urls import path

from .local_auth_views import LocalCsrfView, LocalLoginView, LocalLogoutView
from .views import ChildDetailView, ChildListView, MeView

urlpatterns = [
    path("me/", MeView.as_view(), name="me"),
    # Local development sign-in (ADR-038): 404 unless AUTH_PROVIDER=django.
    path("auth/csrf/", LocalCsrfView.as_view(), name="auth-csrf"),
    path("auth/login/", LocalLoginView.as_view(), name="auth-login"),
    path("auth/logout/", LocalLogoutView.as_view(), name="auth-logout"),
    path("children/", ChildListView.as_view(), name="children"),
    path("children/<uuid:child_id>/", ChildDetailView.as_view(), name="child-detail"),
]
