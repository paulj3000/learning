"""What makes a player avatar servable (LAI-JMP-01c). Pure checks; nothing is saved here.

`problems` are errors: an AVAILABLE avatar must have none, and the admin refuses to save one
that does. `warnings` are things staff should know (no walk clip) that never stop a child using
the avatar: a missing clip only means that state keeps the clip before it, or the placeholder's
gentle motion.
"""

from __future__ import annotations

from apps.assets.models import AssetVersion, VersionStatus
from apps.catalog.models import AssetStatus

from .vocabulary import (
    ATTACHMENT_SLOTS,
    COLOR_ROLES,
    CUSTOMIZATION_KEYS,
    DEFAULT_CLIPS,
    PLAYER_ANIMATION_STATES,
)

MODEL_KIND = "character"
MODEL_FORMATS = ("glb", "gltf")
THUMBNAIL_KINDS = ("image", "sprite")
#: States worth warning about when a model has no clip for them.
EXPECTED_STATES = ("idle", "walk", "jump")


def served_version(avatar) -> AssetVersion | None:
    """The version children would get: the pinned one, else the asset's published default."""
    if avatar.pinned_version_id:
        return avatar.pinned_version
    if avatar.model_asset_id:
        return avatar.model_asset.default_version
    return None


def effective_animation_map(explicit: dict, clips: list[str] | tuple[str, ...]) -> dict[str, str]:
    """Each state to the clip that plays it: the explicit map, else the standard clip names.

    Only clips the model really has are kept, so a state with nothing maps to nothing and the
    runtime falls back gracefully.
    """
    available = set(clips)
    resolved: dict[str, str] = {}
    for state in PLAYER_ANIMATION_STATES:
        named = explicit.get(state) if isinstance(explicit, dict) else None
        if isinstance(named, str) and named in available:
            resolved[state] = named
            continue
        for candidate in DEFAULT_CLIPS[state]:
            if candidate in available:
                resolved[state] = candidate
                break
    return resolved


def _check_animation_map(value, clips: set[str] | None) -> list[str]:
    if not isinstance(value, dict):
        return ["The animation map must be an object of state to clip name."]
    found = []
    for state, clip in value.items():
        if state not in PLAYER_ANIMATION_STATES:
            found.append(
                f'Animation map: "{state}" is not a player state '
                f"(use {', '.join(PLAYER_ANIMATION_STATES)})."
            )
        elif not isinstance(clip, str) or not clip.strip():
            found.append(f'Animation map: "{state}" must name a clip.')
        elif clips is not None and clip not in clips:
            found.append(f'Animation map: the model has no clip called "{clip}" (for "{state}").')
    return found


def _check_customization(value) -> list[str]:
    if not isinstance(value, dict):
        return ["Customization must be an object."]
    found = []
    for key in value:
        if key not in CUSTOMIZATION_KEYS:
            found.append(
                f'Customization: "{key}" is not supported ({", ".join(CUSTOMIZATION_KEYS)}).'
            )
    colors = value.get("colorMaterials", {})
    if not isinstance(colors, dict):
        found.append("Customization: colorMaterials must map material names to a colour role.")
    else:
        for material, role in colors.items():
            if not str(material).strip() or role not in COLOR_ROLES:
                found.append(
                    f'Customization: material "{material}" must take one of '
                    f"{', '.join(COLOR_ROLES)}."
                )
    points = value.get("attachPoints", {})
    if not isinstance(points, dict):
        found.append("Customization: attachPoints must map slots to node names.")
    else:
        for slot, node in points.items():
            if slot not in ATTACHMENT_SLOTS:
                found.append(
                    f'Customization: "{slot}" is not an attachment slot '
                    f"({', '.join(ATTACHMENT_SLOTS)})."
                )
            elif not isinstance(node, str) or not node.strip():
                found.append(f'Customization: attachment slot "{slot}" must name a node.')
    return found


def problems(avatar, *, for_availability: bool) -> list[str]:
    """Every reason this avatar cannot be saved (or, with `for_availability`, served)."""
    found: list[str] = []
    asset = avatar.model_asset if avatar.model_asset_id else None
    version = None
    if asset is not None:
        if asset.kind != MODEL_KIND:
            found.append(
                f'The model must be a character asset; "{asset.asset_id}" is a {asset.kind}.'
            )
        if asset.status == AssetStatus.RETIRED:
            found.append(f'The model asset "{asset.asset_id}" is retired.')
    if avatar.pinned_version_id:
        if asset is None or avatar.pinned_version.asset_id != asset.pk:
            found.append("The pinned version must be a version of the chosen model asset.")
    if asset is not None:
        version = served_version(avatar)
    if for_availability:
        if asset is None:
            found.append("Choose a model before making the avatar available.")
        elif version is None:
            found.append(
                f'"{asset.asset_id}" has no published default version yet; publish one first.'
            )
        elif version.status != VersionStatus.PUBLISHED:
            found.append(f"Version {version.number} is {version.status.lower()}, not published.")
        elif version.format not in MODEL_FORMATS:
            found.append(f"Version {version.number} is a {version.format} file, not a GLB or glTF.")
    clips = set(version.clips) if version is not None else None
    found += _check_animation_map(avatar.animation_map, clips)
    found += _check_customization(avatar.customization)
    if avatar.thumbnail_asset_id and avatar.thumbnail_asset.kind not in THUMBNAIL_KINDS:
        found.append("The thumbnail must be an image asset.")
    return found


def warnings(avatar) -> list[str]:
    """Things staff should know that never stop a child using the avatar."""
    version = served_version(avatar)
    if version is None:
        return []
    mapped = effective_animation_map(avatar.animation_map, version.clips)
    missing = [state for state in EXPECTED_STATES if state not in mapped]
    if not missing:
        return []
    return [
        f"No clip for {', '.join(missing)}: those states keep the previous clip "
        "(a model with no clips at all gets a gentle procedural motion)."
    ]
