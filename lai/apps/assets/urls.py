"""Asset routes: the child-scoped resolver and the signed file route (LAI-2200 AM-6).

Read-only. Staff create, upload, publish, retire and delete assets in Django Admin only
(ADR-045); there is deliberately no asset mutation route here.
"""

from django.urls import path

from .views import AssetFileView, AssetResolveView

urlpatterns = [
    path("children/<uuid:child_id>/assets/", AssetResolveView.as_view(), name="asset-resolve"),
    path("asset-files/<str:token>/<str:filename>", AssetFileView.as_view(), name="asset-file"),
]
