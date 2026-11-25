"""Model validation results in the asset version admin (LAI-LAMBDA-007, ADR-064).

The read-only "Background validation" section, the "Validate in background" action, and their
permissions, on the canonical `apps.jobs.ProcessingJob`. Completed jobs carry the real contract
result of the GLB validator over the stored bytes. Every job value is escaped; nothing here
changes a version or publishes it.
"""

import html

import pytest
from django.contrib.auth.models import Permission
from django.core.management import call_command
from django.test import Client

from apps.assets import services
from apps.assets.models import AssetVersion, FileFormat, VersionStatus
from apps.assets.processing import current_processor
from apps.catalog.models import AssetStatus
from apps.jobs import services as jobs
from apps.jobs.models import JobStatus, ProcessingJob
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

from .admin_jobs import (
    MIXAMO,
    completed,
    dispatched,
    failed,
    model_glb,
    real_result,
    running,
    stored_version,
    submit,
    use_fake_sqs,
)
from .test_admin import EDITORS, PUBLISHERS, VERSIONS, run_action, staff

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

NO_JOB = "No background validation has run for this version."
SCRIPT = "<script>alert(1)</script>"
IMG = '"><img src=x onerror=1>'
SCRIPT_ESCAPED = "&lt;script&gt;alert(1)&lt;/script&gt;"
IMG_ESCAPED = "&quot;&gt;&lt;img src=x onerror=1&gt;"
CLIP = '<code style="white-space: pre">{}</code>'


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


@pytest.fixture
def editor():
    return staff("editor", EDITORS)


def page(client, version) -> str:
    response = client.get(f"{VERSIONS}{version.pk}/change/")
    assert response.status_code == 200
    return response.content.decode()


def text(content: str) -> str:
    return html.unescape(content)


def row(term: str, value) -> str:
    return f"<dt>{term}</dt><dd>{value}</dd>"


def unchanged(version):
    return (
        version.status,
        version.metadata,
        version.validation_report,
        version.validated_at,
        version.published_at,
        version.sha256,
    )


# --- the section: visibility ---------------------------------------------------------------------


def test_flag_off_and_no_job_leaves_the_page_unchanged(version, editor):
    content = page(editor, version)
    assert "Background validation" not in content
    assert "Processing status" not in content and "Model information" not in content


def test_flag_on_and_no_job_says_so(version, editor, settings):
    settings.LAI_ASSET_ASYNC_VALIDATION = "on"
    content = page(editor, version)
    assert "Background validation" in content and NO_JOB in content
    assert "Passed" not in content and "No result yet." in content


# --- the section: every status ------------------------------------------------------------------


def test_a_queued_job_not_yet_sent_shows_the_section_with_the_flag_off(version, editor, sqs):
    job = submit(version)
    content = page(editor, version)
    assert "Queued: not yet sent to the background validator. There is no result yet." in content
    assert row("Status", "Queued") in content
    assert row("Outcome", "Not applied to the version yet.") in content
    assert row("Worker attempts", 0) in content and row("Deliveries", 0) in content
    assert row("Error code", "-") in content and row("Started", "-") in content
    assert f'href="/admin/jobs/processingjob/{job.pk}/change/"' in content
    assert "a stuck job can be marked failed there" in content
    assert "No result yet." in content and "Passed" not in content


def test_a_dispatched_job_is_queued(version, editor, sqs):
    dispatched(submit(version))
    content = page(editor, version)
    assert "Queued: waiting for the background validator. There is no result yet." in content
    assert row("Status", "Queued") in content


def test_a_running_job_is_processing(version, editor, sqs):
    running(submit(version))
    content = page(editor, version)
    assert "Processing: the background validator is reading the file." in content
    assert row("Status", "Processing") in content and row("Worker attempts", 1) in content
    assert "Passed" not in content and "No result yet." in content


