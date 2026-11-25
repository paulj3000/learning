"""Derived artifacts as an informational usage source (LAI-07 W2-5; ASSET_LIBRARY.md s. 25.4).

A derived artifact (ADR-066) is a processed copy of one asset version, kept for review. It is
reported next to an asset's other usages so staff see what was produced from it, and which new
version an artifact was promoted into. It never blocks retirement: an artifact is evidence of
past processing, not something a child is served, and retention expires it on its own.

Asked about the whole asset, every artifact of the asset is listed. Asked about one version, only
artifacts derived from that exact version or promoted into it. An expired, deleted or rejected
artifact is reported as historical. Labels carry content ids only. Read-only.
"""

from __future__ import annotations

from django.db.models import Q
from django.urls import NoReverseMatch, reverse

from apps.catalog.models import ContentAsset

from .dependencies import Usage, register_usage_provider
from .models import ArtifactState, AssetVersion, DerivedArtifact

SOURCE = "artifacts"
#: Never a refusal: artifact usages do not block retirement.
CODE = "derived_artifact"
HISTORICAL_STATES = (ArtifactState.EXPIRED, ArtifactState.DELETED, ArtifactState.REJECTED)


def _admin_url(artifact: DerivedArtifact) -> str:
    try:
        return reverse("admin:assets_derivedartifact_change", args=[artifact.pk])
    except NoReverseMatch:
        return ""


def artifact_usages(asset: ContentAsset, version: AssetVersion | None) -> list[Usage]:
    related = DerivedArtifact.objects.select_related("source_version", "promoted_version")
    if version is None:
        artifacts = related.filter(Q(asset=asset) | Q(promoted_version__asset=asset))
    else:
        artifacts = related.filter(Q(source_version=version) | Q(promoted_version=version))
    usages = []
    for artifact in artifacts.order_by("created_at", "pk"):
        label = (
            f"Derived artifact {str(artifact.pk)[:8]} ({artifact.logical_id}) "
            f"from version {artifact.source_version.number}"
        )
        if artifact.promoted_version_id:
            label += f", promoted to version {artifact.promoted_version.number}"
        usages.append(
            Usage(
                SOURCE,
                CODE,
                label,
                blocks_retirement=False,
                historical=artifact.state in HISTORICAL_STATES,
                admin_url=_admin_url(artifact),
                details={
                    "artifact": str(artifact.pk),
                    "kind": artifact.role,
                    "status": artifact.state,
                    "sourceVersion": artifact.source_version.number,
                    "promotedVersion": (
                        artifact.promoted_version.number if artifact.promoted_version_id else None
                    ),
                },
            )
        )
    return usages


def register() -> None:
    register_usage_provider(SOURCE, artifact_usages)
