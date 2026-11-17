"""Background validation in the asset version admin (LAI-LAMBDA-007, WAVE3_INTERFACES section 5):
the read-only "Background validation" section, the "Validate in background" action, and their
permissions. Every job value is escaped; nothing here changes a version or publishes."""

import html

import pytest
from django.contrib.auth.models import Permission
from django.core.management import call_command

from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.tests.helpers import glb_bytes, gltf_json_bytes, make_definition
from apps.catalog.models import AssetStatus
from apps.jobs import processing
from apps.jobs.models import JobState, ProcessingJob
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

from .test_admin import EDITORS, PUBLISHERS, VERSIONS, run_action, staff
from .validation_jobs import METADATA, complete, retry_attempt, set_state, submit, upload

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

SECTION = b"Background validation"
NO_JOB = b"No background validation has run for this version."
SCRIPT = "<script>alert(1)</script>"
IMG = '"><img src=x onerror=1>'


@pytest.fixture(autouse=True)
def roles():
    call_command("ensure_asset_roles", verbosity=0)


@pytest.fixture(autouse=True)
def local_backend(settings):
    settings.LAI_PROCESSING_BACKEND = "local"  # jobs are submitted, nothing runs


@pytest.fixture
def version():
    return upload(make_definition("npc-pip"), glb_bytes())


def page(client, version) -> str:
    response = client.get(f"{VERSIONS}{version.pk}/change/")
    assert response.status_code == 200
    return response.content.decode()


def text(content: str) -> str:
    return html.unescape(content)


# --- the section --------------------------------------------------------------------------------


def test_flag_off_and_no_job_leaves_the_page_as_before(version):
    content = page(staff("editor", EDITORS), version)
    assert "Background validation" not in content and "Processing status" not in content


def test_flag_on_and_no_job_says_so(version, settings):
    settings.LAI_ASSET_ASYNC_VALIDATION = "on"
    content = page(staff("editor", EDITORS), version)
    assert "Background validation" in content and NO_JOB.decode() in content
    assert "Passed" not in content


def test_a_job_shows_the_section_even_with_the_flag_off(version):
    job = submit(version)
    content = page(staff("editor", EDITORS), version)
    assert "Queued: waiting for the background validator. There is no result yet." in content
    assert f'href="/admin/jobs/processingjob/{job.pk}/change/"' in content
    assert "No result yet." in content


def test_processing_state(version):
    set_state(submit(version), JobState.PROCESSING)
    content = page(staff("editor", EDITORS), version)
    assert "Processing: the background validator is reading the file." in content
    assert "Passed" not in content


def test_awaiting_retry_names_the_attempt(version):
    retry_attempt(submit(version))
    content = text(page(staff("editor", EDITORS), version))
    assert "Awaiting retry" in content
    assert "Attempt 2 is waiting to run. There is no result yet." in content


def test_failed_state_shows_retry_eligibility(version):
    set_state(submit(version), JobState.FAILED, error_code="processor_error")
    content = text(page(staff("editor", EDITORS), version))
    assert "Background validation failed to run, so there is no result." in content
    assert "<dt>Requeue allowed</dt><dd>Yes</dd>" in content
    assert "Passed" not in content


def test_expired_state(version):
    set_state(submit(version), JobState.FAILED, error_code="job_expired")
    content = page(staff("editor", EDITORS), version)
    assert "<dd>Expired</dd>" in content
    assert "expired before a result arrived. There is no result." in content


def test_cancelled_state(version):
    job = submit(version)
    assert processing.cancel_job(job, user=None)
    content = text(page(staff("editor", EDITORS), version))
    assert "Background validation was cancelled. There is no result." in content
    assert "<dt>Requeue allowed</dt><dd>No</dd>" in content