@pytest.mark.parametrize(
    ("code", "label", "notice"),
    [
        ("processor_error", "Failed", "Background validation failed, so there is no result."),
        ("marked_failed", "Failed", "Background validation failed, so there is no result."),
        ("timeout", "Failed: timed out", "Background validation timed out, so there is no result."),
        (
            "submit_failed",
            "Could not be sent",
            "The validation request could not be sent to the background validator",
        ),
    ],
)
def test_failed_jobs(version, editor, sqs, code, label, notice):
    failed(submit(version), code)
    content = text(page(editor, version))
    assert row("Status", label) in content and notice in content
    assert row("Error code", code) in content
    assert row("Outcome", "No result; the version was not changed.") in content
    assert "Run Validate in background again to retry." in content
    assert "Passed" not in content and "No result yet." in content


def test_a_passing_result_shows_its_verdict_and_model_information(version, editor, sqs):
    completed(submit(version))
    raw = page(editor, version)
    content = text(raw)
    processor_id, processor_version = current_processor()
    assert "Passed: the background validator found no errors in this file." in content
    assert row("Status", "Completed") in content
    assert row("Outcome", "The result was recorded; the version was not changed.") in content
    assert row("Worker attempts", 1) in content and row("Deliveries", 2) in content
    assert row("Verdict", "Pass") in content and row("Errors", 0) in content
    assert row("Processor", f"{processor_id} {processor_version}") in content
    assert row("Profile", "glb-default 1") in content
    assert row("Meshes", 1) in content and row("Primitives", 1) in content
    assert row("Triangles", 2) in content and row("Vertices", 4) in content
    assert row("Bounds", "min (-0.5, 0.0, -0.5), max (0.5, 0.0, 0.5)") in content
    assert row("Generator", "Blender 4.2") in content
    assert "<li>Body</li>" in content
    assert "<td>0</td><td>image/png</td><td>64 x 32</td>" in content
    assert "<td>Armature</td><td>2</td>" in content
    assert f"<td>{CLIP.format(MIXAMO)}</td><td>1.25</td>" in content  # the exact clip name
    assert f"<td>{CLIP.format('Idle')}</td><td>2.5</td>" in content


def test_a_failing_verdict_is_shown_as_rejected_with_its_findings(editor, sqs):
    version = stored_version(model_glb(texture=(100_000, 100_000)))
    job = completed(submit(version))
    assert job.result["verdict"] == "fail"
    content = text(page(editor, version))
    assert "Rejected: the background validator found errors in this file." in content
    assert row("Verdict", "Fail") in content and row("Errors", 1) in content
    assert "<td>texture_too_large</td><td>error</td>" in content
    assert "Passed" not in content


def test_run_warnings_and_the_applied_outcome_are_shown(version, editor, sqs):
    job = submit(version)
    result = real_result(job)
    result["warnings"] = [{"code": "metadata_list_truncated", "message": "Shortened."}]
    completed(job, result=result, outcome="version_validated")
    content = text(page(editor, version))
    assert row("Run warnings", "metadata_list_truncated") in content
    assert row("Outcome", "The version was marked validated.") in content


@pytest.mark.parametrize(
    ("outcome", "label"),
    [
        ("version_rejected", "The version was marked rejected."),
        ("version_missing", "The version no longer exists."),
        ("processing_failed", "No result; the version was not changed."),
    ],
)
def test_outcomes_in_plain_words(version, editor, sqs, outcome, label):
    completed(submit(version), outcome=outcome)
    assert row("Outcome", label) in text(page(editor, version))


@pytest.mark.parametrize("outcome", ["checksum_mismatch", "attempt_mismatch", "result_invalid"])
def test_a_mismatched_result_is_never_a_pass(version, editor, sqs, outcome):
    completed(submit(version), outcome=outcome)
    content = text(page(editor, version))
    assert (
        row(
            "Outcome", "The result does not match this version's file; the version was not changed."
        )
        in content
    )
    assert "This result does not match this version's file, so it does not count" in content
    assert "Passed" not in content


