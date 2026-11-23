"""Which sound releases and cues use an asset (LAI-07 W2-2; ASSET_LIBRARY.md s. 25.3).

DRAFT for the Sound Manager owner's review; registered from `AudioConfig.ready()`. Rules: owner
decision 2026-11-23 (#246):

- Retiring an **asset** is refused while the LIVE `SoundRelease` pins any version of it
  (`snapshot.cues[].asset`). Games read only the LIVE release, so retiring it would silently
  drop those cues from what children hear.
- Retiring an exact **version** is refused while the LIVE release pins that version
  (`snapshot.cues[].versionId`), even when a replacement default is named: the release pins the
  exact version, so a new default does not reach it until the next release is published.
- SUPERSEDED releases are reported only (a rollback to one already refuses a retired version).
- Working `SoundCue` rows are reported only: they are copied into a release at publish time,
  and publishing already refuses a retired asset or version (`library_report`).

Read-only: nothing here changes a cue, a release or the publish flow.
"""

from __future__ import annotations

from django.urls import NoReverseMatch, reverse

from .models import ReleaseStatus, SoundCue, SoundRelease

SOURCE = "audio"
REFUSAL_CODE = "sound_release_dependency"


def _admin_url(name: str, pk) -> str:
    try:
        return reverse(f"admin:audio_{name}_change", args=[pk])
    except NoReverseMatch:
        return ""


def _pinned(release, asset, version) -> list[str]:
    """Cue ids in a release that pin this asset (or exactly this version)."""
    cues = release.snapshot.get("cues", []) if isinstance(release.snapshot, dict) else []
    if version is not None:
        wanted = str(version.version_id)
        return sorted(cue["id"] for cue in cues if cue.get("versionId") == wanted)
    return sorted(cue["id"] for cue in cues if cue.get("asset") == asset.asset_id)


def _cue_uses(cue, asset, version) -> bool:
    if version is None:
        return True
    if cue.pinned_version_id is not None:
        return cue.pinned_version_id == version.pk
    return asset.default_version_id == version.pk  # an unpinned cue follows the default


def usages(asset, version=None):
    from apps.assets.dependencies import Usage

    found = []
    for release in SoundRelease.objects.order_by("-number"):
        cue_ids = _pinned(release, asset, version)
        if not cue_ids:
            continue
        live = release.status == ReleaseStatus.LIVE
        found.append(
            Usage(
                SOURCE,
                REFUSAL_CODE,
                f"Sound release {release.number} ({release.get_status_display().lower()}), "
                f"cue(s) {', '.join(cue_ids)}",
                blocks_retirement=live,
                admin_url=_admin_url("soundrelease", release.pk),
                details={"release": release.number, "cues": cue_ids},
            )
        )
    for cue in SoundCue.objects.filter(asset=asset).order_by("cue_id"):
        if _cue_uses(cue, asset, version):
            found.append(
                Usage(
                    SOURCE,
                    REFUSAL_CODE,
                    f"Sound cue {cue.cue_id} (working copy)",
                    admin_url=_admin_url("soundcue", cue.pk),
                    details={"cue": cue.cue_id},
                )
            )
    return found


def refusal(asset, version, blocking):
    from apps.assets.services import AssetActionRefused

    what = f"{asset.asset_id} v{version.number}" if version is not None else f'"{asset.asset_id}"'
    named = "; ".join(usage.label for usage in blocking)
    return AssetActionRefused(
        REFUSAL_CODE,
        f"{what} is used by the live sound release: {named}. Children would stop hearing those "
        "cues. Publish a sound release that no longer uses it, then retire it.",
        details={
            "releases": [usage.details["release"] for usage in blocking],
            "cues": sorted({cue for usage in blocking for cue in usage.details["cues"]}),
        },
    )


def register() -> None:
    from apps.assets.dependencies import register_usage_provider

    register_usage_provider(SOURCE, usages, refusal=refusal)
