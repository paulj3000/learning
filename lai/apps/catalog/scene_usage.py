"""Which shipped scenes use an asset (GE-247; game-engine/bundled-asset-references.md).

A shipped scene is a source-controlled 3D location: its manifest is TypeScript and its models are
the bundled files in `public/models/`. The engine writes the ids each scene uses to
`content/derived/scene-asset-index.json`. The content export carries them as `locationAssets`, and
`load_content` stores them:

- as `LocationAsset` rows, for scenes that have a Place record;
- in the latest release report (`importer.SCENE_ASSETS_WITHOUT_PLACE`), for scenes without one:
  the Welcome Harbor hub. That is an interim home until the owner decides whether the hub becomes
  a Place record.

Only the latest release is current. The importer never deletes a link, so a scene that no longer
uses the asset keeps its row with an older `last_seen_release`. Such rows are reported as stale.

Retiring an asset never removes it from a shipped scene: the scene keeps drawing the bundled
model. What can change is collision. The Asset Manager's profile for the asset applies in these
scenes too, so these usages are listed (never blocking) wherever staff retire an asset or edit its
collision profile. Queries only; the module never writes.
"""

from __future__ import annotations

from dataclasses import dataclass

from .importer import SCENE_ASSETS_WITHOUT_PLACE
from .models import ContentAsset, ContentRelease


@dataclass(frozen=True)
class SceneUsage:
    """One shipped scene that draws an asset."""

    #: A Place slug, or a region slug for a scene without a Place (the hub).
    scene: str
    has_place: bool
    #: The content release the reference was last seen in.
    release_id: int
    #: False when a newer release no longer lists the reference.
    current: bool

    @property
    def label(self) -> str:
        """`Shipped scene bay (bundled model)`, with the release for a stale reference."""
        if self.current:
            return f"Shipped scene {self.scene} (bundled model)"
        return f"Shipped scene {self.scene} (bundled model, last seen in release {self.release_id})"

    @property
    def short(self) -> str:
        """The scene for a one-line list: `bay`, `welcome-harbor (no Place record)`."""
        text = self.scene if self.has_place else f"{self.scene} (no Place record)"
        return text if self.current else f"{text}, last seen in release {self.release_id}"


def shipped_scene_usages(asset: ContentAsset) -> list[SceneUsage]:
    """Every shipped scene that uses `asset`: current ones first, then stale ones, each by slug."""
    latest = ContentRelease.objects.only("pk", "report").first()
    if latest is None:
        return []
    usages = [
        SceneUsage(
            scene=slug,
            has_place=True,
            release_id=release_id,
            current=release_id == latest.pk,
        )
        for slug, release_id in asset.location_links.values_list(
            "location__slug", "last_seen_release_id"
        )
    ]
    # Only the latest release, and a missing or malformed entry is simply no usage: this runs inside
    # retirement, where raising would refuse every retirement (fail closed).
    report = latest.report if isinstance(latest.report, dict) else {}
    unplaced = report.get(SCENE_ASSETS_WITHOUT_PLACE)
    if isinstance(unplaced, dict):
        usages += [
            SceneUsage(scene=slug, has_place=False, release_id=latest.pk, current=True)
            for slug, ids in unplaced.items()
            if isinstance(slug, str) and isinstance(ids, list) and asset.asset_id in ids
        ]
    return sorted(usages, key=lambda usage: (not usage.current, usage.scene))


def retirement_note(asset: ContentAsset) -> str:
    """What retiring `asset` does to the shipped scenes that use it, for staff."""
    note = "Shipped with the app: these scenes keep drawing the bundled model."
    if asset.collision_profiles.exists():
        note += (
            " Its collision profile stops applying there, so the engine's built-in collision for"
            " this asset is used instead (none, for most kit pieces)."
        )
    return note