def test_a_result_for_other_bytes_is_never_a_pass(version, editor, sqs):
    completed(submit(version))
    AssetVersion.objects.filter(pk=version.pk).update(sha256="0" * 64)
    content = text(page(editor, version))
    assert "does not match this version's file, so it does not count" in content
    assert "Passed" not in content


def test_an_outdated_validator_pass_says_publishing_needs_a_new_validation(version, editor, sqs):
    job = submit(version)
    result = real_result(job)
    result["processor"]["processor_version"] = "0.0.1"
    completed(job, result=result)
    content = page(editor, version)
    assert (
        "This file passed with an older validator version. Publishing needs a new validation"
        in content
    )
    assert "Passed:" not in content


def test_job_and_asset_controlled_text_is_escaped(editor, sqs):
    version = stored_version(model_glb((SCRIPT, IMG), material=SCRIPT, skin=IMG, generator=SCRIPT))
    job = submit(version)
    result = real_result(job)
    result["findings"] = [
        {"code": "odd_name", "severity": "warning", "message": SCRIPT, "path": IMG},
        {"code": "bad_name", "severity": "error", "message": IMG, "path": SCRIPT},
    ]
    result["warnings"] = [{"code": SCRIPT, "message": IMG}]
    completed(job, result=result)
    AssetVersion.objects.filter(pk=version.pk).update(
        validation_report=[
            {"code": "big", "severity": "warning", "message": SCRIPT, "path": IMG},
            {
                "code": "bad",
                "severity": "error",
                "message": IMG,
                "path": "",
                "source": "processing",
            },
        ]
    )
    content = page(editor, version)
    assert SCRIPT not in content and "<img src=x" not in content
    assert content.count(SCRIPT_ESCAPED) >= 6 and content.count(IMG_ESCAPED) >= 5
    assert f"<td>{CLIP.format(SCRIPT_ESCAPED)}</td><td>1.25</td>" in content  # clip names
    assert f"<td>{CLIP.format(IMG_ESCAPED)}</td><td>2.5</td>" in content
    assert f"<li>{SCRIPT_ESCAPED}</li>" in content  # material
    assert f"<td>{IMG_ESCAPED}</td><td>2</td>" in content  # skin
    assert row("Generator", SCRIPT_ESCAPED) in content


# --- findings by source --------------------------------------------------------------------------


def test_findings_are_labelled_by_source(version, editor):
    AssetVersion.objects.filter(pk=version.pk).update(
        validation_report=[
            {"code": "large_file", "severity": "warning", "message": "Big.", "path": ""},
            {
                "code": "texture_too_large",
                "severity": "error",
                "message": "Too large.",
                "path": "images[0]",
                "source": "processing",
            },
        ]
    )
    content = page(editor, version)
    upload_at = content.index("<p><strong>Upload checks</strong></p>")
    processing_at = content.index("<p><strong>Background validation</strong></p>")
    assert upload_at < content.index("large_file") < processing_at
    assert processing_at < content.index("texture_too_large")


def test_processing_findings_only_say_there_are_no_upload_findings(version, editor):
    AssetVersion.objects.filter(pk=version.pk).update(
        validation_report=[
            {"code": "x", "severity": "error", "message": "X.", "path": "", "source": "processing"}
        ]
    )
    content = page(editor, version)
    assert "<p><strong>Upload checks</strong></p>No findings." in content


def test_upload_only_findings_render_as_before(version, editor):
    AssetVersion.objects.filter(pk=version.pk).update(
        validation_report=[
            {"code": "large_file", "severity": "warning", "message": "Big.", "path": ""}
        ]
    )
    content = page(editor, version)
    assert "<li><strong>warning</strong> large_file: Big. <code></code></li>" in content
    assert "Upload checks" not in content


# --- the action -----------------------------------------------------------------------------------


