"""Author the North Pole NPCs as NPC Manager content (NP-020, create-only).

    python manage.py seed_npc_north_pole             # create missing rows, then validate
    python manage.py seed_npc_north_pole --publish   # ... and publish a release if anything changed
    python manage.py seed_npc_north_pole --promote   # mark DRAFT characters READY once their model is live

Run order: `load_content` with the North Pole export (the ten catalog NPCs and the nine quests),
`seed_north_pole` (the `north-pole-village` 3D Area, whose NPC placements give the spots, and the
character ContentAssets `north-pole-santa` ... `north-pole-reindeer-calf`), then this command.

Missing prerequisites never crash the command. A character whose catalog NPC, model asset or
quests are missing is skipped with a clear message and created by a later run; without the 3D
Area the placements are skipped the same way. Nothing is published unless `--publish` is given.

Create-only and safe to rerun, exactly like `seed_npc_firepeak`: each row (voice profile,
character, variant, behaviour profile, placement, persona, dialogue) is created when its stable
key does not exist yet and is never changed once it does. A character is created READY only when
its model asset is already publishable (a published version or a bundled file); otherwise it is
DRAFT, so a release cannot carry a missing model. `--promote` flips only `status` DRAFT to READY,
and only for characters whose model is now live. Releases are global: publishing here also
carries every other READY character.

Voice profiles are created with the Polly voice ids of the contract; speech stays fake or
disabled until staff enable the live provider. Output names rows and keys only, never child data.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.catalog.models import ContentAsset, NpcDefinition, Quest
from apps.npcs import north_pole_content as np
from apps.npcs.management.commands.seed_npc_pip import _create_dialogue
from apps.npcs.models import (
    NpcBehaviorProfile,
    NpcCharacter,
    NpcDialogue,
    NpcModelVariant,
    NpcPersona,
    NpcPlacement,
    PersonaStatus,
)
from apps.npcs.publishing import PublishError, preview
from apps.npcs.publishing import publish as publish_release
from apps.npcs.vocabulary import CharacterStatus, DialogueMode

NOTHING_READY = "there is no READY character to publish"


def model_is_live(asset: ContentAsset) -> bool:
    version = asset.default_version
    return bool(asset.bundled_path) or (version is not None and version.is_published)


def animation_map_for(npc: np.NorthPoleNpc, asset: ContentAsset) -> dict[str, str]:
    """The map limited to the clips the asset declares (an asset with no clip list keeps all)."""
    clips = set(asset.clips or [])
    if not clips:
        return dict(npc.animation_map)
    return {state: clip for state, clip in npc.animation_map.items() if clip in clips}


def _voice_profile(npc: np.NorthPoleNpc, notes: list[str]):
    """The character's voice profile (id = npc id), created when missing. None: captions only."""
    if npc.voice is None:
        return None, False
    from apps.speech import voices
    from apps.speech.models import VoiceProfile

    voice, language, engine, rate = npc.voice
    problem = voices.voice_problem(voice, language, engine)
    if problem is not None:
        notes.append(f"{npc.npc_id}: no voice profile ({problem})")
        return None, False
    profile, created = VoiceProfile.objects.get_or_create(
        profile_id=npc.npc_id,
        defaults={
            "display_name": npc.name,
            "polly_voice_id": voice,
            "language_code": language,
            "engine": engine,
            "speaking_rate_percent": rate,
            "character_id": npc.npc_id,
        },
    )
    return (profile if profile.enabled else None), created


def _region():
    from apps.regions.models import WorldRegion

    return (
        WorldRegion.objects.select_related("location__world").filter(region_id=np.REGION_ID).first()
    )


def _area_spot(region, spot: np.Spot) -> tuple[float, float, float, float, float] | None:
    """(x, y, z, rotation, scale) from the Area's NPC placement, else the spot's fallback."""
    from apps.regions.models import PlacementKind

    row = region.placements.filter(kind=PlacementKind.NPC, entity_id=spot.entity_id).first()
    if row is not None:
        return row.x, row.elevation, row.z, row.rotation_y, row.scale
    if spot.fallback is not None:
        return spot.fallback[0], 0.0, spot.fallback[1], 0.0, 1.0
    return None


