"""Client views of published NPC content (workstream B, LAI-NPC-007, contract section 5.1).

Built by explicit allow-lists, so a key added to the snapshot later is not served until it is
named here. Server-only data never leaves: personas, dialogue trees, conditions (variant
`availability`, placement `spawnConditions`), `isDefault` and the placement's `island`.
"""

from __future__ import annotations

from . import published

_CHARACTER_KEYS = (
    "npcId",
    "displayName",
    "role",
    "ageBands",
    "personality",
    "dialogueMode",
    "voiceProfile",
    "defaultVariant",
)
_VARIANT_KEYS = (
    "variantKey",
    "displayName",
    "model",
    "portrait",
    "scale",
    "rotationOffsetY",
    "positionOffsetY",
    "animationMap",
    "extras",
)


def client_variant(variant: dict) -> dict:
    return {key: variant[key] for key in _VARIANT_KEYS if key in variant}


def client_character(character: dict) -> dict:
    """RuntimeCharacter: the snapshot character minus every server-only key."""
    visible = published.client_character(character)
    result = {key: visible[key] for key in _CHARACTER_KEYS if key in visible}
    result["variants"] = [client_variant(v) for v in visible.get("variants") or []]
    return result


def client_behavior(key: str | None, behavior: dict | None) -> dict | None:
    if key is None or behavior is None:
        return None
    return {"key": key, "type": behavior["type"], "parameters": behavior["parameters"]}


def client_placement(
    placement: dict, variant: str, behavior_key: str | None, behavior: dict | None
) -> dict:
    """RuntimePlacement: resolved variant, inlined behaviour, no conditions or island."""
    position = placement["position"]
    return {
        "placementKey": placement["placementKey"],
        "npcId": placement["npcId"],
        "variant": variant,
        "behavior": client_behavior(behavior_key, behavior),
        "position": {"x": position["x"], "y": position["y"], "z": position["z"]},
        "rotationY": placement["rotationY"],
        "scale": placement["scale"],
        "interactionRadius": placement["interactionRadius"],
    }
