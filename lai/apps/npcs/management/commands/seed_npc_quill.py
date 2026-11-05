"""Author Keeper Quill as NPC Manager content for Storykeeper's Castle (LAI-NPC-039).

    python manage.py seed_npc_quill             # create missing rows, then validate
    python manage.py seed_npc_quill --publish   # ... and publish a release if anything changed

Prerequisites: `load_content` (the `keeper-quill` NPC, the `npc-quill` model, the
`storykeeper-castle` Place and Quill's quest). Optional: `seed_speech_voices` first, so Quill's
character is created with his existing `keeper-quill` voice (otherwise captions only until staff
pick a voice in Django Admin).

Create-only and safe to rerun, exactly like `seed_npc_pip`: each row (character, default
variant, behaviour profile, placement, each dialogue with its nodes and choices) is created when
its stable key does not exist yet and is never changed once it does, so staff edits in Django
Admin survive. A rerun with nothing to create reports `unchanged`, and `--publish` reports
`unchanged` when the ACTIVE release already holds this content. Releases are global: publishing
here also carries every other READY character (Pirate Pip included).

The castle has no 3D Area in Django, so the placement is Place-level (`region` null) on the spot
the castle's manifest stands Quill today.

Validation is the release validation (`apps.npcs.publishing.preview`): any problem is listed and
the command fails. Output names rows and keys only, never child data.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.catalog.models import ContentAsset, Location, NpcDefinition, Quest
from apps.npcs import quill_content as quill
from apps.npcs.management.commands.seed_npc_pip import _create_dialogue
from apps.npcs.models import (
    NpcBehaviorProfile,
    NpcCharacter,
    NpcDialogue,
    NpcModelVariant,
    NpcPlacement,
)
from apps.npcs.publishing import PublishError, preview
from apps.npcs.publishing import publish as publish_release
from apps.npcs.vocabulary import CharacterStatus, DialogueMode


class Prerequisite(LookupError):
    pass


def _prerequisites():
    try:
        definition = NpcDefinition.objects.get(npc_id=quill.NPC_ID)
        model = ContentAsset.objects.get(asset_id=quill.MODEL_ASSET_ID)
        place = Location.objects.select_related("world").get(slug=quill.PLACE_SLUG)
        Quest.objects.get(slug=quill.QUEST_ID)
    except (
        NpcDefinition.DoesNotExist,
        ContentAsset.DoesNotExist,
        Location.DoesNotExist,
        Quest.DoesNotExist,
    ) as error:
        raise Prerequisite("Run load_content first.") from error
    return definition, model, place


def animation_map_for(model: ContentAsset) -> dict[str, str]:
    """Quill's map, limited to clips the model declares (an asset without a clip list keeps all)."""
    clips = set(model.clips or [])
    if not clips:
        return dict(quill.ANIMATION_MAP)
    return {state: clip for state, clip in quill.ANIMATION_MAP.items() if clip in clips}


def _voice_profile():
    """Quill's voice from the speech seeds (`seed_speech_voices`) when it exists and is on."""
    from apps.speech.models import VoiceProfile

    return VoiceProfile.objects.filter(profile_id=quill.VOICE_PROFILE_ID, enabled=True).first()


@transaction.atomic
def seed_quill() -> list[str]:
    """Create Quill's NPC Manager rows that do not exist yet. Returns what was created."""
    definition, model, place = _prerequisites()
    created: list[str] = []

    character, was_created = NpcCharacter.objects.get_or_create(
        definition=definition,
        defaults={
            "role": quill.ROLE,
            "personality": dict(quill.PERSONALITY),
            "status": CharacterStatus.READY,
            "dialogue_mode": DialogueMode.AUTHORED,
            "voice_profile": _voice_profile(),
            "notes": "Seeded by seed_npc_quill (LAI-NPC-039).",
        },
    )
    if was_created:
        character.full_clean()
        created.append(f"character {quill.NPC_ID}")

    variant = NpcModelVariant.objects.filter(
        character=character, variant_key=quill.VARIANT_KEY
    ).first()
    if variant is None:
        variant = NpcModelVariant(
            character=character,
            variant_key=quill.VARIANT_KEY,
            display_name="Storykeeper",
            model_asset=model,
            animation_map=animation_map_for(model),
            is_default=not character.variants.filter(is_default=True).exists(),
        )
        variant.full_clean()
        variant.save()
        created.append(f"variant {quill.VARIANT_KEY}")

    behavior = NpcBehaviorProfile.objects.filter(key=quill.BEHAVIOR_KEY).first()
    if behavior is None:
        behavior = NpcBehaviorProfile(
            key=quill.BEHAVIOR_KEY,
            display_name=quill.BEHAVIOR["display_name"],
            behavior_type=quill.BEHAVIOR["type"],
            parameters=quill.BEHAVIOR["parameters"],
        )
        behavior.full_clean()
        behavior.save()
        created.append(f"behaviour {quill.BEHAVIOR_KEY}")

    if not NpcPlacement.objects.filter(location=place, placement_key=quill.PLACEMENT_KEY).exists():
        x, z, yaw = quill.SPOT
        placement = NpcPlacement(
            placement_key=quill.PLACEMENT_KEY,
            character=character,
            world=place.world,
            location=place,
            region=None,
            variant=variant,
            behavior=behavior,
            x=x,
            y=0.0,
            z=z,
            rotation_y=yaw,
            interaction_radius=quill.INTERACTION_RADIUS,
        )
        placement.full_clean()
        placement.save()
        created.append(f"placement {quill.PLACEMENT_KEY}")

    for spec in quill.dialogues():
        if NpcDialogue.objects.filter(character=character, dialogue_key=spec.key).exists():
            continue
        _create_dialogue(character, spec)
        created.append(f"dialogue {spec.key}")
    return created


class Command(BaseCommand):
    help = "Author Keeper Quill as NPC Manager content (create-only), validate, optionally publish."

    def add_arguments(self, parser):
        parser.add_argument(
            "--publish", action="store_true", help="Publish a release when validation passes."
        )
        parser.add_argument("--notes", default="seed_npc_quill", help="Release notes.")

    def handle(self, *args, publish: bool = False, **options):
        try:
            created = seed_quill()
        except Prerequisite as error:
            raise CommandError(str(error)) from error
        if created:
            self.stdout.write(f"Keeper Quill: created {len(created)}: {', '.join(created)}.")
        else:
            self.stdout.write("Keeper Quill: unchanged (every row already exists).")

        result = preview()
        if result.problems:
            for problem in result.problems:
                self.stdout.write(f"  problem: {problem}")
            raise CommandError(f"Validation failed with {len(result.problems)} problem(s).")
        self.stdout.write("Validation: no problems.")

        if not publish:
            return
        try:
            release = publish_release(None, notes=options.get("notes") or "seed_npc_quill")
        except PublishError as error:
            if error.code == "unchanged":
                self.stdout.write("Publish: unchanged (the ACTIVE release already has this).")
                return
            for problem in error.problems:
                self.stdout.write(f"  problem: {problem}")
            raise CommandError(f"Publish refused: {error.code}.") from error
        self.stdout.write(f"Publish: NPC release {release.number} is ACTIVE.")
