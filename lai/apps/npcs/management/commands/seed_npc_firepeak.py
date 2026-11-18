"""Author the Heart of Firepeak NPCs as NPC Manager content (create-only).

    python manage.py seed_npc_firepeak             # create missing rows, then validate
    python manage.py seed_npc_firepeak --publish   # ... and publish a release if anything changed
    python manage.py seed_npc_firepeak --promote   # mark DRAFT characters READY once their model is live

Run order: `load_content` with the Heart of Firepeak export first (the catalog NPCs `flint`,
`kindle`, `professor-basalt`, `cinder`, `ignis`, ADR-054 item 1), then this command. The 3D Area
`firepeak-heart` (the layout seed) is only needed for the placements: without it they are
skipped with a message and created by a later run.

Create-only and safe to rerun, exactly like `seed_npc_pip`: each row (voice profile, model asset
stand-in, character, variant, behaviour profile, placement, persona, dialogue) is created when its
stable key does not exist yet and is never changed once it does. A character is created READY only
when its model asset is already publishable (a published version or a bundled file); otherwise it
is DRAFT, so the real GLBs are not needed to seed but a release cannot carry a missing model.
`--promote` flips only `status` DRAFT to READY, and only for characters whose model is now live.
Releases are global: publishing here also carries every other READY character.

Validation is the release validation (`apps.npcs.publishing.preview`); any problem is listed and the
command fails. Output names rows and keys only, never child data.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.catalog.models import AssetOrigin, ContentAsset, NpcDefinition
from apps.npcs import firepeak_content as fp
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


class Prerequisite(LookupError):
    pass


def _definitions() -> dict[str, NpcDefinition]:
    found = {d.npc_id: d for d in NpcDefinition.objects.filter(npc_id__in=fp.NPC_IDS)}
    missing = [npc_id for npc_id in fp.NPC_IDS if npc_id not in found]
    if missing:
        raise Prerequisite(
            f"The catalog NPCs are missing ({', '.join(missing)}). Run load_content with the "
            "Heart of Firepeak content export first."
        )
    return found


def _model_asset(asset_id: str, name: str) -> tuple[ContentAsset, bool]:
    """The character model asset: an existing one is reused, else a stand-in without a file."""
    asset, created = ContentAsset.objects.get_or_create(
        asset_id=asset_id,
        defaults={
            "kind": "character",
            "category": "npc",
            "origin": AssetOrigin.DJANGO,
            "display_name": f"{name} (Firepeak)",
            "tags": ["firepeak-heart"],
            "clips": list(fp.CLIPS),
        },
    )
    return asset, created


def model_is_live(asset: ContentAsset) -> bool:
    version = asset.default_version
    return bool(asset.bundled_path) or (version is not None and version.is_published)


def _voice_profile(npc: fp.FirepeakNpc):
    from apps.speech.models import VoiceProfile

    voice, engine, rate = npc.voice
    profile, created = VoiceProfile.objects.get_or_create(
        profile_id=npc.npc_id,
        defaults={
            "display_name": npc.name,
            "polly_voice_id": voice,
            "language_code": "en-US",
            "engine": engine,
            "speaking_rate_percent": rate,
            "character_id": npc.npc_id,
        },
    )
    return (profile if profile.enabled else None), created


def _region():
    from apps.regions.models import WorldRegion

    return WorldRegion.objects.select_related("location__world").filter(region_id=fp.REGION_ID).first()


@transaction.atomic
def seed_firepeak() -> tuple[list[str], list[str]]:
    """Create the Firepeak NPC rows that do not exist yet. Returns (created, notes)."""
    definitions = _definitions()
    region = _region()
    created: list[str] = []
    notes: list[str] = []
    if region is None:
        notes.append(
            f"3D Area {fp.REGION_ID} does not exist yet: placements skipped. Seed the area, "
            "then run this command again."
        )

    for npc in fp.NPCS:
        asset, asset_created = _model_asset(npc.asset_id, npc.name)
        if asset_created:
            created.append(f"model asset {npc.asset_id}")
        voice, voice_created = _voice_profile(npc)
        if voice_created:
            created.append(f"voice {npc.npc_id}")

        live = model_is_live(asset)
        character, was_created = NpcCharacter.objects.get_or_create(
            definition=definitions[npc.npc_id],
            defaults={
                "role": npc.role,
                "personality": dict(npc.personality),
                "age_bands": list(fp.AGE_BANDS),
                "status": CharacterStatus.READY if live else CharacterStatus.DRAFT,
                "dialogue_mode": DialogueMode(npc.ai_mode),
                "voice_profile": voice,
                "notes": "Seeded by seed_npc_firepeak.",
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

        if not NpcModelVariant.objects.filter(character=character, variant_key=fp.VARIANT_KEY).exists():
            variant = NpcModelVariant(
                character=character,
                variant_key=fp.VARIANT_KEY,
                display_name=npc.name,
                model_asset=asset,
                animation_map=dict(fp.ANIMATION_MAP),
                is_default=not character.variants.filter(is_default=True).exists(),
            )
            variant.full_clean()
            variant.save()
            created.append(f"variant {npc.npc_id}/{fp.VARIANT_KEY}")
        variant = NpcModelVariant.objects.get(character=character, variant_key=fp.VARIANT_KEY)

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
                placement = NpcPlacement(
                    placement_key=spot.key,
                    character=character,
                    world=place.world,
                    location=place,
                    region=region,
                    variant=variant,
                    behavior=behaviors[spot.behavior],
                    x=spot.x,
                    y=0.0,
                    z=spot.z,
                    rotation_y=spot.yaw,
                    interaction_radius=fp.INTERACTION_RADIUS,
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

        for spec in fp.dialogues(npc):
            if NpcDialogue.objects.filter(character=character, dialogue_key=spec.key).exists():
                continue
            _create_dialogue(character, spec)
            created.append(f"dialogue {npc.npc_id}/{spec.key}")
    return created, notes


@transaction.atomic
def promote_ready() -> list[str]:
    """DRAFT to READY for Firepeak characters whose model is live. Touches `status` only."""
    promoted = []
    for character in NpcCharacter.objects.filter(
        definition__npc_id__in=fp.NPC_IDS, status=CharacterStatus.DRAFT
    ):
        variant = character.variants.filter(is_default=True).select_related("model_asset").first()
        if variant is not None and model_is_live(variant.model_asset):
            character.status = CharacterStatus.READY
            character.full_clean()
            character.save(update_fields=["status"])
            promoted.append(character.slug)
    return promoted


class Command(BaseCommand):
    help = "Author the Heart of Firepeak NPCs as NPC Manager content (create-only), validate, optionally publish."

    def add_arguments(self, parser):
        parser.add_argument(
            "--publish", action="store_true", help="Publish a release when validation passes."
        )
        parser.add_argument(
            "--promote",
            action="store_true",
            help="Mark DRAFT Firepeak characters READY when their model is published.",
        )
        parser.add_argument("--notes", default="seed_npc_firepeak", help="Release notes.")

    def handle(self, *args, publish: bool = False, promote: bool = False, **options):
        try:
            created, notes = seed_firepeak()
        except Prerequisite as error:
            raise CommandError(str(error)) from error
        if created:
            self.stdout.write(f"Firepeak NPCs: created {len(created)}: {', '.join(created)}.")
        else:
            self.stdout.write("Firepeak NPCs: unchanged (every row already exists).")
        if promote:
            done = promote_ready()
            self.stdout.write(f"Promote: {', '.join(done) or 'none'} now READY.")
        for note in notes:
            self.stdout.write(f"  note: {note}")

        result = preview()
        if not publish and result.problems == [NOTHING_READY]:
            # Every character is still DRAFT (models not uploaded): nothing to validate yet.
            self.stdout.write(f"Validation: skipped ({NOTHING_READY}).")
            return
        if result.problems:
            for problem in result.problems:
                self.stdout.write(f"  problem: {problem}")
            raise CommandError(f"Validation failed with {len(result.problems)} problem(s).")
        self.stdout.write("Validation: no problems.")

        if not publish:
            return
        try:
            release = publish_release(None, notes=options.get("notes") or "seed_npc_firepeak")
        except PublishError as error:
            if error.code == "unchanged":
                self.stdout.write("Publish: unchanged (the ACTIVE release already has this).")
                return
            for problem in error.problems:
                self.stdout.write(f"  problem: {problem}")
            raise CommandError(f"Publish refused: {error.code}.") from error
        self.stdout.write(f"Publish: NPC release {release.number} is ACTIVE.")