def test_a_passing_result_shows_its_verdict_and_model_information(version):
    complete(version)
    raw = page(staff("editor", EDITORS), version)
    content = text(raw)
    assert "Passed: the background validator found no errors in this file." in content
    assert "<dt>Verdict</dt><dd>Pass</dd>" in content
    assert "<dt>Status</dt><dd>Ready for review</dd>" in content
    assert "<dt>Processor</dt><dd>asset.glb_validator 1.0.0</dd>" in content
    assert "<dt>Profile</dt><dd>glb-default 1</dd>" in content
    assert "<dt>Meshes</dt><dd>2</dd>" in content and "<dt>Primitives</dt><dd>3</dd>" in content
    assert "<dt>Triangles</dt><dd>2048</dd>" in content
    assert "<dt>Vertices</dt><dd>1234</dd>" in content
    assert "min (-0.5, 0.0, -0.25), max (0.5, 1.8, 0.25)" in content
    assert "<td>Armature|mixamo.com|Layer0</td><td>1.25</td>" in content
    assert "<td>0</td><td>image/png</td><td>512 x 256</td>" in content
    assert "<td>Armature</td><td>52</td>" in content
    assert "<li>Body</li>" in content and "KHR_materials_unlit" in content
    assert "Blender &lt;b&gt;4.2&lt;/b&gt;" in raw  # the generator, escaped


def test_a_failing_verdict_is_shown_as_rejected(version):
    finding = {"code": "bad_index", "severity": "error", "message": "Index out of range."}
    complete(version, verdict="fail", findings=[{**finding, "path": "/meshes/0"}])
    content = text(page(staff("editor", EDITORS), version))
    assert "Rejected: the background validator found errors in this file." in content
    assert "<dt>Verdict</dt><dd>Fail</dd>" in content and "<dt>Errors</dt><dd>1</dd>" in content
    row = "<td>bad_index</td><td>error</td><td>Index out of range.</td><td><code>/meshes/0</code>"
    assert row in content
    assert "Passed" not in content


def test_a_result_for_another_file_is_not_shown_as_a_pass(version):
    job = complete(version)
    ProcessingJob.objects.filter(pk=job.pk).update(input_sha256="0" * 64)
    content = text(page(staff("editor", EDITORS), version))
    assert "does not match this version's file" in content
    assert "Passed" not in content


def test_an_older_validator_pass_says_publication_needs_a_new_one(version):
    job = complete(version)
    ProcessingJob.objects.filter(pk=job.pk).update(processor_version="0.9.0")
    content = page(staff("editor", EDITORS), version)
    assert "older validator version. Publishing needs a new validation" in content


def test_run_warnings_and_outcome_are_shown(version):
    job = complete(version, warnings=[{"code": "metadata_list_truncated"}])
    ProcessingJob.objects.filter(pk=job.pk).update(subject_outcome="version_validated")
    content = text(page(staff("editor", EDITORS), version))
    assert "<dt>Run warnings</dt><dd>metadata_list_truncated</dd>" in content
    assert "The version was marked validated." in content


def test_asset_controlled_names_are_escaped(version):
    metadata = {
        **METADATA,
        "material_names": [SCRIPT, IMG],
        "animations": [{"name": SCRIPT, "duration_seconds": 1.0}, {"name": IMG}],
        "skins": [{"name": IMG, "joint_count": 1}],
        "generator": SCRIPT,
        "extensions_used": [IMG],
    }
    finding = {"code": SCRIPT, "severity": "warning", "message": IMG, "path": SCRIPT}
    complete(version, metadata=metadata, findings=[finding], warnings=[{"code": SCRIPT}])
    content = page(staff("editor", EDITORS), version)
    assert SCRIPT not in content and "<img src=x" not in content
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in content
    assert "&quot;&gt;&lt;img src=x onerror=1&gt;" in content


def test_findings_are_labelled_by_source(version):
    AssetVersion.objects.filter(pk=version.pk).update(
        validation_report=[
            {"code": "large_file", "severity": "warning", "message": "Big.", "path": ""},
            {
                "code": "bad_index",
                "severity": "error",
                "message": "Index out of range.",
                "path": "/meshes/0",
                "source": "processing",
            },
        ]
    )
    content = page(staff("editor", EDITORS), version)
    upload_at = content.index("Upload checks")
    processing_at = content.index("<p><strong>Background validation</strong></p>")
    assert upload_at < content.index("large_file") < processing_at < content.index("bad_index")


def test_upload_only_findings_render_as_before(version):
    AssetVersion.objects.filter(pk=version.pk).update(
        validation_report=[
            {"code": "large_file", "severity": "warning", "message": "Big.", "path": ""}
        ]
    )
    content = page(staff("editor", EDITORS), version)
    assert "<li><strong>warning</strong> large_file: Big. <code></code></li>" in content
    assert "Upload checks" not in content


