"""Versioned NPC publishing: publish, roll back, retire (LAI-NPC-034).

Every operation is one transaction under an advisory lock, so two staff publishing at once cannot
produce two ACTIVE releases (the partial unique constraint backs this up). Validation runs before
anything is written; a failed publish leaves no row.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.db import connection, transaction
from django.db.models import Max
from django.utils.timezone import now

from ..models import NpcRelease, NpcReleaseAsset
from ..vocabulary import SNAPSHOT_SCHEMA_VERSION, ReleaseStatus
from .snapshot import Built, build_snapshot

#: Distinct from the content import's lock (catalog.importer.IMPORT_LOCK_KEY).
PUBLISH_LOCK_KEY = 0x4E5043  # "NPC"


class PublishError(Exception):
    def __init__(self, code: str, problems: list[str] | None = None):
        super().__init__(code)
        self.code = code
        self.problems = problems or []


@dataclass
class Preview:
    """What a publish would produce right now, without writing anything."""

    built: Built
    problems: list[str]
    content_hash: str
    unchanged: bool


def _lock() -> None:
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [PUBLISH_LOCK_KEY])


def active_release() -> NpcRelease | None:
    return NpcRelease.objects.filter(status=ReleaseStatus.ACTIVE).first()


def preview() -> Preview:
    from ..validation import release_problems

    built = build_snapshot()
    content_hash = NpcRelease.hash_snapshot(built.snapshot)
    current = active_release()
    return Preview(
        built=built,
        problems=release_problems(built),
        content_hash=content_hash,
        unchanged=current is not None and current.content_hash == content_hash,
    )


def _activate(release: NpcRelease, user) -> None:
    current = active_release()
    if current is not None and current.pk != release.pk:
        current.status = ReleaseStatus.SUPERSEDED
        current.save(update_fields=["status"])
    release.status = ReleaseStatus.ACTIVE
    release.activated_at = now()
    release.activated_by = user
    release.save(update_fields=["status", "activated_at", "activated_by"])


def publish(user, *, notes: str = "") -> NpcRelease:
    """Validate the current READY content and make it the ACTIVE release.

    Raises `PublishError("invalid", problems)` when validation fails and
    `PublishError("unchanged")` when the content equals the active release.
    """
    with transaction.atomic():
        _lock()
        result = preview()
        if result.problems:
            raise PublishError("invalid", result.problems)
        if result.unchanged:
            raise PublishError("unchanged")
        number = (NpcRelease.objects.aggregate(top=Max("number"))["top"] or 0) + 1
        release = NpcRelease(
            number=number,
            status=ReleaseStatus.SUPERSEDED,  # activated below, after the old one steps down
            schema_version=SNAPSHOT_SCHEMA_VERSION,
            snapshot=result.built.snapshot,
            content_hash=result.content_hash,
            notes=notes[:300],
            validation_report={"problems": [], "assetUses": len(result.built.asset_uses)},
            created_by=user,
        )
        release.save()
        _record_assets(release, result.built)
        _activate(release, user)
        _after_activation(release)
        return release


def _after_activation(release: NpcRelease) -> None:
    """Speech pre-generation (LAI-NPC-028) once the activation commits; never blocks publishing."""
    from ..speech import schedule_pregeneration

    schedule_pregeneration(release)


def _record_assets(release: NpcRelease, built: Built) -> None:
    from apps.catalog.models import ContentAsset

    ids = {use.asset_id for use in built.asset_uses}
    assets = {a.asset_id: a for a in ContentAsset.objects.filter(asset_id__in=ids)}
    seen: set[tuple[str, str]] = set()
    for use in built.asset_uses:
        key = (use.asset_id, use.usage[:120])
        if key in seen:
            continue
        seen.add(key)
        NpcReleaseAsset.objects.create(
            release=release,
            asset=assets[use.asset_id],
            version_id=use.version_pk,
            usage=use.usage[:120],
        )


def rollback(release: NpcRelease, user) -> NpcRelease:
    """Make an earlier, SUPERSEDED release ACTIVE again. A RETIRED one cannot come back."""
    with transaction.atomic():
        _lock()
        release = NpcRelease.objects.select_for_update().get(pk=release.pk)
        if release.status == ReleaseStatus.ACTIVE:
            raise PublishError("already_active")
        if release.status == ReleaseStatus.RETIRED:
            raise PublishError("retired")
        if release.schema_version != SNAPSHOT_SCHEMA_VERSION:
            raise PublishError("schema_mismatch")
        problems = _rollback_asset_problems(release)
        if problems:
            raise PublishError("invalid", problems)
        _activate(release, user)
        _after_activation(release)
        return release


def _rollback_asset_problems(release: NpcRelease) -> list[str]:
    """An earlier release may name an asset or version retired since; it must not come back."""
    found = []
    for link in release.asset_links.select_related("asset", "version"):
        if link.asset.status != "ACTIVE":
            found.append(f"{link.usage}: asset {link.asset.asset_id} is retired")
        elif link.version is not None and not link.version.is_published:
            found.append(
                f"{link.usage}: asset {link.asset.asset_id} v{link.version.number} retired"
            )
    return found


def retire(release: NpcRelease, user) -> NpcRelease:
    """Withdraw a release for good. Retiring the ACTIVE one leaves no NPCs served (fail safe)."""
    with transaction.atomic():
        _lock()
        release = NpcRelease.objects.select_for_update().get(pk=release.pk)
        if release.status == ReleaseStatus.RETIRED:
            return release
        release.status = ReleaseStatus.RETIRED
        release.retired_at = now()
        release.save(update_fields=["status", "retired_at"])
        return release
