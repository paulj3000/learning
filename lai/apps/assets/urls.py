"""Asset routes: the child-scoped resolver and signed file route (LAI-2200 AM-6), and the
administrator API (AM-14, `admin_api.py`)."""

from django.urls import path

from .admin_api import (
    AdminAssetDetailView,
    AdminAssetListView,
    AdminAssetVersionActionView,
    AdminAssetVersionsView,
    AdminAssetVersionView,
)
from .views import AssetFileView, AssetResolveView

VERSION = "admin/assets/<slug:asset_id>/versions/<int:number>/"

urlpatterns = [
    path("children/<uuid:child_id>/assets/", AssetResolveView.as_view(), name="asset-resolve"),
    path("asset-files/<str:token>/<str:filename>", AssetFileView.as_view(), name="asset-file"),
    path("admin/assets/", AdminAssetListView.as_view(), name="admin-asset-list"),
    path(
        "admin/assets/<slug:asset_id>/", AdminAssetDetailView.as_view(), name="admin-asset-detail"
    ),
    path(
        "admin/assets/<slug:asset_id>/versions/",
        AdminAssetVersionsView.as_view(),
        name="admin-asset-versions",
    ),
    path(VERSION, AdminAssetVersionView.as_view(), name="admin-asset-version"),
    *(
        path(
            f"{VERSION}{action}/",
            AdminAssetVersionActionView.as_view(action=action),
            name=f"admin-asset-version-{action}",
        )
        for action in ("publish", "default", "retire")
    ),
]
