"""Asset references from catalog-adjacent rows (POST-MERGE-03; was `apps/core/catalog.py`).

Rows store an asset id, never a URL, bucket or key (ADR-030). The canonical asset catalog is
`catalog.ContentAsset`, imported from the content export, so an id is valid exactly when it is a
`ContentAsset` of an allowed kind. An empty id is allowed and means "draw a placeholder".
There is one asset catalog; nothing here reads the bundled files directly.
"""

from django.core.exceptions import ValidationError
from django.utils.deconstruct import deconstructible


class AssetKind:
    """The kinds the bundled manifest uses (`ContentAsset.kind`)."""

    CHARACTER = "character"
    PROP = "prop"
    COLLECTIBLE = "collectible"
    KIT_PIECE = "kit-piece"


def validate_asset_ref(asset_id: str, *kinds: str) -> None:
    """Raise a ValidationError when `asset_id` is not a known asset of one of `kinds`."""
    if not asset_id:
        return
    from apps.catalog.models import ContentAsset  # avoid an import cycle with model modules

    kind = ContentAsset.objects.filter(asset_id=asset_id).values_list("kind", flat=True).first()
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
