"""Author Pirate Pip as NPC Manager content for Treasure Cove (LAI-NPC-018, LAI-NPC-010).

    python manage.py seed_npc_pip                 # create missing rows, then validate
    python manage.py seed_npc_pip --publish       # ... and publish a release if anything changed
    python manage.py seed_npc_pip --hybrid-hints  # first run only: hybrid hints with a persona

Prerequisites: `load_content` (the `pirate-pip` NPC, the `npc-pip` model, Pip's quest) and
`seed_treasure_rush` (the Treasure Cove 3D Area and Pip's spot at Pirate Landing).

Create-only and safe to rerun, like the Treasure Rush seed: each row (character, default
variant, behaviour profile, placement, each dialogue with its nodes and choices, the persona) is
created when its stable key does not exist yet and is never changed once it does, so staff edits
in Django Admin survive. `--hybrid-hints` only shapes rows that are created on that run; switch an
existing Pip to hybrid in Django Admin. A rerun with nothing to create reports `unchanged`, and
`--publish` reports `unchanged` when the ACTIVE release already holds this content.

Validation is the release validation (`apps.npcs.publishing.preview`): any problem is listed and
the command fails. Output names rows and keys only, never child data.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.catalog.models import ContentAsset, NpcDefinition, Quest
from apps.npcs import pip_content as pip
from apps.npcs.models import (
    NpcBehaviorProfile,
    NpcCharacter,
    NpcDialogue,
    NpcDialogueChoice,
    NpcDialogueNode,
    NpcModelVariant,
    NpcPersona,
    NpcPlacement,
    PersonaStatus,
)
from apps.npcs.publishing import PublishError, preview
from apps.npcs.publishing import publish as publish_release
from apps.npcs.vocabulary import CharacterStatus, DialogueMode


class Prerequisite(LookupError):
    pass


def _prerequisites():
    from apps.regions.models import WorldObjectPlacement, WorldRegion

    try:
        definition = NpcDefinition.objects.get(npc_id=pip.NPC_ID)
        model = ContentAsset.objects.get(asset_id=pip.MODEL_ASSET_ID)
        Quest.objects.get(slug=pip.PIPS_QUEST_ID)
        region = WorldRegion.objects.select_related("location__world").get(region_id=pip.AREA_ID)
    except (
        NpcDefinition.DoesNotExist,
        ContentAsset.DoesNotExist,
        Quest.DoesNotExist,
        WorldRegion.DoesNotExist,
    ) as error:
        raise Prerequisite("Run load_content and seed_treasure_rush first.") from error
    legacy = WorldObjectPlacement.objects.filter(
        region=region, entity_id=pip.LEGACY_ENTITY_ID
    ).first()
    return definition, model, region, legacy


def animation_map_for(model: ContentAsset) -> dict[str, str]:
    """Pip's map, limited to clips the model declares (an asset without a clip list keeps all)."""
    clips = set(model.clips or [])
    if not clips:
        return dict(pip.ANIMATION_MAP)
    return {state: clip for state, clip in pip.ANIMATION_MAP.items() if clip in clips}


def _voice_profile():
    """Pip's voice when staff have created one (`speech` seeds none for Pip): else captions."""
    from apps.speech.models import VoiceProfile

    return VoiceProfile.objects.filter(profile_id=pip.NPC_ID, enabled=True).first()