@pytest.mark.parametrize("flag", ["off", "on"])
def test_validate_submits_once_and_never_changes_the_version(version, editor, sqs, settings, flag):
    settings.LAI_ASSET_ASYNC_VALIDATION = flag
    before = unchanged(version)
    response = run_action(editor, "validate_in_background", version)
    assert b"Background validation submitted for 1 version(s)" in response.content
    job = ProcessingJob.objects.get()
    assert (job.kind, job.subject_type, job.subject_id, job.status) == (
        "asset.validate_model",
        "assets.assetversion",
        str(version.pk),
        JobStatus.PENDING,
    )
    assert job.submitted_by.admin_username == "editor"
    response = run_action(editor, "validate_in_background", version)
    assert b"already queued or running (Queued)" in response.content
    assert ProcessingJob.objects.count() == 1
    version.refresh_from_db()
    assert unchanged(version) == before


def test_a_running_job_is_reported_not_duplicated(version, editor, sqs):
    running(submit(version))
    response = run_action(editor, "validate_in_background", version)
    assert b"already queued or running (Processing)" in response.content
    assert ProcessingJob.objects.count() == 1


def test_a_completed_job_for_the_same_file_is_reported_not_duplicated(version, editor, sqs):
    completed(submit(version))
    response = run_action(editor, "validate_in_background", version)
    assert b"already validated this file (Completed)" in response.content
    assert ProcessingJob.objects.count() == 1


def test_a_failed_job_is_retried_with_a_new_one(version, editor, sqs):
    first = failed(submit(version), "timeout")
    response = run_action(editor, "validate_in_background", version)
    assert b"The earlier background validation failed, so a new one was submitted." in (
        response.content
    )
    assert b"Background validation submitted for 1 version(s)" in response.content
    assert ProcessingJob.objects.count() == 2
    latest = ProcessingJob.objects.exclude(pk=first.pk).get()
    assert latest.status == JobStatus.PENDING
    assert latest.idempotency_key == first.idempotency_key
    assert latest.payload["attempt_id"] != first.payload["attempt_id"]
    assert row("Status", "Queued") in page(editor, version)


FAILED_VERDICT = "did not pass this file, so a new one was submitted"
NOT_APPLIED = "result was not applied to this version (it was refused or superseded)"


@pytest.mark.parametrize(
    "outcome, verdict, message",
    [
        ("version_rejected", "fail", FAILED_VERDICT),
        ("result_recorded", "fail", FAILED_VERDICT),
        ("checksum_mismatch", "pass", NOT_APPLIED),
        ("result_superseded", "pass", NOT_APPLIED),
        ("result_invalid", "fail", NOT_APPLIED),
    ],
)
def test_a_refused_or_failing_result_may_be_resubmitted_explicitly(
    version, editor, sqs, outcome, verdict, message
):
    first = completed(submit(version), outcome=outcome)
    first.result = {**first.result, "verdict": verdict}
    first.save(update_fields=["result"])
    before = unchanged(version)
    response = run_action(editor, "validate_in_background", version)
    content = text(response.content.decode())
    assert message in content
    assert (NOT_APPLIED if message == FAILED_VERDICT else FAILED_VERDICT) not in content
    assert ProcessingJob.objects.count() == 2
    version.refresh_from_db()
    assert unchanged(version) == before


def test_resubmission_stops_at_the_attempt_cap(version, editor, sqs, settings):
    settings.LAI_ASSET_VALIDATION_MAX_ATTEMPTS = 2
    failed(submit(version), "timeout")
    failed(submit(version), "cancelled")
    response = run_action(editor, "validate_in_background", version)
    assert b"has reached the limit of background validation attempts" in response.content
    assert ProcessingJob.objects.count() == 2


def test_a_published_model_is_revalidated_without_changing_it(version, editor):
    """The inline backend runs the real validator; the result is only recorded on the job."""
    services.publish_version(version)
    version.refresh_from_db()
    before = unchanged(version)
    run_action(editor, "validate_in_background", version)
    job = ProcessingJob.objects.get()
    assert job.status == JobStatus.COMPLETED and job.subject_outcome == "result_recorded"
    version.refresh_from_db()
    assert unchanged(version) == before and version.status == VersionStatus.PUBLISHED
    content = text(page(editor, version))
    assert "Passed: the background validator found no errors in this file." in content


