"""Test factories shared by every NPC Manager workstream (foundation-owned).

Rows are created directly (no content export), so tests stay fast and independent of the real
`content/exported` files. Use `treasure` from `lai/conftest.py` when the real cove is needed.
"""

from __future__ import annotations

from apps.catalog.models import (
    AssetOrigin,
    ContentAsset,
    ContentRelease,
    Location,
    NpcDefinition,
    World,
)
from apps.npcs.models import (
    NpcBehaviorProfile,
    NpcCharacter,
    NpcDialogue,
    NpcDialogueChoice,
    NpcDialogueNode,
    NpcModelVariant,
    NpcPlacement,
)
from apps.npcs.vocabulary import CharacterStatus, NpcRole
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount


def make_staff(username: str = "npc-staff", *, superuser: bool = False) -> ParentAccount:
    """A Django Admin staff account (ADR-034: admin-only, never a parent login)."""
    return ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{username}",
        admin_username=username,
        is_staff=True,
        is_superuser=superuser,
    )


def content_release() -> ContentRelease:
    release = ContentRelease.objects.first()
    if release is None:
        release = ContentRelease.objects.create(
            content_digest="0" * 64, schema_version=1, export_tool="tests", files=[], report={}
        )
    return release


def make_place(world_slug: str = "test-island", place_slug: str = "test-bay"):
    release = content_release()
    world, _ = World.objects.get_or_create(
        slug=world_slug,
        defaults={
            "title": world_slug.title(),
            "supported_age_bands": ["SPROUT", "PATHFINDER", "EXPLORER"],
            "pack_version": 1,
            "source": {},
            "last_seen_release": release,
        },
    )
    place, _ = Location.objects.get_or_create(
        slug=place_slug,
        defaults={
            "world": world,
            "title": place_slug.title(),
            "source": {},
            "last_seen_release": release,
        },
    )
    return world, place


def make_asset(asset_id: str, kind: str = "character", *, bundled: bool = True) -> ContentAsset:
    """An export-origin asset served from the bundle (no versions needed)."""
    asset, _ = ContentAsset.objects.get_or_create(
        asset_id=asset_id,
        defaults={
            "kind": kind,
            "bundled_path": f"/models/{asset_id}.glb" if bundled else "",
            "clips": ["Idle", "Talk", "Wave"] if kind == "character" else [],
            "category": {"character": "npc", "image": "image", "audio": "sound"}.get(kind, "other"),
            "origin": AssetOrigin.EXPORT,
            "last_seen_release": content_release(),
        },
    )
    return asset


def make_character(
    npc_id: str = "test-npc",
    *,
    status: str = CharacterStatus.READY,
    role: str = NpcRole.GUIDE,
    age_bands: list[str] | None = None,
    with_variant: bool = True,
) -> NpcCharacter:
    definition, _ = NpcDefinition.objects.get_or_create(
        npc_id=npc_id,
        defaults={
            "display_name": npc_id.replace("-", " ").title(),
            "home_location_slug": "test-bay",
            "origin": AssetOrigin.DJANGO,
        },
    )
    character = NpcCharacter.objects.create(
        definition=definition, role=role, status=status, age_bands=age_bands or []
    )
    if with_variant:
        make_variant(character)
    return character


def make_variant(character: NpcCharacter, key: str = "classic", **fields) -> NpcModelVariant:
    fields.setdefault("model_asset", make_asset(f"{character.slug}-model"))
    fields.setdefault("is_default", not character.variants.exists())
    fields.setdefault("animation_map", {"idle": "Idle", "talk": "Talk", "wave": "Wave"})
    return NpcModelVariant.objects.create(character=character, variant_key=key, **fields)


def make_placement(character: NpcCharacter, key: str = "spot", *, region=None, **fields):
    world, place = make_place()
    if region is not None:
        place = region.location
        world = place.world
    return NpcPlacement.objects.create(
        character=character,
        placement_key=key,
        world=world,
        location=place,
        region=region,
        **fields,
    )


def make_behavior(key: str = "idle-here", behavior_type: str = "stationary", **parameters):
    return NpcBehaviorProfile.objects.create(
        key=key, display_name=key, behavior_type=behavior_type, parameters=parameters
    )


def make_dialogue(character: NpcCharacter, key: str = "hello", trigger: str = "on_interact", **f):
    """A two-node dialogue: greeting with two choices, then a goodbye node."""
    dialogue = NpcDialogue.objects.create(
        character=character, dialogue_key=key, title=key, trigger=trigger, **f
    )
    greet = NpcDialogueNode.objects.create(
        dialogue=dialogue, node_key="greet", text="Ahoy there, friend!", animation_state="wave"
    )
    bye = NpcDialogueNode.objects.create(
        dialogue=dialogue, node_key="bye", text="See you soon!", sort_order=1
    )
    NpcDialogueChoice.objects.create(
        node=greet, choice_key="wave-back", label="Wave", next_node=bye
    )
    NpcDialogueChoice.objects.create(
        node=greet, choice_key="leave", label="Bye", action="END", sort_order=1
    )
    dialogue.start_node = greet
    dialogue.save()
    return dialogue
