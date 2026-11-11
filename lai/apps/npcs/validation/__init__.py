"""Release validation (LAI-NPC-034, LAI-NPC-035): every check that must pass before a publish.

`release_problems(built)` runs the snapshot builder's own problems, the structural checks here,
then each workstream's module. Any problem refuses the publish; nothing is written.
"""

from __future__ import annotations

from .. import conditions
from . import assets, behavior, dialogue, persona, voice

#: Order is report order. Each module exposes `problems(snapshot) -> list[str]`.
CHECKS = (assets, dialogue, behavior, voice, persona)


def structure_problems(snapshot: dict) -> list[str]:
    """Cross-references inside the snapshot (foundation-owned)."""
    found: list[str] = []
    characters = snapshot.get("characters", {})
    behaviors = snapshot.get("behaviors", {})
    if not characters:
        found.append("there is no READY character to publish")
    seen: set[tuple[str, str]] = set()
    for placement in snapshot.get("placements", []):
        where = f"placement {placement['place']}/{placement['placementKey']}"
        key = (placement["place"], placement["placementKey"])
        if key in seen:
            found.append(f"{where}: duplicate placement key")
        seen.add(key)
        character = characters.get(placement["npcId"])
        if character is None:
            found.append(f"{where}: character {placement['npcId']} is not READY")
            continue
        variant_keys = {v["variantKey"] for v in character["variants"]}
        if placement["variant"] and placement["variant"] not in variant_keys:
            found.append(f"{where}: unknown variant {placement['variant']}")
        if placement["behavior"] and placement["behavior"] not in behaviors:
            found.append(f"{where}: unknown behaviour {placement['behavior']}")
        found.extend(conditions.problems(placement["spawnConditions"], f"{where} spawn"))
    for npc_id, character in characters.items():
        for variant in character["variants"]:
            found.extend(
                conditions.problems(
                    variant["availability"], f"{npc_id} variant {variant['variantKey']}"
                )
            )
    return found


def release_problems(built) -> list[str]:
    found = list(built.problems)
    found.extend(structure_problems(built.snapshot))
    for check in CHECKS:
        found.extend(check.problems(built.snapshot))
    # Stable order and no duplicates, so a report reads the same twice.
    return list(dict.fromkeys(found))
