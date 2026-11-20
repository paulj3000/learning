"""Create-only seeding of a castle character as NPC Manager rows (SC-R05-02, SC-R05-03).

`seed_npc_ember` and `seed_npc_orion` share this. It is `seed_npc_quill` without the quest: the
content module (`ember_content`, `orion_content`) names the character, its model, variant,
behaviour, Place-level placement (with optional spawn conditions and a sort order) and dialogues,
and every row is created only when its stable key does not exist yet. A row that exists is never
changed, so staff edits in Django Admin survive a rerun. Validation and publishing are the release
ones (`apps.npcs.publishing`), driven by `run_seed_command`.

Output names rows and keys only, never child data.
"""

from __future__ import annotations

from types import ModuleType

from django.core.management.base import CommandError
from django.db import transaction

from apps.catalog.models import ContentAsset, Location, NpcDefinition
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


def _prerequisites(content: ModuleType):
    try:
        definition = NpcDefinition.objects.get(npc_id=content.NPC_ID)
        model = ContentAsset.objects.get(asset_id=content.MODEL_ASSET_ID)
        place = Location.objects.select_related("world").get(slug=content.PLACE_SLUG)
    except (NpcDefinition.DoesNotExist, ContentAsset.DoesNotExist, Location.DoesNotExist) as error:
        raise Prerequisite("Run load_content first.") from error
    return definition, model, place


def animation_map_for(content: ModuleType, model: ContentAsset) -> dict[str, str]:
    """The content's map, limited to clips the model declares (no clip list keeps all)."""
    clips = set(model.clips or [])
    if not clips:
        return dict(content.ANIMATION_MAP)
    return {state: clip for state, clip in content.ANIMATION_MAP.items() if clip in clips}


@transaction.atomic
def seed_castle_npc(content: ModuleType, command: str) -> list[str]:
    """Create the rows of `content` that do not exist yet. Returns what was created."""
    definition, model, place = _prerequisites(content)
    created: list[str] = []

    character, was_created = NpcCharacter.objects.get_or_create(
        definition=definition,
        defaults={
            "role": content.ROLE,
            "personality": dict(content.PERSONALITY),
            "status": CharacterStatus.READY,
            "dialogue_mode": DialogueMode.AUTHORED,
            "notes": f"Seeded by {command}.",
        },
    )
    if was_created:
        character.full_clean()
        created.append(f"character {content.NPC_ID}")

    variant = NpcModelVariant.objects.filter(
        character=character, variant_key=content.VARIANT_KEY
    ).first()
    if variant is None:
        variant = NpcModelVariant(
            character=character,
            variant_key=content.VARIANT_KEY,
            display_name=content.VARIANT_NAME,
            model_asset=model,
            animation_map=animation_map_for(content, model),
            is_default=not character.variants.filter(is_default=True).exists(),
        )
        variant.full_clean()
        variant.save()
        created.append(f"variant {content.VARIANT_KEY}")

    behavior = NpcBehaviorProfile.objects.filter(key=content.BEHAVIOR_KEY).first()
    if behavior is None:
        behavior = NpcBehaviorProfile(
            key=content.BEHAVIOR_KEY,
            display_name=content.BEHAVIOR["display_name"],
            behavior_type=content.BEHAVIOR["type"],
            parameters=content.BEHAVIOR["parameters"],
        )
        behavior.full_clean()
        behavior.save()
        created.append(f"behaviour {content.BEHAVIOR_KEY}")

    if not NpcPlacement.objects.filter(
        location=place, placement_key=content.PLACEMENT_KEY
    ).exists():
        x, z, yaw = content.SPOT
        placement = NpcPlacement(
            placement_key=content.PLACEMENT_KEY,
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
            interaction_radius=content.INTERACTION_RADIUS,
            spawn_conditions=[dict(c) for c in content.SPAWN_CONDITIONS],
            sort_order=content.SORT_ORDER,
        )
        placement.full_clean()
        placement.save()
        created.append(f"placement {content.PLACEMENT_KEY}")

    for spec in content.dialogues():
        if NpcDialogue.objects.filter(character=character, dialogue_key=spec.key).exists():
            continue
        _create_dialogue(character, spec)
        created.append(f"dialogue {spec.key}")
    return created


def run_seed_command(
    cmd, content: ModuleType, name: str, command: str, *, publish: bool, notes: str
) -> None:
    """Seed, validate, and optionally publish, writing progress to `cmd.stdout`."""
    try:
        created = seed_castle_npc(content, command)
    except Prerequisite as error:
        raise CommandError(str(error)) from error
    if created:
        cmd.stdout.write(f"{name}: created {len(created)}: {', '.join(created)}.")
    else:
        cmd.stdout.write(f"{name}: unchanged (every row already exists).")

    result = preview()
    if result.problems:
        for problem in result.problems:
            cmd.stdout.write(f"  problem: {problem}")
        raise CommandError(f"Validation failed with {len(result.problems)} problem(s).")
    cmd.stdout.write("Validation: no problems.")

    if not publish:
        return
    try:
        release = publish_release(None, notes=notes)
    except PublishError as error:
        if error.code == "unchanged":
            cmd.stdout.write("Publish: unchanged (the ACTIVE release already has this).")
            return
        for problem in error.problems:
            cmd.stdout.write(f"  problem: {problem}")
        raise CommandError(f"Publish refused: {error.code}.") from error
    cmd.stdout.write(f"Publish: NPC release {release.number} is ACTIVE.")
