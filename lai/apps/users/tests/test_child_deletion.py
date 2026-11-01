"""Child deletion with photo storage cleanup (LAI-0602; docs/platform/CHILD_PHOTO_STORAGE.md §5).

Uses the in-memory photo store and the two-family fixture. Nothing contacts AWS. The API route
stays blocked until LAI-0209 (test_children_api.py); these tests call the service directly.
"""

import logging
import uuid

import pytest
from django.apps import apps as django_apps

from apps.core.models import ChildOwnedModel
from apps.users import deletion, photos
from apps.users.deletion import ChildDeletionIncomplete, delete_child_profile
from apps.users.models import ChildPhoto, ChildPhotoStatus, ChildProfile
from apps.users.photo_storage import (
    MemoryPhotoStorage,
    get_photo_storage,
    photo_key,
    reset_photo_storage_cache,
)
from apps.users.services import ChildProfileNotFound

from .test_child_photos import EXIF_JPEG

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture(autouse=True)
def fresh_photo_store():
    reset_photo_storage_cache()
    yield
    reset_photo_storage_cache()


@pytest.fixture
def committed(django_capture_on_commit_callbacks):
    return lambda: django_capture_on_commit_callbacks(execute=True)


def store() -> MemoryPhotoStorage:
    storage = get_photo_storage()
    assert isinstance(storage, MemoryPhotoStorage)
    return storage


def give_photo(parent, child, committed, times=1):
    for _ in range(times):
        with committed():
            photos.replace_photo(parent, child.pk, EXIF_JPEG, "image/jpeg")


def child_owned_rows(child_id) -> int:
    return sum(
        model.objects.filter(child_id=child_id).count()
        for model in django_apps.get_models()
        if issubclass(model, ChildOwnedModel)
    )


def test_deleting_a_child_removes_its_photo_objects_rows_and_records(families, committed):
    give_photo(families.a, families.a1, committed)
    give_photo(families.a, families.a2, committed)
    child_id = families.a1.pk

    delete_child_profile(families.a, child_id)

    assert not ChildProfile.objects.filter(pk=child_id).exists()
    assert child_owned_rows(child_id) == 0
    assert not any(key.startswith(f"children/{child_id}/") for key in store().objects)
    # The sibling's photo is untouched.
    assert ChildPhoto.objects.for_child(families.a2).count() == 1
    assert len(store().objects) == 1


def test_superseded_photos_waiting_for_deletion_are_removed_too(families, committed):
    give_photo(families.a, families.a1, committed)
    store().fail_next.add("delete")  # the replaced photo's after-commit delete fails
    give_photo(families.a, families.a1, committed)
    statuses = sorted(ChildPhoto.objects.for_child(families.a1).values_list("status", flat=True))
    assert statuses == [ChildPhotoStatus.CURRENT, ChildPhotoStatus.DELETING]

    delete_child_profile(families.a, families.a1.pk)

    assert store().objects == {}
    assert not ChildPhoto.objects.filter(child_id=families.a1.pk).exists()


def test_a_child_without_a_photo_is_deleted(families):
    delete_child_profile(families.a, families.a1.pk)
    assert not ChildProfile.objects.filter(pk=families.a1.pk).exists()


@pytest.mark.parametrize("which", ["other_family", "unknown", "malformed"])
def test_another_familys_or_an_unknown_child_is_not_found_and_nothing_changes(
    families, committed, which
):
    give_photo(families.b, families.b1, committed)
    target = {"other_family": families.b1.pk, "unknown": uuid.uuid4(), "malformed": "nope"}[which]

    with pytest.raises(ChildProfileNotFound):
        delete_child_profile(families.a, target)

    assert ChildProfile.objects.count() == 4
    assert ChildPhoto.objects.for_child(families.b1).get().status == ChildPhotoStatus.CURRENT
    assert len(store().objects) == 1


def test_a_storage_failure_keeps_the_child_and_never_serves_the_photo(families, committed):
    give_photo(families.a, families.a1, committed)
    store().fail_next.add("delete")

    with pytest.raises(ChildDeletionIncomplete):
        delete_child_profile(families.a, families.a1.pk)

    assert ChildProfile.objects.filter(pk=families.a1.pk).exists()
    row = ChildPhoto.objects.for_child(families.a1).get()
    assert row.status == ChildPhotoStatus.DELETING
    assert photos.current_photo(families.a1) is None
    assert len(store().objects) == 1


def test_a_retry_after_a_storage_failure_finishes_the_deletion(families, committed):
    give_photo(families.a, families.a1, committed)
    store().fail_next.add("delete")
    with pytest.raises(ChildDeletionIncomplete):
        delete_child_profile(families.a, families.a1.pk)

    delete_child_profile(families.a, families.a1.pk)

    assert not ChildProfile.objects.filter(pk=families.a1.pk).exists()
    assert store().objects == {} and not ChildPhoto.objects.exists()


def test_disabled_storage_refuses_deletion_of_a_child_with_a_photo(families, committed, settings):
    give_photo(families.a, families.a1, committed)
    settings.LAI_CHILD_PHOTO_STORAGE = "disabled"
    reset_photo_storage_cache()

    with pytest.raises(ChildDeletionIncomplete):
        delete_child_profile(families.a, families.a1.pk)

    assert ChildProfile.objects.filter(pk=families.a1.pk).exists()
    assert photos.current_photo(families.a1) is None


def test_a_photo_added_during_deletion_stops_the_cascade(families, monkeypatch):
    real_purge = photos.delete_all_child_photos

    def purge_then_race(child):
        assert real_purge(child) is True
        # An upload commits its row after the purge and before the child is locked.
        ChildPhoto.objects.create(
            child=child,
            storage_key=photo_key(child.pk, uuid.uuid4()),
            byte_size=1,
            sha256="0" * 64,
            width=1,
            height=1,
        )
        return True

    monkeypatch.setattr(deletion.photos, "delete_all_child_photos", purge_then_race)

    with pytest.raises(ChildDeletionIncomplete):
        delete_child_profile(families.a, families.a1.pk)

    assert ChildProfile.objects.filter(pk=families.a1.pk).exists()


def test_deletion_logs_carry_no_child_data(families, committed, caplog):
    give_photo(families.a, families.a1, committed)
    with caplog.at_level(logging.DEBUG):
        delete_child_profile(families.a, families.a1.pk)
    text = " ".join(record.getMessage() for record in caplog.records)
    assert "Zinnia" not in text and str(families.a1.pk) not in text
    assert families.a.cognito_sub not in text and "children/" not in text
