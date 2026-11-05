"""Which NPC releases and draft rows use an asset (LAI-NPC-036).

Two kinds of use:

- **Release dependents**: ACTIVE and SUPERSEDED releases that name the asset (or one version of
  it) in `NpcReleaseAsset`. The ACTIVE release is what children are served; a SUPERSEDED release
  is a rollback target. Retiring an asset or version either one depends on is refused
  (`npc_release_dependency`) by `retirement_guard`, registered with
  `apps.assets.services.RETIREMENT_GUARDS` from `NpcsConfig.ready()`. RETIRED releases never come
  back, so they do not block anything.
- **Draft dependents**: authoring rows (variants, extras, dialogue nodes). They block nothing:
  the next publish reports a retired asset as a problem. They are listed so staff know what to
  fix.

Deleting is separate and already impossible while anything refers to the asset: every NPC
foreign key to `ContentAsset` and `AssetVersion` is `PROTECT`.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from django.db.models import Q, QuerySet

from apps.catalog.models import ContentAsset

from .models import (
    NpcDialogueNode,
    NpcModelVariant,
    NpcRelease,
    NpcReleaseAsset,
    NpcVariantAsset,
)
from .vocabulary import ReleaseStatus

#: Releases that can be served now or after a rollback.
LIVE_RELEASE_STATUSES = (ReleaseStatus.ACTIVE, ReleaseStatus.SUPERSEDED)
REFUSAL_CODE = "npc_release_dependency"


def release_links(asset: ContentAsset, version=None) -> QuerySet[NpcReleaseAsset]:
    """The `NpcReleaseAsset` rows of live releases that use `asset` (or exactly `version`)."""
    links = NpcReleaseAsset.objects.filter(asset=asset, release__status__in=LIVE_RELEASE_STATUSES)
    if version is not None:
        links = links.filter(version=version)
    return links.select_related("release", "version").order_by("-release__number", "usage")


def release_dependents(asset: ContentAsset, version=None) -> list[NpcRelease]:
    """ACTIVE and SUPERSEDED releases that use `asset`, or exactly `version` when given."""
    releases = NpcRelease.objects.filter(status__in=LIVE_RELEASE_STATUSES, asset_links__asset=asset)
    if version is not None:
        releases = releases.filter(asset_links__version=version)
    return list(releases.distinct().order_by("-number"))


@dataclass
class DraftDependents:
    asset_pk: int
    variants: list[NpcModelVariant] = field(default_factory=list)
    extras: list[NpcVariantAsset] = field(default_factory=list)
    dialogue_nodes: list[NpcDialogueNode] = field(default_factory=list)

    def __bool__(self) -> bool:
        return bool(self.variants or self.extras or self.dialogue_nodes)

    def describe(self) -> list[str]:
        """One staff-readable line per draft row that uses the asset."""
        lines = []
        for v in self.variants:
            use = "portrait" if v.portrait_asset_id == self.asset_pk else "model"
            lines.append(f"{v.character.slug} variant {v.variant_key} ({use})")
        lines += [
            f"{e.variant.character.slug} variant {e.variant.variant_key} ({e.role.lower()})"
            for e in self.extras
        ]
        lines += [
            f"{n.dialogue.character.slug} dialogue {n.dialogue.dialogue_key} node {n.node_key}"
            " (recorded line)"
            for n in self.dialogue_nodes
        ]
        return lines


def draft_dependents(asset: ContentAsset) -> DraftDependents:
    """Authoring rows that name `asset` (as a model, pinned version, portrait, extra or line)."""
    variants = (
        NpcModelVariant.objects.filter(
            Q(model_asset=asset) | Q(portrait_asset=asset) | Q(pinned_version__asset=asset)
        )
        .select_related("character__definition")
        .distinct()
        .order_by("character__definition__npc_id", "variant_key")
    )
    extras = (
        NpcVariantAsset.objects.filter(asset=asset)
        .select_related("variant__character__definition")
        .order_by("variant__character__definition__npc_id", "variant__variant_key", "role")
    )
    nodes = (
        NpcDialogueNode.objects.filter(audio_asset=asset)
        .select_related("dialogue__character__definition")
        .order_by("dialogue__character__definition__npc_id", "dialogue__dialogue_key", "node_key")
    )
    return DraftDependents(
        asset_pk=asset.pk, variants=list(variants), extras=list(extras), dialogue_nodes=list(nodes)
    )


def refusal_message(asset: ContentAsset, version, releases: list[NpcRelease]) -> str:
    what = f"{asset.asset_id} v{version.number}" if version is not None else asset.asset_id
    named = ", ".join(f"{r.number} ({r.get_status_display().lower()})" for r in releases)
    return (
        f"{what} is used by NPC release(s) {named}. Children may be shown it now or after a "
        "rollback, so it cannot be retired. Publish an NPC release that no longer uses it and "
        "retire the older releases first (NPC Manager: Asset dependencies)."
    )


def retirement_guard(asset: ContentAsset, version=None) -> None:
    """Refuse to retire what a live NPC release uses. Registered from `NpcsConfig.ready()`."""
    from apps.assets.services import AssetActionRefused

    releases = release_dependents(asset, version)
    if releases:
        raise AssetActionRefused(
            REFUSAL_CODE,
            refusal_message(asset, version, releases),
            details={"releases": [r.number for r in releases]},
        )


@dataclass
class AssetReport:
    """Every NPC use of one asset, for the dependency report page."""

    asset: ContentAsset
    release_links: list[NpcReleaseAsset]
    drafts: DraftDependents

    @property
    def blocks_retirement(self) -> bool:
        return bool(self.release_links)


def report(asset_id: str | None = None) -> list[AssetReport]:
    """One entry per asset any live release or draft row uses (or just `asset_id`)."""
    if asset_id:
        assets = ContentAsset.objects.filter(asset_id=asset_id)
    else:
        used = (
            set(
                NpcReleaseAsset.objects.filter(
                    release__status__in=LIVE_RELEASE_STATUSES
                ).values_list("asset_id", flat=True)
            )
            | set(NpcModelVariant.objects.values_list("model_asset_id", flat=True))
            | set(
                NpcModelVariant.objects.exclude(portrait_asset=None).values_list(
                    "portrait_asset_id", flat=True
                )
            )
            | set(NpcVariantAsset.objects.values_list("asset_id", flat=True))
            | set(
                NpcDialogueNode.objects.exclude(audio_asset=None).values_list(
                    "audio_asset_id", flat=True
                )
            )
        )
        assets = ContentAsset.objects.filter(pk__in=used)
    return [
        AssetReport(
            asset=asset,
            release_links=list(release_links(asset)),
            drafts=draft_dependents(asset),
        )
        for asset in assets.order_by("asset_id")
    ]
