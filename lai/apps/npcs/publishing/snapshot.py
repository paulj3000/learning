"""Builds the published release snapshot (LAI-NPC-034, release format v1).

The snapshot *is* the published contract: the runtime API serves it (minus server-only fields),
and nothing a child sees comes from draft rows. Format (docs/NPC_MANAGER_CONTRACTS.md, section 3):

    {"schemaVersion": 1,
     "characters": {"<npcId>": Character},
     "placements": [Placement],
     "behaviors": {"<key>": {"type", "parameters"}}}

Asset references are frozen at publish time: `{"assetId", "version"}` where `version` is the
published `AssetVersion.number` the release resolved, or null for a bundled-only export asset.
The runtime asks the asset resolver for `assetId@version` (or `assetId` when null).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from apps.catalog.models import AssetStatus, ContentAsset

from ..behaviors import runtime_parameters
from ..models import (
    NpcBehaviorProfile,
    NpcCharacter,
    NpcDialogue,
    NpcModelVariant,
    NpcPersona,
    NpcPlacement,
    PersonaStatus,
)
from ..vocabulary import SNAPSHOT_SCHEMA_VERSION, CharacterStatus


@dataclass
class AssetUse:
    asset_id: str
    version_pk: int | None
    usage: str


@dataclass
class Built:
    snapshot: dict
    problems: list[str] = field(default_factory=list)
    asset_uses: list[AssetUse] = field(default_factory=list)


def asset_ref(
    asset: ContentAsset | None, pinned, usage: str, built: Built, kinds: tuple[str, ...]
) -> dict | None:
    """The frozen reference for one asset, recording its use and any problem."""
    if asset is None:
        return None
    where = f"{usage}: asset {asset.asset_id}"
    if asset.status == AssetStatus.RETIRED:
        built.problems.append(f"{where} is retired")
    if kinds and asset.kind not in kinds:
        built.problems.append(f"{where} is a {asset.kind}, expected {' or '.join(kinds)}")
    version = pinned if pinned is not None else asset.default_version
    if version is not None:
        if not version.is_published:
            built.problems.append(f"{where} version {version.number} is not published")
        built.asset_uses.append(AssetUse(asset.asset_id, version.pk, usage))
        return {"assetId": asset.asset_id, "version": version.number}
    if asset.bundled_path:
        built.asset_uses.append(AssetUse(asset.asset_id, None, usage))
        return {"assetId": asset.asset_id, "version": None}
    built.problems.append(f"{where} has no published version")
    return {"assetId": asset.asset_id, "version": None}


def _variant(variant: NpcModelVariant, npc_id: str, built: Built) -> dict:
    where = f"{npc_id} variant {variant.variant_key}"
    return {
        "variantKey": variant.variant_key,
        "displayName": variant.display_name or variant.variant_key,
        "model": asset_ref(
            variant.model_asset, variant.pinned_version, f"{where} model", built, ("character",)
        ),
        "portrait": asset_ref(
            variant.portrait_asset, None, f"{where} portrait", built, ("image", "sprite")
        ),
        "scale": variant.scale,
        "rotationOffsetY": variant.rotation_offset_y,
        "positionOffsetY": variant.position_offset_y,
        "animationMap": dict(variant.animation_map),
        "availability": list(variant.availability),
        "isDefault": variant.is_default,
        "extras": [
            {
                "role": extra.role,
                "asset": asset_ref(extra.asset, None, f"{where} {extra.role.lower()}", built, ()),
                "attachPoint": extra.attach_point,
            }
            for extra in variant.extras.all()
        ],
    }


def _dialogue(dialogue: NpcDialogue, npc_id: str, built: Built) -> dict:
    nodes = list(dialogue.nodes.all())
    keys = {node.pk: node.node_key for node in nodes}
    where = f"{npc_id} dialogue {dialogue.dialogue_key}"
    return {
        "dialogueKey": dialogue.dialogue_key,
        "trigger": dialogue.trigger,
        "mode": dialogue.mode,
        "ageBands": list(dialogue.age_bands),
        "conditions": list(dialogue.conditions),
        "priority": dialogue.priority,
        "oncePerChild": dialogue.once_per_child,
        "startNode": keys.get(dialogue.start_node_id),
        "nodes": [
            {
                "nodeKey": node.node_key,
                "text": node.text,
                "emotion": node.emotion,
                "animationState": node.animation_state or None,
                "audio": asset_ref(
                    node.audio_asset, None, f"{where} {node.node_key} audio", built, ("audio",)
                ),
                "ageBands": list(node.age_bands),
                "conditions": list(node.conditions),
                "next": keys.get(node.next_node_id),
                "allowAiHint": node.allow_ai_hint,
                "allowedTopic": node.allowed_topic,
                "choices": [
                    {
                        "choiceKey": choice.choice_key,
                        "label": choice.label,
                        "next": keys.get(choice.next_node_id),
                        "conditions": list(choice.conditions),
                        "action": choice.action,
                        "actionValue": choice.action_value or None,
                    }
                    for choice in node.choices.all()
                ],
            }
            for node in nodes
        ],
    }


def _persona(persona: NpcPersona | None) -> dict | None:
    if persona is None:
        return None
    return {
        "version": persona.version,
        "personalityPrompt": persona.personality_prompt,
        "permittedTopics": list(persona.permitted_topics),
        "ageBands": list(persona.age_bands),
        "maxResponseChars": persona.max_response_chars,
        "fallbackLines": list(persona.fallback_lines),
    }


def build_snapshot() -> Built:
    """The snapshot of every READY character on an active NPC definition, with its problems."""
    built = Built(snapshot={})
    characters_qs = (
        NpcCharacter.objects.filter(status=CharacterStatus.READY, definition__active=True)
        .select_related("definition", "voice_profile")
        .prefetch_related(
            "variants__model_asset__default_version",
            "variants__pinned_version",
            "variants__portrait_asset__default_version",
            "variants__extras__asset__default_version",
            "dialogues__nodes__choices",
            "dialogues__nodes__audio_asset__default_version",
        )
        .order_by("definition__npc_id")
    )
    characters: dict[str, dict] = {}
    for character in characters_qs:
        npc_id = character.slug
        variants = list(character.variants.all())
        default = next((v for v in variants if v.is_default), None)
        if not variants:
            built.problems.append(f"{npc_id} has no model variant")
        elif default is None:
            built.problems.append(f"{npc_id} has no default model variant")
        persona = NpcPersona.objects.filter(
            character=character, status=PersonaStatus.APPROVED
        ).first()
        voice = character.voice_profile
        if voice is not None and not voice.enabled:
            built.problems.append(f"{npc_id} voice profile {voice.profile_id} is disabled")
        characters[npc_id] = {
            "npcId": npc_id,
            "displayName": character.definition.display_name,
            "role": character.role,
            "ageBands": list(character.age_bands),
            "personality": dict(character.personality),
            "dialogueMode": character.dialogue_mode,
            "voiceProfile": voice.profile_id if voice is not None else None,
            "defaultVariant": default.variant_key if default else None,
            "variants": [_variant(v, npc_id, built) for v in variants],
            "dialogues": [
                _dialogue(d, npc_id, built) for d in character.dialogues.all() if d.active
            ],
            "persona": _persona(persona),
        }

    placements = []
    behavior_keys: set[str] = set()
    placement_qs = (
        NpcPlacement.objects.filter(active=True, character__definition__npc_id__in=characters)
        .select_related("character__definition", "world", "location", "region", "variant")
        .select_related("behavior")
        .order_by("location__slug", "sort_order", "placement_key")
    )
    for placement in placement_qs:
        where = f"placement {placement.location.slug}/{placement.placement_key}"
        if not placement.location.active or not placement.world.active:
            built.problems.append(f"{where}: its Island or Place is inactive")
        if placement.behavior_id:
            behavior_keys.add(placement.behavior.key)
        placements.append(
            {
                "placementKey": placement.placement_key,
                "npcId": placement.character.slug,
                "island": placement.world.slug,
                "place": placement.location.slug,
                "area": placement.region.region_id if placement.region_id else None,
                "variant": placement.variant.variant_key if placement.variant_id else None,
                "behavior": placement.behavior.key if placement.behavior_id else None,
                "position": {"x": placement.x, "y": placement.y, "z": placement.z},
                "rotationY": placement.rotation_y,
                "scale": placement.scale,
                "interactionRadius": placement.interaction_radius,
                "spawnConditions": list(placement.spawn_conditions),
            }
        )

    behaviors = {
        profile.key: {
            "type": profile.behavior_type,
            "parameters": runtime_parameters(profile.behavior_type, profile.parameters),
        }
        for profile in NpcBehaviorProfile.objects.filter(key__in=behavior_keys).order_by("key")
    }

    built.snapshot = {
        "schemaVersion": SNAPSHOT_SCHEMA_VERSION,
        "characters": characters,
        "placements": placements,
        "behaviors": behaviors,
    }
    return built