def _missing(npc: np.NorthPoleNpc, definitions, assets) -> str | None:
    if npc.npc_id not in definitions:
        return f"catalog NPC {npc.npc_id} (run load_content with the North Pole export)"
    if npc.asset_id not in assets:
        return f"character asset {npc.asset_id} (run seed_north_pole)"
    wanted = {offer.quest_id for offer in npc.offers}
    absent = wanted - set(Quest.objects.filter(slug__in=wanted).values_list("slug", flat=True))
    if absent:
        return f"quest {', '.join(sorted(absent))} (run load_content with the North Pole export)"
    return None


@transaction.atomic
def seed_north_pole() -> tuple[list[str], list[str]]:
    """Create the North Pole NPC rows that do not exist yet. Returns (created, notes)."""
    definitions = {d.npc_id: d for d in NpcDefinition.objects.filter(npc_id__in=np.NPC_IDS)}
    assets = {
        a.asset_id: a
        for a in ContentAsset.objects.filter(asset_id__in=[n.asset_id for n in np.NPCS])
    }
    region = _region()
    created: list[str] = []
    notes: list[str] = []
    if region is None:
        notes.append(
            f"3D Area {np.REGION_ID} does not exist yet: placements skipped. Run seed_north_pole, "
            "then run this command again."
        )

    for npc in np.NPCS:
        missing = _missing(npc, definitions, assets)
        if missing is not None:
            notes.append(f"{npc.npc_id} skipped: missing {missing}.")
            continue
        asset = assets[npc.asset_id]
        voice, voice_created = _voice_profile(npc, notes)
        if voice_created:
            created.append(f"voice {npc.npc_id}")

        live = model_is_live(asset)
        character, was_created = NpcCharacter.objects.get_or_create(
            definition=definitions[npc.npc_id],
            defaults={
                "role": npc.role,
                "personality": dict(npc.personality),
                "age_bands": list(np.AGE_BANDS),
                "status": CharacterStatus.READY if live else CharacterStatus.DRAFT,
                "dialogue_mode": DialogueMode(npc.ai_mode),
                "voice_profile": voice,
                "notes": "Seeded by seed_npc_north_pole.",
            },
        )
        if was_created:
            character.full_clean()
            created.append(f"character {npc.npc_id}")
            if not live:
                notes.append(
                    f"{npc.npc_id} is DRAFT: upload {npc.asset_id} and run --promote "
                    "(or set it READY in Django Admin)."
                )

        if not NpcModelVariant.objects.filter(
            character=character, variant_key=np.VARIANT_KEY
        ).exists():
            variant = NpcModelVariant(
                character=character,
                variant_key=np.VARIANT_KEY,
                display_name=npc.name,
                model_asset=asset,
                animation_map=animation_map_for(npc, asset),
                is_default=not character.variants.filter(is_default=True).exists(),
            )
            variant.full_clean()
            variant.save()
            created.append(f"variant {npc.npc_id}/{np.VARIANT_KEY}")
        variant = NpcModelVariant.objects.get(character=character, variant_key=np.VARIANT_KEY)

        behaviors: dict[str, NpcBehaviorProfile] = {}
        for key, spec in npc.behaviors.items():
            row = NpcBehaviorProfile.objects.filter(key=key).first()
            if row is None:
                row = NpcBehaviorProfile(
                    key=key,
                    display_name=spec["display_name"],
                    behavior_type=spec["type"],
                    parameters=spec["parameters"],
                )
                row.full_clean()
                row.save()
                created.append(f"behaviour {key}")
            behaviors[key] = row

        if region is not None:
            place = region.location
            for order, spot in enumerate(npc.spots):
                if NpcPlacement.objects.filter(location=place, placement_key=spot.key).exists():
                    continue
                where = _area_spot(region, spot)
                if where is None:
                    notes.append(
                        f"{spot.key} skipped: the Area has no NPC placement {spot.entity_id}."
                    )
                    continue
                x, y, z, rotation, scale = where
                placement = NpcPlacement(
                    placement_key=spot.key,
                    character=character,
                    world=place.world,
                    location=place,
                    region=region,
                    variant=variant,
                    behavior=behaviors[spot.behavior],
                    x=x,
                    y=y,
                    z=z,
                    rotation_y=rotation,
                    scale=scale,
                    interaction_radius=np.INTERACTION_RADIUS,
                    spawn_conditions=[dict(c) for c in spot.spawn_conditions],
                    sort_order=order,
                )
                placement.full_clean()
                placement.save()
                created.append(f"placement {spot.key}")

        if not character.personas.exists():
            persona = NpcPersona(
                character=character,
                version=1,
                status=PersonaStatus.APPROVED,
                personality_prompt=npc.persona_prompt,
                permitted_topics=list(npc.persona_topics),
                max_response_chars=npc.max_response_chars,
                fallback_lines=list(npc.fallback_lines),
            )
            persona.full_clean()
            persona.save()
            created.append(f"persona {npc.npc_id} v1")

        for spec in np.dialogues(npc):
            if NpcDialogue.objects.filter(character=character, dialogue_key=spec.key).exists():
                continue
            _create_dialogue(character, spec)
            created.append(f"dialogue {npc.npc_id}/{spec.key}")
    return created, notes


