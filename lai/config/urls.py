"""Root URL configuration. Versioned API routes live under /api/v1/ (one include per app)."""

from django.urls import include, path

urlpatterns = [
    path("api/v1/", include("apps.core.urls")),
]
