"""Validate, publish and roll back the sound library (SM-P2-05).

The working copy (cues and assignments) can be edited at any time. Publishing freezes it into one
`SoundRelease`: every enabled cue with its audio version pinned to an exact, published
`AssetVersion`, plus every enabled assignment. Asset versions are already immutable in the Asset
Library, so a release needs no version system of its own: it records which version each cue used.

Publishing is atomic and all or nothing. If any enabled cue or assignment is invalid the whole
publish is refused with every problem listed, and the live release is untouched.
"""

import hashlib
import json
from dataclasses import dataclass, field

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.assets.models import AssetVersion, VersionStatus
from apps.catalog.models import AssetStatus

from .models import ReleaseStatus, SoundAssignment, SoundCue, SoundRelease
from .vocabulary import CHANNEL_CATEGORIES, SCHEMA_VERSION


class PublishRefused(Exception):
    """The library cannot be published or rolled back; `problems` says why, for staff."""

    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


@dataclass
class LibraryReport:
    problems: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def revision_of(value) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def live_release() -> SoundRelease | None:
    return SoundRelease.objects.filter(status=ReleaseStatus.LIVE).first()


def version_for(cue: SoundCue) -> AssetVersion | None:
    return cue.pinned_version if cue.pinned_version_id else cue.asset.default_version


def _version_problem(cue: SoundCue, version: AssetVersion | None) -> str | None:
    if cue.asset.status == AssetStatus.RETIRED:
        return f"{cue.cue_id}: the asset '{cue.asset.asset_id}' is retired"
    if version is None:
        return f"{cue.cue_id}: the asset '{cue.asset.asset_id}' has no published default version"
    if version.status != VersionStatus.PUBLISHED:
        return (
            f"{cue.cue_id}: version {version.number} of '{cue.asset.asset_id}' is "
            f"{version.get_status_display().lower()}, not published"
        )
    return None


def library_report() -> LibraryReport:
    """Everything wrong (problems) or worth knowing (warnings) about the working copy."""
    report = LibraryReport()
    cues = list(
        SoundCue.objects.select_related("asset", "asset__default_version", "pinned_version")
    )
    enabled_ids = set()
    for cue in cues:
        if not cue.enabled:
            continue
        enabled_ids.add(cue.pk)
        try:
            cue.full_clean(validate_unique=False)
        except ValidationError as error:
            for name, messages in error.message_dict.items():
                report.problems.append(f"{cue.cue_id} {name}: {'; '.join(messages)}")
            continue
        problem = _version_problem(cue, version_for(cue))
        if problem:
            report.problems.append(problem)
        elif cue.asset.category not in CHANNEL_CATEGORIES[cue.channel]:
            report.problems.append(f"{cue.cue_id}: the asset category no longer suits its channel")

    assignments = SoundAssignment.objects.select_related(
        "cue", "world", "location", "region", "region__location__world", "location__world"
    )
    for assignment in assignments:
        if not assignment.enabled:
            continue
        if assignment.cue_id not in enabled_ids:
            report.warnings.append(
                f"{assignment}: skipped because its cue '{assignment.cue.cue_id}' is disabled"
            )
            continue
        try:
            assignment.full_clean(validate_unique=False)
        except ValidationError as error:
            for messages in error.message_dict.values():
                report.problems.append(f"{assignment}: {'; '.join(messages)}")
    return report


def build_snapshot() -> dict:
    """The working copy as plain data. Assumes `library_report()` found no problems."""
    cues = []
    enabled = set()
    for cue in SoundCue.objects.select_related("asset", "asset__default_version", "pinned_version"):
        if not cue.enabled:
            continue
        version = version_for(cue)
        enabled.add(cue.pk)
        cues.append(
            {
                "id": cue.cue_id,
                "channel": cue.channel,
                "asset": cue.asset.asset_id,
                "version": version.number,
                "versionId": str(version.version_id),
                "volume": cue.volume,
                "loop": cue.loop,
                "stream": cue.stream,
                "priority": cue.priority,
                "maxConcurrent": cue.max_concurrent,
                "cooldownMs": cue.cooldown_ms,
                "fadeInMs": cue.fade_in_ms,
                "fadeOutMs": cue.fade_out_ms,
                "shared": cue.shared,
            }
        )
    assignments = []
    queryset = SoundAssignment.objects.select_related("cue", "world", "location", "region")
    for assignment in queryset:
        if not assignment.enabled or assignment.cue_id not in enabled:
            continue
        assignments.append(
            {
                "scope": {"type": assignment.scope_type, "id": assignment.scope_id},
                "targetType": assignment.target_type,
                "targetId": assignment.target_id,
                "event": assignment.event,
                "channel": assignment.cue.channel,
                "cueId": assignment.cue.cue_id,
            }
        )
    cues.sort(key=lambda item: item["id"])
    assignments.sort(
        key=lambda item: (
            item["scope"]["type"],
            item["scope"]["id"] or "",
            item["targetType"],
            item["targetId"],
            item["event"],
            item["channel"],
        )
    )
    return {"schemaVersion": SCHEMA_VERSION, "cues": cues, "assignments": assignments}