def test_retired_assets_and_other_formats_are_refused(version, editor, sqs):
    other = stored_version(asset_id="npc-bo", format=FileFormat.GLTF)
    type(version.asset).objects.filter(pk=version.asset.pk).update(status=AssetStatus.RETIRED)
    response = run_action(editor, "validate_in_background", version, other)
    assert b"This asset is retired, so it is not validated." in response.content
    assert b"Only GLB models can be validated in background." in response.content
    assert not ProcessingJob.objects.exists()


def test_disabled_background_jobs_are_reported(version, editor, settings):
    settings.LAI_JOBS_BACKEND = "disabled"
    response = run_action(editor, "validate_in_background", version)
    assert b"Background jobs are turned off on this server, so nothing was validated." in (
        response.content
    )
    assert not ProcessingJob.objects.exists()


def test_a_refused_submission_is_reported_safely(version, editor, monkeypatch):
    def refuse(*args, **kwargs):
        raise jobs.JobsError("payload_too_large")

    monkeypatch.setattr(jobs, "submit", refuse)
    response = run_action(editor, "validate_in_background", version)
    assert b"Background validation could not start (payload_too_large)." in response.content
    assert not ProcessingJob.objects.exists()


# --- permissions ---------------------------------------------------------------------------------


def _account(username, *codenames, is_staff=True):
    account = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{username}",
        admin_username=username,
        is_staff=is_staff,
    )
    for codename in codenames:
        account.user_permissions.add(Permission.objects.get(codename=codename))
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    return client


@pytest.mark.parametrize(
    "client_factory",
    [
        lambda: staff("publisher", PUBLISHERS),
        lambda: staff("root", superuser=True),
        lambda: _account("uploader", "view_assetversion", "add_assetversion"),
    ],
)
def test_staff_who_may_upload_and_view_may_validate(version, sqs, client_factory):
    run_action(client_factory(), "validate_in_background", version)
    assert ProcessingJob.objects.count() == 1


def test_view_only_staff_see_the_section_but_cannot_validate(version, sqs):
    client = _account("viewer", "view_assetversion")
    submit(version)
    assert "Queued: not yet sent" in page(client, version)
    listing = client.get(VERSIONS)
    assert listing.status_code == 200 and b"validate_in_background" not in listing.content
    assert b"inspect_in_background" not in listing.content  # inspecting needs validate too
    run_action(client, "validate_in_background", version)
    assert ProcessingJob.objects.count() == 1


def test_view_only_staff_cannot_resubmit_a_failed_job(version, sqs):
    failed(submit(version), "timeout")
    run_action(_account("viewer", "view_assetversion"), "validate_in_background", version)
    run_action(staff("outsider"), "validate_in_background", version)
    assert ProcessingJob.objects.count() == 1


def test_add_without_view_cannot_validate(version, sqs):
    client = _account("adder", "add_assetversion")
    run_action(client, "validate_in_background", version)
    assert not ProcessingJob.objects.exists()


def test_staff_without_an_asset_role_cannot_validate(version, sqs):
    run_action(staff("outsider"), "validate_in_background", version)
    assert not ProcessingJob.objects.exists()


def test_non_staff_cannot_validate_or_see_the_section(version, sqs):
    client = _account("parent", "view_assetversion", "add_assetversion", is_staff=False)
    response = client.post(
        VERSIONS, {"action": "validate_in_background", "_selected_action": [version.pk]}
    )
    assert response.status_code == 302 and "/login/" in response["Location"]
    assert client.get(f"{VERSIONS}{version.pk}/change/").status_code == 302
    assert not ProcessingJob.objects.exists()


# --- review fixes: lost update, recovery, messages, publishing line, clip names, audit ----------


