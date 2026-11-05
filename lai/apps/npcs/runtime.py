"""Runtime selection for the NPC read API (workstream B, LAI-NPC-007, contract section 5.1).

Pure selection over the ACTIVE release (`published.current()`): which characters a child may
meet, which placements spawn in a scope, and which model variant each placement shows. Nothing
here reads draft rows or writes anything.

Condition context is built at most once per request (`ChildConditions`): world changes and quest
progress are read once, the child's NPC relationships once, and each NPC's context is that base
with its own relationship swapped in. An empty condition list never touches the database.
"""

from __future__ import annotations

import dataclasses

from . import conditions, published
from .api import Scope
from .serializers_runtime import client_character, client_placement


class ChildConditions:
    """Evaluates condition lists for one child, reading progress lazily and only once."""

    def __init__(self, child):
        self.child = child
        self._base: conditions.ConditionContext | None = None
        self._levels: dict[str, str] = {}
        self._by_npc: dict[str, conditions.ConditionContext] = {}

    def context(self, npc_id: str) -> conditions.ConditionContext:
        cached = self._by_npc.get(npc_id)
        if cached is not None:
            return cached
        if self._base is None:
            from apps.progression.models import NpcRelationship

            # Same records and meaning as `conditions.context_for(child, npc_id)`, read once.
            self._base = conditions.context_for(self.child)
            self._levels = dict(
                NpcRelationship.objects.for_child(self.child).values_list(
                    "npc_id", "relationship_level"
                )
            )
        level = self._levels.get(npc_id)
        context = dataclasses.replace(
            self._base, relationship_level=level, prior_visits=1 if level is not None else 0
        )
        self._by_npc[npc_id] = context
        return context

    def holds(self, condition_list, npc_id: str) -> bool:
        if not condition_list:
            return True
        return conditions.holds(condition_list, self.context(npc_id))


def resolve_variant(character: dict, wanted: str | None, checks: ChildConditions) -> str | None:
    """The placement's variant if available to this child, else the first available one by
    order, else the default. None only when the character has no variants at all."""
    variants = character.get("variants") or []
    npc_id = character["npcId"]
    if wanted is not None:
        for variant in variants:
            if variant["variantKey"] != wanted:
                continue
            if checks.holds(variant.get("availability"), npc_id):
                return wanted
    for variant in variants:
        if checks.holds(variant.get("availability"), npc_id):
            return variant["variantKey"]
    default = character.get("defaultVariant")
    if default and any(v["variantKey"] == default for v in variants):
        return default
    return None


def catalog(release: published.PublishedRelease, child) -> dict:
    """`GET children/<child>/npcs/`: the release's characters eligible for the child's band."""
    return {
        "contractVersion": 1,
        "release": release.number,
        "characters": [
            client_character(character)
            for _, character in sorted(release.characters.items())
            if published.eligible_for(character, child.age_band)
        ],
    }


def scene(release: published.PublishedRelease, child, scope: Scope) -> dict:
    """The Area or Place route: spawnable placements in `scope` and exactly the characters
    they place."""
    if scope.area is None:
        here = [p for p in release.placements(place=scope.place) if p.get("area") is None]
    else:
        here = release.placements(place=scope.place, area=scope.area)
    checks = ChildConditions(child)
    placements: list[dict] = []
    characters: dict[str, dict] = {}
    for placement in here:
        npc_id = placement["npcId"]
        character = release.characters.get(npc_id)
        if character is None or not published.eligible_for(character, child.age_band):
            continue
        if not checks.holds(placement.get("spawnConditions"), npc_id):
            continue
        variant = resolve_variant(character, placement.get("variant"), checks)
        if variant is None:
            continue
        behavior_key = placement.get("behavior")
        placements.append(
            client_placement(placement, variant, behavior_key, release.behavior(behavior_key))
        )
        if npc_id not in characters:
            characters[npc_id] = client_character(character)
    return {
        "contractVersion": 1,
        "release": release.number,
        "scope": {"place": scope.place, "area": scope.area},
        "characters": characters,
        "placements": placements,
    }