def _create_release(snapshot: dict, user, note: str, rolled_back_from=None) -> SoundRelease:
    try:
        with transaction.atomic():
            latest = SoundRelease.objects.select_for_update().order_by("-number").first()
            SoundRelease.objects.filter(status=ReleaseStatus.LIVE).update(
                status=ReleaseStatus.SUPERSEDED
            )
            return SoundRelease.objects.create(
                number=(latest.number + 1) if latest else 1,
                status=ReleaseStatus.LIVE,
                revision=revision_of(snapshot),
                snapshot=snapshot,
                note=note[:300],
                rolled_back_from=rolled_back_from,
                published_by=user if getattr(user, "pk", None) else None,
            )
    except IntegrityError:
        raise PublishRefused(["Another publish is in progress. Try again in a moment."]) from None


def publish(user, note: str = "") -> SoundRelease:
    """Freeze the working copy into a new LIVE release, or refuse with every problem."""
    report = library_report()
    if report.problems:
        raise PublishRefused(report.problems)
    snapshot = build_snapshot()
    if not snapshot["cues"]:
        raise PublishRefused(["There are no enabled sound cues to publish."])
    return _create_release(snapshot, user, note)


def rollback_to(release: SoundRelease, user, note: str = "") -> SoundRelease:
    """Make an earlier release live again, as a new release.

    History is append-only: the old release is copied into a new number rather than reopened.
    The audio versions it pinned must still be published; a retired one blocks the rollback.
    """
    release = SoundRelease.objects.get(pk=release.pk)  # never trust a stale status
    if release.status == ReleaseStatus.LIVE:
        raise PublishRefused([f"Release {release.number} is already live."])
    problems = release_problems(release.snapshot)
    if problems:
        raise PublishRefused(problems)
    return _create_release(
        release.snapshot, user, note or f"Rolled back to release {release.number}", release
    )


def release_problems(snapshot: dict) -> list[str]:
    """Pinned audio versions in a snapshot that are no longer published."""
    ids = {cue["versionId"] for cue in snapshot["cues"]}
    published = set(
        AssetVersion.objects.filter(
            version_id__in=ids, status=VersionStatus.PUBLISHED, asset__status=AssetStatus.ACTIVE
        ).values_list("version_id", flat=True)
    )
    published = {str(item) for item in published}
    return [
        f"{cue['id']}: version {cue['version']} of '{cue['asset']}' is no longer published"
        for cue in snapshot["cues"]
        if cue["versionId"] not in published
    ]


def cue_status(cue: SoundCue, live: SoundRelease | None) -> str:
    """Where a cue stands against the live release, for the admin list."""
    if live is None:
        return "Not published" if cue.enabled else "Disabled"
    entry = next((item for item in live.snapshot["cues"] if item["id"] == cue.cue_id), None)
    if not cue.enabled:
        return "Disabled (still live until the next release)" if entry else "Disabled"
    if entry is None:
        return "Not published"
    version = version_for(cue)
    current = {
        "channel": cue.channel,
        "asset": cue.asset.asset_id,
        "version": version.number if version else None,
        "volume": cue.volume,
        "loop": cue.loop,
        "stream": cue.stream,
        "priority": cue.priority,
        "maxConcurrent": cue.max_concurrent,
        "cooldownMs": cue.cooldown_ms,
        "fadeInMs": cue.fade_in_ms,
        "fadeOutMs": cue.fade_out_ms,
        "shared": cue.shared,
    }
    if any(entry[key] != value for key, value in current.items()):
        return "Changes not yet published"
    return "Published"
