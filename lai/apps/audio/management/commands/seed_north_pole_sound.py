"""Create North Pole's sound cues and assignments, create-only.

    python manage.py seed_north_pole_sound            # create what can be, report the rest
    python manage.py seed_north_pole_sound --dry-run  # report only, write nothing

Rules, as for `seed_firepeak_sound`:

- Create-only and idempotent. An existing cue or assignment is never changed.
- A cue is created only when its audio asset exists in the Asset Library (asset id = the cue id
  with dashes), is audio, suits the channel and has a PUBLISHED default version. Otherwise it is
  reported as an asset requirement. No file is substituted and no placeholder is made.
- Assignments are created for the `north-pole-village` 3D Area only when the Area exists, its
  layout declares the zone, and the cue exists. Until the Area exists the assignments are skipped
  with a message and the cues are still created.
- Never publishes. Staff publish a sound release in Django Admin.
"""

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand
from django.db import IntegrityError, transaction

from apps.audio.management.commands.seed_treasure_rush_sound import _asset_problem
from apps.audio.models import SoundAssignment, SoundCue
from apps.audio.north_pole_cues import (
    NORTH_POLE_CUES,
    NORTH_POLE_REGION_ID,
    NORTH_POLE_ZONE_AMBIENCE,
)
from apps.regions.models import WorldRegion

#: (target_type, target_id, event, cue id, note). The zone ambience beds are added from
#: `NORTH_POLE_ZONE_AMBIENCE`. The adventure-level quest slot is the story's last quest.
NORTH_POLE_ASSIGNMENTS: tuple[tuple[str, str, str, str, str], ...] = (
    ("scope", "", "on_enter", "music.north_pole.village", "North Pole music state"),
    (
        "quest",
        "np-q09-christmas-eve",
        "on_complete",
        "music.north_pole.celebration",
        "Celebration music",
    ),
    ("quest", "np-q09-christmas-eve", "on_complete", "sfx.north_pole.quest_complete", "Quest done"),
)


class Command(BaseCommand):
    help = "Create missing North Pole sound cues and Area assignments. Create-only, never publishes."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report only; write nothing.")

    def handle(self, *args, **options):
        dry = options["dry_run"]
        created, existing, needs_asset, invalid = [], [], [], []
        with transaction.atomic():
            for spec in NORTH_POLE_CUES:
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
            made, kept, skipped = self._assignments(dry)

        verb = "Would create" if dry else "Created"
        out = self.stdout.write
        out(f"{verb} {len(created)} cue(s): {', '.join(created) or 'none'}")
        out(f"Cues already present (untouched): {len(existing)}")
        for cue_id, problem in needs_asset:
            out(f"ASSET NEEDED {cue_id}: {problem}")
        for cue_id, problem in invalid:
            out(f"INVALID {cue_id}: {problem}")
        out(f"{verb} {len(made)} assignment(s); already present (untouched): {kept}")
        for message in skipped:
            out(f"ASSIGNMENT SKIPPED {message}")
        if (created or made) and not dry:
            out("Nothing is live yet. Publish a sound release in Django Admin (Sound releases).")

    def _assignments(self, dry: bool) -> tuple[list[str], int, list[str]]:
        made: list[str] = []
        kept = 0
        skipped: list[str] = []
        region = WorldRegion.objects.filter(region_id=NORTH_POLE_REGION_ID).first()
        if region is None:
            skipped.append(
                f"all: 3D Area '{NORTH_POLE_REGION_ID}' does not exist yet; "
                "run this command again after the area seed"
            )
            return made, kept, skipped
        wanted = [
            ("zone", zone_id, "on_enter", cue_id, f"{zone_id} ambience")
            for zone_id, cue_id in NORTH_POLE_ZONE_AMBIENCE.items()
        ]
        wanted += list(NORTH_POLE_ASSIGNMENTS)
        for target_type, target_id, event, cue_id, note in wanted:
            label = f"{target_type}:{target_id or 'area'} {event} -> {cue_id}"
            cue = SoundCue.objects.filter(cue_id=cue_id).first()
            if cue is None:
                skipped.append(f"{label}: the cue does not exist yet (audio needed)")
                continue
            if SoundAssignment.objects.filter(
                region=region,
                target_type=target_type,
                target_id=target_id,
                event=event,
                channel=cue.channel,
            ).exists():
                kept += 1
                continue
            assignment = SoundAssignment(
                region=region,
                target_type=target_type,
                target_id=target_id,
                event=event,
                cue=cue,
                note=note[:200],
            )
            try:
                assignment.full_clean()
            except ValidationError as error:
                skipped.append(f"{label}: {'; '.join(error.messages)}")
                continue
            if not dry:
                try:
                    with transaction.atomic():
                        assignment.save()
                except IntegrityError:
                    kept += 1
                    continue
            made.append(label)
        return made, kept, skipped
