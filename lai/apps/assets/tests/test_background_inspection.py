"""Inspect in background: the asset.inspect job from the asset version admin (inline backend)."""

import pytest
from django.core.management import call_command

from apps.assets.models import AssetVersion
from apps.assets.tests.helpers import glb_bytes, make_definition
from apps.jobs.models import JobStatus, ProcessingJob

from .test_admin import EDITORS, run_action, staff, upload_through_admin

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture(autouse=True)
def roles():
    call_command("ensure_asset_roles", verbosity=0)


def test_inspection_reports_glb_metadata_without_changing_the_version():
    editor = staff("editor", EDITORS)
    upload_through_admin(editor, make_definition())
    version = AssetVersion.objects.get()
    before = (version.metadata, version.validation_report, version.status)
    response = run_action(editor, "inspect_in_background", version)
    assert b"Inspection submitted for 1 version(s); 1 already finished" in response.content
    job = ProcessingJob.objects.get()
    assert job.status == JobStatus.COMPLETED and job.kind == "asset.inspect"
    assert (job.subject_type, job.subject_id) == ("assets.assetversion", str(version.pk))
    meta = job.result["metadata"]
    assert meta["glbVersion"] == 2 and meta["byteLength"] == len(glb_bytes())
    assert meta["counts"]["nodes"] >= 1 and meta["problems"] == []
    version.refresh_from_db()
    assert (version.metadata, version.validation_report, version.status) == before


def test_inspection_needs_asset_view_permission():
    editor = staff("editor", EDITORS)
    upload_through_admin(editor, make_definition())
    version = AssetVersion.objects.get()
    outsider = staff("outsider")
    run_action(outsider, "inspect_in_background", version)
    assert not ProcessingJob.objects.exists()


def test_disabled_jobs_backend_is_reported(settings):
    editor = staff("editor", EDITORS)
    upload_through_admin(editor, make_definition())
    settings.LAI_JOBS_BACKEND = "disabled"
    response = run_action(editor, "inspect_in_background", AssetVersion.objects.get())
    assert b"Background jobs are unavailable" in response.content
    assert not ProcessingJob.objects.exists()
