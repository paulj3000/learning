"""Inspect in background in the version admin: permission, no duplicate jobs, latest result."""

import pytest
from django.contrib.auth.models import Permission
from django.core.management import call_command
from django.test import Client
from django.utils import timezone

from apps.assets import jobs as asset_jobs
from apps.assets.models import AssetVersion, VersionStatus
from apps.game_sessions.tests.test_concurrency import race
from apps.jobs import services as jobs
from apps.jobs.models import JobStatus, ProcessingJob
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

from .admin_jobs import stored_version, use_fake_sqs
from .test_admin import EDITORS, PUBLISHERS, VERSIONS, run_action, staff

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

INSPECT = "inspect_in_background"


@pytest.fixture(autouse=True)
def roles():
    call_command("ensure_asset_roles", verbosity=0)


@pytest.fixture
def sqs(settings):
    yield use_fake_sqs(settings)
    jobs.set_aws_clients()


@pytest.fixture
def version():
    return stored_version()


def account(username, *codenames):
    user = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{username}", admin_username=username, is_staff=True
    )
    for codename in codenames:
        user.user_permissions.add(Permission.objects.get(codename=codename))
    client = Client()
    client.force_login(user, backend="apps.users.backends.AdminPasswordBackend")
    return client


def inspections():
    return ProcessingJob.objects.filter(kind="asset.inspect")


# --- W3(d): permission ---


def test_view_only_staff_do_not_see_or_run_inspect(version, sqs):
    viewer = account("viewer", "view_assetversion")
    listing = viewer.get(VERSIONS)
    assert listing.status_code == 200 and INSPECT.encode() not in listing.content
    run_action(viewer, INSPECT, version)
    assert not inspections().exists()


def test_staff_with_the_validate_permission_can_inspect(version, sqs):
    uploader = account("uploader", "view_assetversion", "add_assetversion")
    assert INSPECT.encode() in uploader.get(VERSIONS).content
    run_action(uploader, INSPECT, version)
    assert inspections().count() == 1


def test_publish_still_needs_its_own_permission(version, sqs):
    uploader = account("uploader", "view_assetversion", "add_assetversion")
    listing = uploader.get(VERSIONS).content
    assert b"publish_versions" not in listing and b"retire_versions" not in listing
    run_action(uploader, "publish_versions", version)
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED


# --- W3(c): no duplicates ---


def test_an_inspection_already_running_is_skipped(version, sqs):
    editor = staff("editor", EDITORS)
    asset_jobs.submit_inspection(version, None)
    response = run_action(editor, INSPECT, version)
    assert inspections().count() == 1
    assert b"Skipped 1 version(s) with an inspection already running." in response.content


@pytest.mark.parametrize("status", [JobStatus.COMPLETED, JobStatus.FAILED])
def test_a_finished_inspection_does_not_block_a_new_one(version, sqs, status):
    editor = staff("editor", EDITORS)
    job = asset_jobs.submit_inspection(version, None)
    ProcessingJob.objects.filter(pk=job.pk).update(status=status, finished_at=timezone.now())
    run_action(editor, INSPECT, version)
    assert inspections().count() == 2


def test_a_running_validation_does_not_block_an_inspection(version, sqs):
    from apps.assets.processing import submit_model_validation

    submit_model_validation(version, user=None)
    run_action(staff("editor", EDITORS), INSPECT, version)
    assert inspections().count() == 1


def test_only_the_idle_version_is_queued(sqs):
    busy, idle = stored_version(asset_id="npc-a"), stored_version(asset_id="npc-b")
    asset_jobs.submit_inspection(busy, None)
    response = run_action(staff("editor", EDITORS), INSPECT, busy, idle)
    assert inspections().filter(subject_id=str(idle.pk)).count() == 1
    assert inspections().filter(subject_id=str(busy.pk)).count() == 1
    assert b"Skipped 1 version(s)" in response.content
    assert b"Inspection submitted for 1 version(s)" in response.content


def test_submitting_twice_in_a_row_queues_one_job(version, sqs):
    editor = staff("editor", EDITORS)
    run_action(editor, INSPECT, version)
    run_action(editor, INSPECT, version)
    assert inspections().count() == 1


@pytest.mark.django_db(transaction=True)
def test_simultaneous_submissions_queue_one_job(sqs):
    version = stored_version()
    results = race(lambda: asset_jobs.submit_inspection_once(version, None), count=4)
    assert not [r for r in results if isinstance(r, Exception)], results
    assert len([r for r in results if r is not asset_jobs.ALREADY_RUNNING]) == 1
    assert len([r for r in results if r is asset_jobs.ALREADY_RUNNING]) == 3
    assert inspections().count() == 1


def test_a_version_deleted_meanwhile_is_not_reported_as_running(version, sqs):
    gone = AssetVersion(pk=version.pk + 10_000, storage_key=version.storage_key)
    assert asset_jobs.submit_inspection_once(gone, None) is None
    assert inspections().count() == 0


# --- W3(b): latest result on the version page ---


def page(client, version):
    response = client.get(f"{VERSIONS}{version.pk}/change/")
    assert response.status_code == 200
    return response.content.decode()


def test_no_inspection_section_without_a_job(version):
    assert "Latest inspection" not in page(staff("publisher", PUBLISHERS), version)


def test_the_page_shows_the_latest_inspection_result(version, sqs):
    client = staff("publisher", PUBLISHERS)
    job = asset_jobs.submit_inspection(version, None)
    ProcessingJob.objects.filter(pk=job.pk).update(
        status=JobStatus.COMPLETED,
        finished_at=timezone.now(),
        result={
            "metadata": {
                "width": 64,
                "height": 32,
                "note": "<script>x</script>",
                "counts": {"nodes": 3},
                "problems": ["json_invalid"],
            }
        },
    )
    body = page(client, version)
    assert "Latest inspection" in body and "Completed" in body
    assert "<dt>width</dt><dd>64</dd>" in body and "<dt>counts.nodes</dt><dd>3</dd>" in body
    assert "json_invalid" in body
    assert "<script>x</script>" not in body and "&lt;script&gt;x&lt;/script&gt;" in body


def test_a_failed_inspection_shows_only_its_code(version, sqs):
    job = asset_jobs.submit_inspection(version, None)
    ProcessingJob.objects.filter(pk=job.pk).update(
        status=JobStatus.FAILED, error_code="object_missing", finished_at=timezone.now()
    )
    body = page(staff("publisher", PUBLISHERS), version)
    assert "Failed" in body and "object_missing" in body
