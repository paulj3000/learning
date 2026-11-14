"""What a child's avatar looks like in 3D (LAI-JMP-01c): the one place that decides it.

`child_avatar(child)` answers for the child's own `avatar_key` only. The model is served by
reference (`asset-id` or `asset-id@n`), which the client loads through the existing asset
resolver and loader (`GET children/<child>/assets/?ids=...`), so delivery, signed URLs, caching
and the published-only rule are the asset library's, unchanged.

The answer has no model (the client draws its placeholder) when the identity has no row, is not
AVAILABLE, fails validation, or its model does not resolve to a PUBLISHED version (unpublished,
retired, missing). `reason` says which, for diagnostics; it never names staff or files.
"""

from __future__ import annotations

from apps.assets import resolver

from .models import PlayerAvatar
from .validation import effective_animation_map, problems
from .vocabulary import AVATAR_DISPLAY_NAMES, AvatarStatus


def _ref(avatar) -> tuple[str, str, int | None]:
    asset_id = avatar.model_asset.asset_id
    if avatar.pinned_version_id:
        number = avatar.pinned_version.number
        return (f"{asset_id}@{number}", asset_id, number)
    return (asset_id, asset_id, None)


def _thumbnail(avatar) -> dict | None:
    if not avatar.thumbnail_asset_id:
        return None
    asset_id = avatar.thumbnail_asset.asset_id
    [entry] = resolver.resolve([(asset_id, asset_id, None)])
    if entry.get("status") != "resolved":
        return None
    return {"ref": asset_id, "url": entry["url"], "urlExpiresAt": entry["urlExpiresAt"]}


def describe(avatar: PlayerAvatar | None, avatar_key: str) -> dict:
    """The served description of one identity (also the admin's "children receive" preview)."""
    base = {
        "avatarKey": avatar_key,
        "displayName": avatar.display_name if avatar else AVATAR_DISPLAY_NAMES.get(avatar_key, ""),
        "model": None,
    }
    if avatar is None:
        return {**base, "reason": "not_configured"}
    if avatar.status != AvatarStatus.AVAILABLE:
        return {**base, "reason": "not_available"}
    if problems(avatar, for_availability=True):
        return {**base, "reason": "invalid"}
    ref, asset_id, number = _ref(avatar)
    [entry] = resolver.resolve([(ref, asset_id, number)])
    if entry.get("status") != "resolved" or entry.get("family") != "model":
        return {**base, "reason": entry.get("status", "unavailable")}
    clips = list(entry.get("clips") or [])
    return {
        **base,
        "model": {
            "ref": ref,
            "assetId": asset_id,
            "version": entry["version"],
            "clips": clips,
            "scale": avatar.scale,
            "rotationOffset": avatar.rotation_offset_y,
            "animationMap": effective_animation_map(avatar.animation_map, clips),
            "customization": avatar.customization or {},
        },
        "thumbnail": _thumbnail(avatar),
        "reason": None,
    }


def child_avatar(child) -> dict:
    """The child's own avatar. Child-scoped by the caller (`ChildScopedAPIView`)."""
    key = child.avatar_key
    avatar = (
        PlayerAvatar.objects.select_related(
            "model_asset__default_version", "pinned_version", "thumbnail_asset"
        )
        .filter(avatar_key=key)
        .first()
    )
    return describe(avatar, key)
