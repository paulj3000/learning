"""Which player avatars use an asset (LAI-JMP-01c).

An AVAILABLE avatar is what children are served, so retiring its model asset, or the exact
version it is served (pinned, or the asset's default when unpinned), is refused with a message
naming the avatar. Registered in `apps.assets.services.RETIREMENT_GUARDS` from
`AvatarsConfig.ready()`. Make the avatar a draft (or point it elsewhere) first. Draft and disabled
avatars never block.
"""

from __future__ import annotations

from django.db.models import Q

from .models import PlayerAvatar
from .vocabulary import AvatarStatus

REFUSAL_CODE = "player_avatar_in_use"


def avatars_using(asset, version=None) -> list[PlayerAvatar]:
    live = PlayerAvatar.objects.filter(status=AvatarStatus.AVAILABLE, model_asset=asset)
    if version is not None:
        live = live.filter(
            Q(pinned_version=version)
            | Q(pinned_version__isnull=True, model_asset__default_version=version)
        )
    return list(live.order_by("avatar_key"))


def retirement_guard(asset, version=None) -> None:
    from apps.assets.services import AssetActionRefused

    using = avatars_using(asset, version)
    if using:
        names = ", ".join(avatar.display_name for avatar in using)
        what = f"version {version.number} of " if version is not None else ""
        raise AssetActionRefused(
            REFUSAL_CODE,
            f'Children are served {what}"{asset.asset_id}" as the {names} player avatar. '
            "Make that avatar a draft, or give it another model, before retiring this.",
            details={"avatars": [avatar.avatar_key for avatar in using]},
        )
