"""Asset routes (LAI-2200 AM-6): one child-scoped resolver and the signed file route."""

from django.urls import path

from .views import AssetFileView, AssetResolveView

urlpatterns = [
    path("children/<uuid:child_id>/assets/", AssetResolveView.as_view(), name="asset-resolve"),
    path("asset-files/<str:token>/<str:filename>", AssetFileView.as_view(), name="asset-file"),
]