@transaction.atomic
def seed_pip(*, hybrid: bool = False) -> list[str]:
    """Create Pip's NPC Manager rows that do not exist yet. Returns what was created."""
    definition, model, region, legacy = _prerequisites()
    created: list[str] = []

    character, was_created = NpcCharacter.objects.get_or_create(
        definition=definition,
        defaults={
            "role": pip.ROLE,
            "personality": dict(pip.PERSONALITY),
            "status": CharacterStatus.READY,
            "dialogue_mode": DialogueMode.HYBRID if hybrid else DialogueMode.AUTHORED,
            "voice_profile": _voice_profile(),
            "notes": "Seeded by seed_npc_pip (LAI-NPC-018).",
        },
    )
    if was_created:
        character.full_clean()
        created.append(f"character {pip.NPC_ID}")

    variant = NpcModelVariant.objects.filter(
        character=character, variant_key=pip.VARIANT_KEY
    ).first()
    if variant is None:
        variant = NpcModelVariant(
            character=character,
            variant_key=pip.VARIANT_KEY,
            display_name="Classic",
            model_asset=model,
            animation_map=animation_map_for(model),
            is_default=not character.variants.filter(is_default=True).exists(),
        )
        variant.full_clean()
        variant.save()
        created.append(f"variant {pip.VARIANT_KEY}")

    behavior = NpcBehaviorProfile.objects.filter(key=pip.BEHAVIOR_KEY).first()
    if behavior is None:
        behavior = NpcBehaviorProfile(
            key=pip.BEHAVIOR_KEY,
            display_name=pip.BEHAVIOR["display_name"],
            behavior_type=pip.BEHAVIOR["type"],
            parameters=pip.BEHAVIOR["parameters"],
        )
        behavior.full_clean()
        behavior.save()
        created.append(f"behaviour {pip.BEHAVIOR_KEY}")

    place = region.location
    if not NpcPlacement.objects.filter(location=place, placement_key=pip.PLACEMENT_KEY).exists():
        x, z, yaw = (
            (legacy.x, legacy.z, legacy.rotation_y) if legacy is not None else pip.DEFAULT_SPOT
        )
        placement = NpcPlacement(
            placement_key=pip.PLACEMENT_KEY,
            character=character,
            world=place.world,
            location=place,
            region=region,
            variant=variant,
            behavior=behavior,
            x=x,
            y=legacy.elevation if legacy is not None else 0.0,
            z=z,
            rotation_y=yaw,
            interaction_radius=pip.INTERACTION_RADIUS,
        )
        placement.full_clean()
        placement.save()
        created.append(f"placement {pip.PLACEMENT_KEY}")

    for spec in pip.dialogues(hybrid=hybrid):
        if NpcDialogue.objects.filter(character=character, dialogue_key=spec.key).exists():
            continue
        _create_dialogue(character, spec)
        created.append(f"dialogue {spec.key}")

    if hybrid and not character.personas.exists():
        persona = NpcPersona(
            character=character,
            version=pip.PERSONA["version"],
            status=PersonaStatus.APPROVED,
            personality_prompt=pip.PERSONA["personality_prompt"],
            permitted_topics=list(pip.PERSONA["permitted_topics"]),
            max_response_chars=pip.PERSONA["max_response_chars"],
            fallback_lines=list(pip.PERSONA["fallback_lines"]),
        )
        persona.full_clean()
        persona.save()
        created.append(f"persona v{persona.version}")
    return created


def _create_dialogue(character: NpcCharacter, spec: pip.Dialogue) -> NpcDialogue:
    dialogue = NpcDialogue(
        character=character,
        dialogue_key=spec.key,
        title=spec.title,
        trigger=spec.trigger,
        conditions=[dict(c) for c in spec.conditions],
        priority=spec.priority,
        once_per_child=spec.once_per_child,
    )
    dialogue.full_clean()
    dialogue.save()
    nodes: dict[str, NpcDialogueNode] = {}
    for order, node in enumerate(spec.nodes):
        row = NpcDialogueNode(
            dialogue=dialogue,
            node_key=node.key,
            text=node.text,
            emotion=node.emotion,
            animation_state=node.animation,
            allow_ai_hint=node.allow_ai_hint,
            allowed_topic=node.allowed_topic,
            sort_order=order,
        )
        row.full_clean()
        row.save()
        nodes[node.key] = row
    for node in spec.nodes:
        row = nodes[node.key]
        if node.next:
            row.next_node = nodes[node.next]
            row.full_clean()
            row.save(update_fields=["next_node"])
        for order, choice in enumerate(node.choices):
            choice_row = NpcDialogueChoice(
                node=row,
                choice_key=choice.key,
                label=choice.label,
                next_node=nodes[choice.next] if choice.next else None,
                action=choice.action,
                action_value=choice.value,
                sort_order=order,
            )
            choice_row.full_clean()
            choice_row.save()
    dialogue.start_node = nodes[spec.nodes[0].key]
    dialogue.full_clean()
    dialogue.save(update_fields=["start_node"])
    return dialogue


class Command(BaseCommand):
    help = "Author Pirate Pip as NPC Manager content (create-only), validate, optionally publish."

    def add_arguments(self, parser):
        parser.add_argument(
            "--publish", action="store_true", help="Publish a release when validation passes."
        )
        parser.add_argument(
            "--hybrid-hints",
            action="store_true",
            help="Rows created on this run use hybrid AI hints (approved persona, fallback lines).",
        )
        parser.add_argument("--notes", default="seed_npc_pip", help="Release notes.")

    def handle(self, *args, publish: bool = False, hybrid_hints: bool = False, **options):
        try:
            created = seed_pip(hybrid=hybrid_hints)
        except Prerequisite as error:
            raise CommandError(str(error)) from error
        if created:
            self.stdout.write(f"Pirate Pip: created {len(created)}: {', '.join(created)}.")
        else:
            self.stdout.write("Pirate Pip: unchanged (every row already exists).")

        result = preview()
        if result.problems:
            for problem in result.problems:
                self.stdout.write(f"  problem: {problem}")
            raise CommandError(f"Validation failed with {len(result.problems)} problem(s).")
        self.stdout.write("Validation: no problems.")

        if not publish:
            return
        try:
            release = publish_release(None, notes=options.get("notes") or "seed_npc_pip")
        except PublishError as error:
            if error.code == "unchanged":
                self.stdout.write("Publish: unchanged (the ACTIVE release already has this).")
                return
            for problem in error.problems:
                self.stdout.write(f"  problem: {problem}")
            raise CommandError(f"Publish refused: {error.code}.") from error
        self.stdout.write(f"Publish: NPC release {release.number} is ACTIVE.")