# --- the action --------------------------------------------------------------------------------


def test_validate_in_background_submits_once_and_never_changes_the_version(version):
    editor = staff("editor", EDITORS)
    before = (version.status, version.metadata, version.validation_report, version.published_at)
    response = run_action(editor, "validate_in_background", version)
    assert b"Background validation submitted for 1 version(s)" in response.content
    job = ProcessingJob.objects.get()
    assert (job.kind, job.subject_id, job.state) == (
        "asset.validate_model",
        str(version.version_id),
        JobState.QUEUED,
    )
    assert job.submitted_by.admin_username == "editor"
    response = run_action(editor, "validate_in_background", version)
    assert b"already queued or running" in response.content
    assert ProcessingJob.objects.count() == 1
    version.refresh_from_db()
    assert (
        version.status,
        version.metadata,
        version.validation_report,
        version.published_at,
    ) == before


def test_a_finished_job_is_reported_not_duplicated(version):
    complete(version)
    response = run_action(staff("editor", EDITORS), "validate_in_background", version)
    assert (
        b"A background validation of this file already finished (Ready for review)"
        in response.content
    )
    assert ProcessingJob.objects.count() == 1
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED  # never published by the action


def test_a_published_version_can_be_revalidated_without_changing_it(version):
    from apps.assets import services

    services.publish_version(version)
    run_action(staff("editor", EDITORS), "validate_in_background", version)
    assert ProcessingJob.objects.count() == 1
    version.refresh_from_db()
    assert version.status == VersionStatus.PUBLISHED


def test_retired_assets_and_other_formats_are_refused(version):
    other = upload(make_definition("npc-bo"), gltf_json_bytes())
    type(version.asset).objects.filter(pk=version.asset.pk).update(status=AssetStatus.RETIRED)
    response = run_action(staff("editor", EDITORS), "validate_in_background", version, other)
    assert b"This asset is retired, so it is not validated." in response.content
    assert b"Only GLB models can be validated in background." in response.content
    assert not ProcessingJob.objects.exists()


def test_a_disabled_processing_backend_is_reported(version, settings):
    settings.LAI_PROCESSING_BACKEND = "disabled"
    response = run_action(staff("editor", EDITORS), "validate_in_background", version)
    assert b"Background validation is turned off on this server." in response.content
    assert not ProcessingJob.objects.exists()


def test_a_refused_submission_is_reported_safely(version, monkeypatch):
    def refuse(*args, **kwargs):
        raise processing.ProcessingJobsError("unsupported_processor")

    monkeypatch.setattr(processing, "submit_processing_job", refuse)
    response = run_action(staff("editor", EDITORS), "validate_in_background", version)
    assert b"Background validation could not start (unsupported_processor)." in response.content


def test_publishers_may_validate(version):
    run_action(staff("publisher", PUBLISHERS), "validate_in_background", version)
    assert ProcessingJob.objects.count() == 1


def test_view_only_staff_cannot_validate_or_see_the_action(version):
    account = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}viewer", admin_username="viewer", is_staff=True
    )
    account.user_permissions.add(Permission.objects.get(codename="view_assetversion"))
    from django.test import Client

    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    listing = client.get(VERSIONS)
    assert listing.status_code == 200 and b"validate_in_background" not in listing.content
    assert b"inspect_in_background" in listing.content
    run_action(client, "validate_in_background", version)
    assert not ProcessingJob.objects.exists()


def test_staff_without_an_asset_role_cannot_validate(version):
    run_action(staff("outsider"), "validate_in_background", version)
    assert not ProcessingJob.objects.exists()


def test_non_staff_cannot_validate_or_see_the_section(version):
    account = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}parent", admin_username="parent", is_staff=False
    )
    for codename in ("view_assetversion", "add_assetversion"):
        account.user_permissions.add(Permission.objects.get(codename=codename))
    from django.test import Client

    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    response = client.post(
        VERSIONS, {"action": "validate_in_background", "_selected_action": [version.pk]}
    )
    assert response.status_code == 302 and "/login/" in response["Location"]
    assert client.get(f"{VERSIONS}{version.pk}/change/").status_code == 302
    assert not ProcessingJob.objects.exists()
