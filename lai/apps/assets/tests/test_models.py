"""AM-2: asset definitions and immutable versions (LAI-2200, ADR-035)."""

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.assets.models import AssetVersion, ImmutableVersion, VersionStatus
from apps.assets.tests.helpers import make_definition, make_version
from apps.catalog.models import AssetOrigin, AssetStatus, ContentAsset

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def test_asset_ids_are_unique():
    make_definition("treasure-chest", kind="prop", category="prop")
    with pytest.raises(IntegrityError), transaction.atomic():
        make_definition("treasure-chest", kind="prop", category="prop")


def test_a_django_definition_needs_no_export_release_but_an_export_row_does():
    asset = make_definition("golden-doubloon", kind="collectible", category="collectible")
    assert asset.origin == AssetOrigin.DJANGO and asset.last_seen_release is None
    assert asset.status == AssetStatus.ACTIVE and asset.default_version is None
    with pytest.raises(IntegrityError), transaction.atomic():
        ContentAsset.objects.create(asset_id="rock", kind="prop", origin=AssetOrigin.EXPORT)


@pytest.mark.parametrize(
    "kind, category, ok",
    [
        ("character", "npc", True),
        ("character", "building", False),
        ("kit-piece", "scenery", True),
        ("collectible", "collectible", True),
        ("vehicle", "vehicle", False),  # not a runtime kind
    ],
)
def test_kind_and_category_must_be_compatible(kind, category, ok):
    asset = ContentAsset(asset_id="thing", kind=kind, category=category, origin=AssetOrigin.DJANGO)
    if ok:
        asset.clean()
    else:
        with pytest.raises(ValidationError):
            asset.clean()


def test_version_numbers_are_unique_per_asset_and_shared_ids_are_not():
    pip = make_definition("npc-pip")
    quill = make_definition("npc-quill")
    make_version(pip, 1)
    make_version(quill, 1)  # same number, different asset: fine
    with pytest.raises(IntegrityError), transaction.atomic():
        make_version(pip, 1)


def test_storage_keys_and_version_ids_are_unique():
    pip = make_definition("npc-pip")
    first = make_version(pip, 1)
    with pytest.raises(IntegrityError), transaction.atomic():
        make_version(pip, 2, storage_key=first.storage_key)
    with pytest.raises(IntegrityError), transaction.atomic():
        make_version(pip, 3, version_id=first.version_id)


@pytest.mark.parametrize(
    "fields",
    [
        {"status": VersionStatus.PUBLISHED, "published_at": None},
        {"status": VersionStatus.PUBLISHED, "validated_at": None},
        {"status": VersionStatus.RETIRED, "retired_at": None},
        {"status": VersionStatus.DRAFT, "published_at": "2026-10-25T00:00:00Z"},
        {"sha256": "not-a-checksum"},
        {"size_bytes": 0},
    ],
)
def test_the_database_refuses_impossible_versions(fields):
    pip = make_definition("npc-pip")
    with pytest.raises(IntegrityError), transaction.atomic():
        make_version(pip, 1, **{"status": VersionStatus.VALIDATED, **fields})


def test_a_published_version_cannot_change_or_be_deleted():
    pip = make_definition("npc-pip")
    version = AssetVersion.objects.get(pk=make_version(pip, 1, status=VersionStatus.PUBLISHED).pk)
    version.sha256 = "0" * 64
    with pytest.raises(ImmutableVersion, match="sha256"):
        version.save()
    version = AssetVersion.objects.get(pk=version.pk)
    version.notes = "admin note"  # notes stay editable
    version.save()
    with pytest.raises(ImmutableVersion):
        version.delete()
    with pytest.raises(ImmutableVersion), transaction.atomic():
        AssetVersion.objects.filter(pk=version.pk).delete()  # queryset deletes are guarded too
    assert AssetVersion.objects.filter(pk=version.pk).exists()


@pytest.mark.parametrize(
    "start, target, allowed",
    [
        (VersionStatus.DRAFT, VersionStatus.VALIDATED, True),
        (VersionStatus.DRAFT, VersionStatus.PUBLISHED, False),
        (VersionStatus.REJECTED, VersionStatus.PUBLISHED, False),
        (VersionStatus.RETIRED, VersionStatus.PUBLISHED, False),
    ],
)
def test_only_allowed_status_transitions(start, target, allowed):
    pip = make_definition("npc-pip")
    version = AssetVersion.objects.get(pk=make_version(pip, 1, status=start).pk)
    version.status = target
    if target == VersionStatus.VALIDATED:
        version.validated_at = timezone.now()  # the database requires it (tested above)
    if allowed:
        version.save()
    else:
        with pytest.raises(ImmutableVersion):
            version.save()


def test_drafts_and_rejected_versions_can_be_deleted():
    pip = make_definition("npc-pip")
    for status in (VersionStatus.DRAFT, VersionStatus.REJECTED):
        version = AssetVersion.objects.get(pk=make_version(pip, status=status).pk)
        version.delete()
    assert not AssetVersion.objects.exists()


def test_a_definition_with_versions_cannot_be_deleted():
    from django.db.models import ProtectedError

    pip = make_definition("npc-pip")
    make_version(pip, 1, status=VersionStatus.DRAFT)
    with pytest.raises(ProtectedError):
        pip.delete()
