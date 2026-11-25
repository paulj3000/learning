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


# --- usage provider for the asset library's registry (LAI-07 W2-4) ---------------------------
#
# Proven equal to `retirement_guard` by the parity matrix in tests/test_dependency_parity.py. Not
# registered yet: `retirement_guard` stays the registered guard until the avatars owner and the
# project owner approve the switch (`register_usage_provider()` below, from `ready()`).

SOURCE = "avatars"


def usages(asset, version=None):
    """AVAILABLE avatars served it (blocking); for the whole asset, other avatars whose model it
    is and avatars whose thumbnail it is (reported only; owner decision 2026-11-22)."""
    from django.urls import NoReverseMatch, reverse

    from apps.assets.dependencies import Usage

    def url(avatar) -> str:
        try:
            return reverse("admin:avatars_playeravatar_change", args=[avatar.pk])
        except NoReverseMatch:
            return ""

    found = [
        Usage(
            SOURCE,
            REFUSAL_CODE,
            f"Player avatar {avatar.avatar_key} (available, model)",
            blocks_retirement=True,
            admin_url=url(avatar),
            details={"avatar": avatar.avatar_key},
        )
        for avatar in avatars_using(asset, version)
    ]
    if version is None:
        others = (
            PlayerAvatar.objects.filter(model_asset=asset)
            .exclude(status=AvatarStatus.AVAILABLE)
            .order_by("avatar_key")
        )
        found += [
            Usage(
                SOURCE,
                "",
                f"Player avatar {a.avatar_key} ({a.status.lower()}, model)",
                # A disabled avatar was withdrawn; a draft is still being prepared.
                historical=a.status == AvatarStatus.DISABLED,
                admin_url=url(a),
                details={"avatar": a.avatar_key},
            )
            for a in others
        ]
        thumbnails = PlayerAvatar.objects.filter(thumbnail_asset=asset).order_by("avatar_key")
        found += [
            Usage(
                SOURCE,
                "",
                f"Player avatar {a.avatar_key} ({a.status.lower()}, thumbnail)",
                historical=a.status == AvatarStatus.DISABLED,
                admin_url=url(a),
                details={"avatar": a.avatar_key},
            )
            for a in thumbnails
        ]
    return found


def refusal(asset, version, blocking):
    """The guard's own refusal, word for word (one source of the wording)."""
    from apps.assets.dependencies import default_refusal
    from apps.assets.services import AssetActionRefused

    try:
        retirement_guard(asset, version)
    except AssetActionRefused as refused:
        return refused
    return default_refusal(asset, version, blocking)


def register_usage_provider() -> None:
    from apps.assets.dependencies import CheckClass
    from apps.assets.dependencies import register_usage_provider as register

    # Authoritative: a failed check could hide a release or avatar that still uses the asset.
    register(SOURCE, usages, refusal=refusal, check_class=CheckClass.AUTHORITATIVE)
