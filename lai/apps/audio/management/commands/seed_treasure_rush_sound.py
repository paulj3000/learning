"""Create Treasure Rush's sound cues for audio that already exists (SM-P3-10).

    python manage.py seed_treasure_rush_sound            # create what can be, report the rest
    python manage.py seed_treasure_rush_sound --dry-run  # report only, write nothing

Rules, all enforced here:

- Idempotent. A cue id that already exists is left exactly as staff configured it.
- A cue is created only when its audio asset exists in the Asset Library (asset id = the cue id
  with dashes, for example `sfx-chest-open`), is audio, suits the channel, and has a PUBLISHED
  default version. Otherwise the cue is reported as an asset requirement. No other file is ever
  substituted and no placeholder is made.
- Never publishes. Cues are created shared so the game can play them by id; they reach children
  only when staff publish a sound release in Django Admin.
- Touches no assignment, no other game's cue and no release.
"""

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.assets.models import VersionStatus
from apps.audio.models import SoundCue
from apps.audio.treasure_rush_cues import TREASURE_RUSH_CUES, CueSpec
from apps.catalog.models import ContentAsset


def _asset_problem(spec: CueSpec) -> tuple[ContentAsset | None, str | None]:
    asset = ContentAsset.objects.filter(asset_id=spec.asset_id).first()
    if asset is None:
        return None, f"upload an audio asset with id '{spec.asset_id}'"
    if asset.kind != "audio":
        return None, f"asset '{spec.asset_id}' is not an audio asset"
    default = asset.default_version
    if default is None or default.status != VersionStatus.PUBLISHED:
        return None, f"publish a version of asset '{spec.asset_id}'"
    return asset, None


class Command(BaseCommand):
    help = "Create missing Treasure Rush sound cues whose audio exists. Never publishes."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report only; write nothing.")

    def handle(self, *args, **options):
        dry = options["dry_run"]
        created, existing, needs_asset, invalid = [], [], [], []
        with transaction.atomic():
            for spec in TREASURE_RUSH_CUES:
                if SoundCue.objects.filter(cue_id=spec.cue_id).exists():
                    existing.append(spec.cue_id)
                    continue
                asset, problem = _asset_problem(spec)
                if asset is None:
                    needs_asset.append((spec.cue_id, problem))
                    continue
                cue = SoundCue(
                    cue_id=spec.cue_id,
                    name=spec.name,
                    description=spec.description,
                    channel=spec.channel,
                    asset=asset,
                    volume=spec.volume,
                    loop=spec.loop,
                    stream=spec.stream,
                    max_concurrent=spec.max_concurrent,
                    cooldown_ms=spec.cooldown_ms,
                    fade_in_ms=spec.fade_in_ms,
                    fade_out_ms=spec.fade_out_ms,
                    shared=True,
                )
                try:
                    cue.full_clean()
                except ValidationError as error:
                    invalid.append((spec.cue_id, "; ".join(error.messages)))
                    continue
                if not dry:
                    cue.save()
                created.append(spec.cue_id)

        verb = "Would create" if dry else "Created"
        self.stdout.write(f"{verb} {len(created)} cue(s): {', '.join(created) or 'none'}")
        self.stdout.write(f"Already present (untouched): {len(existing)}")
        for cue_id, problem in needs_asset:
            self.stdout.write(f"ASSET NEEDED {cue_id}: {problem}")
        for cue_id, problem in invalid:
            self.stdout.write(f"INVALID {cue_id}: {problem}")
        if created and not dry:
            self.stdout.write(
                "Nothing is live yet. Publish a sound release in Django Admin (Sound releases)."
            )