@transaction.atomic
def promote_ready() -> list[str]:
    """DRAFT to READY for North Pole characters whose model is live. Touches `status` only."""
    promoted = []
    for character in NpcCharacter.objects.filter(
        definition__npc_id__in=np.NPC_IDS, status=CharacterStatus.DRAFT
    ):
        variant = character.variants.filter(is_default=True).select_related("model_asset").first()
        if variant is not None and model_is_live(variant.model_asset):
            character.status = CharacterStatus.READY
            character.full_clean()
            character.save(update_fields=["status"])
            promoted.append(character.slug)
    return promoted


class Command(BaseCommand):
    help = "Author the North Pole NPCs as NPC Manager content (create-only), validate, optionally publish."

    def add_arguments(self, parser):
        parser.add_argument(
            "--publish", action="store_true", help="Publish a release when validation passes."
        )
        parser.add_argument(
            "--promote",
            action="store_true",
            help="Mark DRAFT North Pole characters READY when their model is published.",
        )
        parser.add_argument("--notes", default="seed_npc_north_pole", help="Release notes.")

    def handle(self, *args, publish: bool = False, promote: bool = False, **options):
        created, notes = seed_north_pole()
        if created:
            self.stdout.write(f"North Pole NPCs: created {len(created)}: {', '.join(created)}.")
        else:
            self.stdout.write("North Pole NPCs: unchanged (nothing to create).")
        if promote:
            done = promote_ready()
            self.stdout.write(f"Promote: {', '.join(done) or 'none'} now READY.")
        for note in notes:
            self.stdout.write(f"  note: {note}")

        result = preview()
        if not publish and result.problems == [NOTHING_READY]:
            self.stdout.write(f"Validation: skipped ({NOTHING_READY}).")
            return
        if result.problems:
            for problem in result.problems:
                self.stdout.write(f"  problem: {problem}")
            if publish and result.problems == [NOTHING_READY]:
                self.stdout.write("Publish: skipped, no READY character.")
                return
            raise CommandError(f"Validation failed with {len(result.problems)} problem(s).")
        self.stdout.write("Validation: no problems.")

        if not publish:
            return
        try:
            release = publish_release(None, notes=options.get("notes") or "seed_npc_north_pole")
        except PublishError as error:
            if error.code == "unchanged":
                self.stdout.write("Publish: unchanged (the ACTIVE release already has this).")
                return
            for problem in error.problems:
                self.stdout.write(f"  problem: {problem}")
            raise CommandError(f"Publish refused: {error.code}.") from error
        self.stdout.write(f"Publish: NPC release {release.number} is ACTIVE.")