def test_saving_notes_never_overwrites_a_background_result_applied_meanwhile(editor, sqs):
    """The change form loads the row; the background result moves the draft to VALIDATED; then
    the stale form is saved. Only the notes are written: status, metadata and report survive."""
    from django.contrib import admin as django_admin
    from django.test import RequestFactory

    from apps.assets import processing
    from apps.assets.admin import AssetVersionAdmin

    version = stored_version(status=VersionStatus.DRAFT)
    job = submit(version)
    stale = AssetVersion.objects.get(pk=version.pk)  # what the change form holds
    processing.apply(completed(job))  # the result arrives while the form is open
    assert ProcessingJob.objects.get(pk=job.pk).subject_outcome == "version_validated"

    stale.notes = "Checked by hand."
    model_admin = AssetVersionAdmin(AssetVersion, django_admin.site)
    model_admin.save_model(RequestFactory().post("/"), stale, None, True)

    version.refresh_from_db()
    assert version.notes == "Checked by hand."
    assert version.status == VersionStatus.VALIDATED and version.validated_at is not None
    assert version.metadata["model_validation"]["verdict"] == "pass"
    assert version.metadata["model_validation"]["job_id"] == str(job.pk)


def test_the_change_form_saves_notes_and_records_the_change(version, editor):
    from django.contrib.admin.models import LogEntry

    response = editor.post(
        f"{VERSIONS}{version.pk}/change/", {"notes": "Looks right.", "_save": "Save"}
    )
    assert response.status_code == 302
    before = unchanged(version)
    version.refresh_from_db()
    assert version.notes == "Looks right." and unchanged(version) == before
    entry = LogEntry.objects.get(object_id=str(version.pk))
    assert "Notes" in entry.get_change_message()


def test_a_draft_whose_pass_was_lost_is_recovered_by_validating_again(editor):
    """Inline jobs: the pass validates the draft; a lost update puts it back to DRAFT; Validate in
    background then submits a new job (not the old pass) and the draft becomes VALIDATED."""
    version = stored_version(status=VersionStatus.DRAFT)
    run_action(editor, "validate_in_background", version)
    first = ProcessingJob.objects.get()
    assert first.subject_outcome == "version_validated"
    AssetVersion.objects.filter(pk=version.pk).update(status=VersionStatus.DRAFT, validated_at=None)

    response = run_action(editor, "validate_in_background", version)
    content = text(response.content.decode())
    assert "passed, but this version is still a draft, so a new one was submitted" in content
    assert ProcessingJob.objects.count() == 2
    version.refresh_from_db()
    assert version.status == VersionStatus.VALIDATED
    newest = ProcessingJob.objects.exclude(pk=first.pk).get()
    assert newest.subject_outcome == "version_validated"
    assert newest.idempotency_key == first.idempotency_key

    # Validated again: the newest pass is reused, no third job.
    response = run_action(editor, "validate_in_background", version)
    assert b"already validated this file" in response.content
    assert ProcessingJob.objects.count() == 2


def test_the_draft_recovery_is_bounded_by_the_attempt_cap(editor, settings):
    settings.LAI_ASSET_VALIDATION_MAX_ATTEMPTS = 1
    version = stored_version(status=VersionStatus.DRAFT)
    run_action(editor, "validate_in_background", version)
    AssetVersion.objects.filter(pk=version.pk).update(status=VersionStatus.DRAFT, validated_at=None)
    response = run_action(editor, "validate_in_background", version)
    assert b"has reached the limit of background validation attempts" in response.content
    assert ProcessingJob.objects.count() == 1


def test_reusable_refuses_a_pass_for_a_draft_only(version, sqs):
    from apps.assets.processing import reusable

    job = completed(submit(version), outcome="version_validated")
    assert reusable(job) and reusable(job, version_status=VersionStatus.VALIDATED)
    assert not reusable(job, version_status=VersionStatus.DRAFT)


