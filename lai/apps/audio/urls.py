"""Audio manifest routes (SM-P2-06). Read-only; staff configure sound in Django Admin only."""

from django.urls import path

from .settings_api import ChildAudioSettingsView
from .views import IslandManifestView, PlaceManifestView, RegionManifestView

CHILD = "children/<uuid:child_id>/audio/manifests/"

urlpatterns = [
    path(
        "children/<uuid:child_id>/audio/settings/",
        ChildAudioSettingsView.as_view(),
        name="audio-settings",
    ),
    path(
        f"{CHILD}islands/<slug:identifier>/",
        IslandManifestView.as_view(),
        name="audio-manifest-island",
    ),
    path(
        f"{CHILD}places/<slug:identifier>/",
        PlaceManifestView.as_view(),
        name="audio-manifest-place",
    ),
    path(
        f"{CHILD}regions/<slug:identifier>/",
        RegionManifestView.as_view(),
        name="audio-manifest-region",
    ),
]
