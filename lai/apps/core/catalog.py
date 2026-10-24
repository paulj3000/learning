"""Shared pieces for catalog content (LAI-0304, Treasure Rush TR-2).

- `ContentStatus`: draft, published, or retired. Only published content is ever served to a
  child; drafts are what an administrator is still editing.
- Asset references: catalog rows store an `asset_id` string from the bundled asset manifest
  (ADR-030), never a URL, bucket, or key. Until the shared asset manager (LAI-2106) offers its
  own existence check, ids are checked against `content/exported/assets.json`. This is the
  server half of the asset contract in `docs/TREASURE_RUSH_ROADMAP.md` section 7, and the only
  place that would change when LAI-2106 lands.
"""

import json
from functools import lru_cache

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils.deconstruct import deconstructible


class ContentStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    PUBLISHED = "PUBLISHED", "Published"
    RETIRED = "RETIRED", "Retired"


class AssetKind:
    """The kinds the bundled manifest uses (`content/exported/assets.json`)."""

    CHARACTER = "character"
    PROP = "prop"
    COLLECTIBLE = "collectible"
    KIT_PIECE = "kit-piece"


@lru_cache(maxsize=1)
def bundled_asset_kinds() -> dict[str, str]:
    """Asset id -> kind, from the exported bundled manifest."""
    path = settings.CONTENT_DIR / "exported" / "assets.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return {asset["id"]: asset["kind"] for asset in data["assets"]}


def validate_asset_ref(asset_id: str, *kinds: str) -> None:
    """Raise a ValidationError when `asset_id` is not a known asset of one of `kinds`.

    An empty id is allowed: it means "draw a placeholder" (TR-7a).
    """
    if not asset_id:
        return
    kind = bundled_asset_kinds().get(asset_id)
    if kind is None:
        raise ValidationError("Unknown asset id.", code="asset_unknown")
    if kinds and kind not in kinds:
        raise ValidationError(
            "This asset is a %(kind)s; expected %(expected)s.",
            code="asset_wrong_kind",
            params={"kind": kind, "expected": " or ".join(kinds)},
        )


@deconstructible
class AssetRefValidator:
    """Field validator form of `validate_asset_ref`, serialisable into migrations."""

    def __init__(self, *kinds: str):
        self.kinds = kinds

    def __call__(self, value: str) -> None:
        validate_asset_ref(value, *self.kinds)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, AssetRefValidator) and self.kinds == other.kinds

    def __hash__(self) -> int:
        return hash(self.kinds)