def test_a_pass_by_an_older_validator_is_resubmitted_with_the_right_reason(version, editor, sqs):
    old = completed(submit(version))
    ProcessingJob.objects.filter(pk=old.pk).update(idempotency_key="0" * 64)  # older processor
    response = run_action(editor, "validate_in_background", version)
    content = text(response.content.decode())
    assert "The validator version has changed since the earlier background validation" in content
    assert FAILED_VERDICT not in content and NOT_APPLIED not in content
    assert ProcessingJob.objects.count() == 2


def test_each_submitted_job_is_recorded_in_the_admin_history(version, editor, sqs):
    from django.contrib.admin.models import LogEntry

    run_action(editor, "validate_in_background", version)
    job = ProcessingJob.objects.get()
    entry = LogEntry.objects.get(object_id=str(version.pk))
    assert entry.user.admin_username == "editor"
    assert entry.get_change_message() == f"Submitted background validation job {job.pk}."
    run_action(editor, "validate_in_background", version)  # the same job: nothing new recorded
    assert LogEntry.objects.filter(object_id=str(version.pk)).count() == 1


def test_more_than_fifty_selected_says_only_the_first_fifty_were_processed(editor):
    from apps.assets.tests.helpers import make_definition, make_version

    asset = make_definition("npc-many")
    many = [make_version(asset, number, format=FileFormat.GLTF) for number in range(1, 52)]
    response = run_action(editor, "validate_in_background", *many)
    content = text(response.content.decode())
    assert "only the first 50 were processed" in content
    assert content.count("Only GLB models can be validated in background.") == 50
    few = run_action(editor, "validate_in_background", *many[:50])
    assert b"only the first 50" not in few.content


@pytest.mark.parametrize(
    "flag, status, job_state, expected",
    [
        ("on", VersionStatus.VALIDATED, None, "Publishing: not allowed now (processing_required)."),
        ("on", VersionStatus.VALIDATED, "pass", "Publishing: allowed now."),
        (
            "on",
            VersionStatus.VALIDATED,
            "fail",
            "Publishing: not allowed now (processing_required).",
        ),
        ("on", VersionStatus.DRAFT, None, "Publishing: not allowed now (not_validated)."),
        ("off", VersionStatus.VALIDATED, "fail", "Publishing: allowed now."),
        ("on", VersionStatus.PUBLISHED, "pass", "Publishing: this version is published."),
    ],
)
def test_the_section_says_whether_publishing_is_allowed_now(
    editor, sqs, settings, flag, status, job_state, expected
):
    settings.LAI_ASSET_ASYNC_VALIDATION = flag
    version = stored_version(status=status)
    if job_state is not None:
        job = completed(submit(version))
        if job_state == "fail":
            job.result = {**job.result, "verdict": "fail"}
            job.save(update_fields=["result"])
    content = text(page(editor, version))
    assert expected in content
    for other in ("allowed now.", "not allowed now", "this version is published"):
        if other not in expected:
            assert f"Publishing: {other}" not in content


def test_clip_names_are_shown_verbatim_with_empty_and_missing_names_explicit(version, editor, sqs):
    job = submit(version)
    result = real_result(job)
    result["metadata"]["animations"] = [
        {"name": "Idle ", "duration_seconds": 1.0},
        {"name": "Idle", "duration_seconds": 2.0},
        {"name": "", "duration_seconds": 3.0},
        {"duration_seconds": 4.0},
        {"name": MIXAMO, "duration_seconds": 5.0},
        {"name": SCRIPT, "duration_seconds": 6.0},
    ]
    completed(job, result=result)
    content = page(editor, version)
    assert f"<td>{CLIP.format('Idle ')}</td><td>1.0</td>" in content
    assert f"<td>{CLIP.format('Idle')}</td><td>2.0</td>" in content
    assert "<td><em>(empty name)</em></td><td>3.0</td>" in content
    assert "<td><em>(no name)</em></td><td>4.0</td>" in content
    assert f"<td>{CLIP.format(MIXAMO)}</td><td>5.0</td>" in content
    assert f"<td>{CLIP.format(SCRIPT_ESCAPED)}</td><td>6.0</td>" in content
    assert SCRIPT not in content
