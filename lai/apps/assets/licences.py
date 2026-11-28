"""Licence rules for new environmental assets (owner decision D-3, 2026-11-28;
`docs/ENVIRONMENT_ASSETS.md` section 6).

The owner's conditions:

- Existing images with unknown licences stay backward compatible: they publish and resolve as
  before and only warn (`licence_unknown` on the Admin upload). Nothing here applies to an image
  without an image profile.
- New environmental assets need a verified, permitted licence before published realm content
  may use them. Two places enforce it, both new behaviour that no existing row reaches:
  1. publishing a version of an image asset that has an `ImageProfile` (an environmental role);
  2. publishing a material whose map names a texture whose default version is not licensed.
- No global publishing restriction. Legacy remediation and enforcement are a separate task.

A licence is *verified* when the version's `metadata.provenance.licenceStatus` is `confirmed`
(an Admin upload with "Licence confirmed by", a pack import whose licence the owner confirmed, or
a promotion that copied either). It is *permitted* when its id is on `PERMITTED`. CC-BY and other
attribution licences are barred until an in-product attribution surface exists (ADR-028).
"""

from __future__ import annotations

#: SPDX ids (and two project words) a realm may use today. `proprietary`: a commercial licence
#: with no in-product attribution duty, confirmed against the purchase terms. `original`: made
#: for this project.
PERMITTED = frozenset({"CC0-1.0", "original", "proprietary"})
#: Licences that need a credit children or parents can see; barred by ADR-028 for now.
ATTRIBUTION_PREFIXES = ("CC-BY",)


def _provenance(version) -> dict:
    record = (getattr(version, "metadata", None) or {}).get("provenance")
    return record if isinstance(record, dict) else {}


def licence_problem(version) -> str | None:
    """Why `version` may not be used by new published realm content, or None when it may."""
    provenance = _provenance(version)
    licence = str(provenance.get("licenceId") or "").strip()
    if provenance.get("licenceStatus") != "confirmed":
        return "its licence is not confirmed (record who checked it at upload)"
    if not licence:
        return "no licence id is recorded"
    if licence.upper().startswith(ATTRIBUTION_PREFIXES):
        return f"{licence} needs in-product attribution, which ADR-028 does not allow yet"
    if licence not in PERMITTED:
        return f"{licence} is not a permitted licence ({', '.join(sorted(PERMITTED))})"
    return None


def is_environmental(asset) -> bool:
    """An image asset with an image profile: a new environmental asset (D-3)."""
    return asset.pk is not None and asset.image_profiles.exists()


def publish_refusal(version, asset):
    """`services.publish_refusal` hook: refuse an environmental image without a verified,
    permitted licence. Every other version is unaffected."""
    if version.family != "image" or not is_environmental(asset):
        return None
    problem = licence_problem(version)
    if problem is None:
        return None
    from .services import AssetActionRefused

    return AssetActionRefused(
        "licence_required",
        f"This image has an environmental image profile, so it needs a verified, permitted "
        f"licence before it is published: {problem}. Upload it again with its source and "
        "licence confirmed.",
    )
