"""Add the owner's pirate model as a second Pirate Pip variant (2026-11-07).

    python manage.py add_pip_pirate_variant [--file PATH] [--use-in-cove] [--publish]

What it does, through the same services the Django Admin uses (nothing bypasses validation):

1. Creates the Django-authored character asset `npc-pip-pirate` (category NPC) if missing, with
   its declared clips (Idle, Walk, Wave, Point).
2. Uploads `--file` (default `content/models/npc-pip-pirate.glb`) as a version, which validates
   it, and publishes that version. Rerunning with the same file is `unchanged`.
3. Creates Pip's `pirate` variant on that asset (scale 1.25, map idle/walk/wave/point). The
   `classic` variant and its placeholder model stay as they were, and stay the default.
4. `--use-in-cove`: points Pip's Treasure Cove placement at the `pirate` variant, so children
   see him there. Without it the variant exists but nothing places it.
5. `--publish`: validates and publishes an NPC release (children only ever see a release).

Prerequisite: `seed_npc_pip` (Pip's character and placement).
"""

from __future__ import annotations

from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.assets.models import VersionStatus
from apps.assets.services import AssetActionRefused, publish_version, upload_version
from apps.catalog.models import AssetCategory, AssetOrigin, ContentAsset
from apps.npcs import pip_content as pip
from apps.npcs.models import NpcCharacter, NpcModelVariant, NpcPlacement
from apps.npcs.publishing import PublishError, preview
from apps.npcs.publishing import publish as publish_release


def repo_root() -> Path:
    return Path(settings.BASE_DIR).resolve().parent  # BASE_DIR is lai/


def ensure_asset() -> tuple[ContentAsset, bool]:
    asset = ContentAsset.objects.filter(asset_id=pip.PIRATE_ASSET_ID).first()
    if asset is not None:
        return asset, False
    asset = ContentAsset(
        asset_id=pip.PIRATE_ASSET_ID,
        kind="character",
        clips=list(pip.PIRATE_CLIPS),
        origin=AssetOrigin.DJANGO,
        display_name="Pirate Pip (rigged pirate)",
        description="The owner's Mixamo pirate, re-exported with named clips.",
        category=AssetCategory.NPC,
        tags=["pirate", "npc", "mixamo"],
    )
    asset.full_clean()
    asset.save()
    return asset, True


def ensure_published_version(asset: ContentAsset, path: Path) -> str:
    """Upload and publish `path`; returns what happened (`uploaded`, `unchanged`)."""
    with path.open("rb") as upload:
        try:
            version = upload_version(asset, upload, original_filename=path.name)
        except AssetActionRefused as refused:
            if refused.code != "duplicate_version":
                raise
            version = asset.versions.get(number=refused.details["version"])
            if version.status == VersionStatus.PUBLISHED:
                return "unchanged"
            status = "existing"
        else:
            status = "uploaded"
    publish_version(version)
    return status


@transaction.atomic
def ensure_variant(asset: ContentAsset) -> tuple[NpcModelVariant, bool]:
    character = NpcCharacter.objects.filter(definition__npc_id=pip.NPC_ID).first()
    if character is None:
        raise CommandError("Pirate Pip has no NPC Manager character yet: run seed_npc_pip first.")
    variant = NpcModelVariant.objects.filter(
        character=character, variant_key=pip.PIRATE_VARIANT_KEY
    ).first()
    if variant is not None:
        return variant, False
    top = character.variants.order_by("-sort_order").values_list("sort_order", flat=True).first()
    variant = NpcModelVariant(
        character=character,
        variant_key=pip.PIRATE_VARIANT_KEY,
        display_name="Pirate",
        model_asset=asset,
        scale=pip.PIRATE_SCALE,
        animation_map=dict(pip.PIRATE_ANIMATION_MAP),
        is_default=False,
        sort_order=(top or 0) + 1,
    )
    variant.full_clean()
    variant.save()
    return variant, True


def place_in_cove(variant: NpcModelVariant) -> bool:
    placement = NpcPlacement.objects.filter(placement_key=pip.PLACEMENT_KEY).first()
    if placement is None:
        raise CommandError("Pip's Treasure Cove placement is missing: run seed_npc_pip first.")
    if placement.variant_id == variant.pk:
        return False
    placement.variant = variant
    placement.full_clean()
    placement.save(update_fields=["variant", "updated_at"])
    return True


class Command(BaseCommand):
    help = "Add the owner's pirate model as Pirate Pip's 'pirate' variant."

    def add_arguments(self, parser):
        parser.add_argument("--file", help=f"GLB to upload (default {pip.PIRATE_MODEL_FILE}).")
        parser.add_argument(
            "--use-in-cove", action="store_true", help="Place the pirate in Treasure Cove."
        )
        parser.add_argument("--publish", action="store_true", help="Publish an NPC release.")

    def handle(self, *args, file=None, use_in_cove: bool = False, publish: bool = False, **opts):
        path = Path(file) if file else repo_root() / pip.PIRATE_MODEL_FILE
        if not path.is_file():
            raise CommandError(f"No model file at {path}.")

        asset, created = ensure_asset()
        self.stdout.write(f"Asset {asset.asset_id}: {'created' if created else 'exists'}.")
        try:
            status = ensure_published_version(asset, path)
        except AssetActionRefused as refused:
            for finding in getattr(refused, "findings", None) or []:
                self.stdout.write(f"  finding: {finding}")
            raise CommandError(f"Model refused: {refused.code}.") from refused
        asset.refresh_from_db()
        version = asset.default_version
        clips = ", ".join(version.clips)
        self.stdout.write(f"Model: {status}; published version {version.number}, clips {clips}.")

        variant, created = ensure_variant(asset)
        state = "created" if created else "exists"
        self.stdout.write(f"Variant {pip.PIRATE_VARIANT_KEY}: {state}.")
        if use_in_cove:
            moved = place_in_cove(variant)
            self.stdout.write(
                "Treasure Cove placement: "
                + ("now uses the pirate." if moved else "already uses the pirate.")
            )

        result = preview()
        if result.problems:
            for problem in result.problems:
                self.stdout.write(f"  problem: {problem}")
            raise CommandError(f"Validation failed with {len(result.problems)} problem(s).")
        self.stdout.write("Validation: no problems.")
        if not publish:
            return
        try:
            release = publish_release(None, notes="add_pip_pirate_variant")
        except PublishError as error:
            if error.code == "unchanged":
                self.stdout.write("Publish: unchanged (the ACTIVE release already has this).")
                return
            for problem in error.problems:
                self.stdout.write(f"  problem: {problem}")
            raise CommandError(f"Publish refused: {error.code}.") from error
        self.stdout.write(f"Publish: NPC release {release.number} is ACTIVE.")
