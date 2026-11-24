"""The catalog's usage provider for the Asset Library registry (GE-247, S1).

Lists every shipped scene that draws an asset (`scene_usage.shipped_scene_usages`): Places
through `LocationAsset`, and the Welcome Harbor hub through the latest release report. These
usages are listed, never blocking (owner, 2026-11-23): retiring an asset never removes the
bundled model a shipped scene draws. See docs/engineering/game-engine/bundled-asset-references.md
and docs/ASSET_LIBRARY.md section 25.3.

Asset-level only: a shipped scene draws the bundled model, never a library version, so a question
about one version returns nothing. Read-only.
"""

from __future__ import annotations

from apps.assets.dependencies import Usage
from apps.assets.models import AssetVersion

from .models import ContentAsset
from .scene_usage import retirement_note, shipped_scene_usages

SOURCE = "catalog"
#: Never a refusal: catalog usages do not block retirement.
CODE = "shipped_scene"


def catalog_usages(asset: ContentAsset, version: AssetVersion | None) -> list[Usage]:
    if version is not None:
        return []
    scenes = shipped_scene_usages(asset)
    if not scenes:
        return []
    note = retirement_note(asset)
    return [
        Usage(
            SOURCE,
            CODE,
            scene.label,
            blocks_retirement=False,
            details={
                "scene": scene.scene,
                "release": scene.release_id,
                "current": scene.current,
                "note": note,
            },
        )
        for scene in scenes
    ]
