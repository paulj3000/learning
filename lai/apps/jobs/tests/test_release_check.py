"""`processing_release_check` and the optional release manifest gate (ADR-071)."""

import json

import pytest
from django.core.management import call_command

from apps.jobs import release_check, workloads

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

URL = "https://sqs.us-west-1.amazonaws.com/123456789012/lai-dev-jobs-audio"


def run(capsys, *args):
    call_command("processing_release_check", "--json", *args)
    out = capsys.readouterr()
    return json.loads(out.out), out.err


def manifest(tmp_path, kinds, sha="a" * 40):
    path = tmp_path / "m.json"
    path.write_text(
        json.dumps(
            {"git_sha": sha, "artifacts": [{"name": "audio-worker", "supported_kinds": kinds}]}
        )
    )
    return str(path)


def test_report_has_the_contract_fields_and_no_secrets(capsys, settings):
    settings.LAI_JOBS_AUDIO_QUEUE_URL = URL
    report, err = run(capsys)
    assert {
        "schema_version",
        "environment",
        "git_sha",
        "jobs_backend",
        "result_kinds",
        "submittable_kinds",
        "controls",
        "queue_urls_configured",
        "pending_migrations",
    } <= report.keys()
    assert report["pending_migrations"] == [] and err == ""
    assert {"asset.transcode_audio", "asset.convert_image", "asset.optimize"} <= set(
        report["result_kinds"]
    )
    assert report["queue_urls_configured"]["LAI_JOBS_AUDIO_QUEUE_URL"] is True
    assert URL not in json.dumps(report)
    assert report["artifact_storage_configured"] is True
    assert set(report["controls"].values()) == {"off"}


def test_everything_off_passes_even_without_queues(capsys):
    report, _ = run(capsys)
    assert report["failures"] == []


def test_an_enabled_control_without_its_queue_fails_with_a_safe_reason(capsys, settings):
    settings.LAI_AUDIO_TRANSCODING = "on"
    settings.LAI_JOBS_BACKEND = "sqs"
    with pytest.raises(SystemExit) as raised:
        call_command("processing_release_check", "--json")
    assert raised.value.code == 1
    out = capsys.readouterr()
    assert "LAI_JOBS_AUDIO_QUEUE_URL is not configured" in out.err
    assert json.loads(out.out)["failures"]
    settings.LAI_JOBS_AUDIO_QUEUE_URL = URL
    report, err = run(capsys)
    assert report["failures"] == [] and err == ""


def test_exit_zero_flag_reports_but_does_not_fail(capsys, settings):
    settings.LAI_IMAGE_CONVERSION = "on"
    settings.LAI_JOBS_BACKEND = "sqs"
    report, err = run(capsys, "--exit-zero")
    assert report["failures"] and "refused:" in err


def test_a_missing_result_handler_fails(capsys, settings, monkeypatch):
    from apps.jobs import services

    settings.LAI_AUDIO_TRANSCODING = "on"
    settings.LAI_JOBS_BACKEND = "sqs"
    settings.LAI_JOBS_AUDIO_QUEUE_URL = URL
    monkeypatch.setitem(services.HANDLER_MODULES, "asset.transcode_audio", "apps.nope")
    report = release_check.build_report()
    assert "asset.transcode_audio" not in report["result_kinds"]
    assert any("cannot apply results" in r for r in release_check.failures(report))


def test_pending_migrations_fail_when_a_control_is_on(settings, monkeypatch):
    monkeypatch.setattr(release_check, "pending_migrations", lambda: ["jobs.0099_x"])
    settings.LAI_GLB_MESHOPT = "on"
    settings.LAI_JOBS_BACKEND = "sqs"
    settings.LAI_JOBS_OPTIMIZE_QUEUE_URL = URL
    assert "migrations are pending" in release_check.failures(release_check.build_report())


def test_unconfigured_artifact_storage_fails(settings):
    settings.LAI_THUMBNAIL_CAPTURE = "on"
    settings.LAI_ASSET_STORAGE = "s3"
    settings.LAI_ASSET_BUCKET = ""
    report = release_check.build_report()
    assert report["artifact_storage_configured"] is False
    assert "the artifact storage prefix is not configured" in release_check.failures(report)


# --- the manifest gate on submission -----------------------------------------------------------


@pytest.fixture
def audio_on(settings):
    settings.LAI_AUDIO_TRANSCODING = "on"
    settings.LAI_JOBS_BACKEND = "sqs"
    settings.LAI_JOBS_AUDIO_QUEUE_URL = URL


def test_no_manifest_means_no_extra_check(audio_on):
    assert workloads.released_kinds() is None
    assert workloads.workload_enabled("asset.transcode_audio") is True


def test_a_kind_the_manifest_lists_is_allowed(audio_on, settings, tmp_path):
    settings.LAI_PROCESSING_RELEASE_MANIFEST = manifest(tmp_path, ["asset.transcode_audio"])
    assert workloads.workload_enabled("asset.transcode_audio") is True


def test_a_kind_the_manifest_omits_is_refused_with_no_job(audio_on, settings, tmp_path):
    from apps.jobs import services
    from apps.jobs.models import ProcessingJob

    settings.LAI_PROCESSING_RELEASE_MANIFEST = manifest(tmp_path, ["asset.convert_image"])
    assert workloads.workload_enabled("asset.transcode_audio") is False
    with pytest.raises(services.WorkloadUnavailable) as refused:
        workloads.submit_workload("asset.transcode_audio", {})
    assert refused.value.code == "workload_not_released"
    assert ProcessingJob.objects.count() == 0
    report = release_check.build_report()
    assert any("manifest does not list" in r for r in release_check.failures(report))


@pytest.mark.parametrize("content", ["not json", "{}", '{"artifacts": [{"x": 1}]}'])
def test_an_invalid_or_missing_manifest_fails_closed(audio_on, settings, tmp_path, content):
    path = tmp_path / "bad.json"
    path.write_text(content)
    settings.LAI_PROCESSING_RELEASE_MANIFEST = str(path)
    assert workloads.workload_enabled("asset.transcode_audio") is False
    settings.LAI_PROCESSING_RELEASE_MANIFEST = str(tmp_path / "absent.json")
    assert workloads.workload_enabled("asset.transcode_audio") is False


def test_a_manifest_from_another_commit_is_refused(audio_on, settings, tmp_path):
    settings.LAI_PROCESSING_RELEASE_MANIFEST = manifest(tmp_path, ["asset.transcode_audio"])
    settings.LAI_RELEASE_SHA = "b" * 40
    assert workloads.workload_enabled("asset.transcode_audio") is False
    settings.LAI_RELEASE_SHA = "a" * 40
    assert workloads.workload_enabled("asset.transcode_audio") is True


def test_the_manifest_is_reread_when_it_changes(audio_on, settings, tmp_path):
    path = manifest(tmp_path, [])
    settings.LAI_PROCESSING_RELEASE_MANIFEST = path
    assert workloads.workload_enabled("asset.transcode_audio") is False
    import os

    manifest(tmp_path, ["asset.transcode_audio"])
    os.utime(path, ns=(10**18, 10**18))
    assert workloads.workload_enabled("asset.transcode_audio") is True


def test_non_workload_kinds_ignore_the_manifest(settings, tmp_path):
    settings.LAI_PROCESSING_RELEASE_MANIFEST = manifest(tmp_path, [])
    assert workloads.refusal_code("asset.validate_model") is None


def test_the_report_satisfies_the_release_tool(settings):
    """`scripts/release/processing_release.py` accepts the real report (the Django side of its
    spec) and refuses a control whose worker is not in the manifest."""
    import importlib.util
    from pathlib import Path

    root = Path(__file__).resolve().parents[4]
    spec = importlib.util.spec_from_file_location(
        "processing_release", root / "scripts" / "release" / "processing_release.py"
    )
    tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tool)
    settings.LAI_ENVIRONMENT = "dev"
    report = release_check.build_report()
    assert tool.validate_report(report, "dev") is report
    assert set(tool.REPORT_FIELDS) <= report.keys()
    kinds = {k for c in tool.CONTROLS.values() for k in c["kinds"]}
    assert kinds <= set(report["result_kinds"]) and kinds <= set(report["submittable_kinds"])
    assert {c["queue_setting"] for c in tool.CONTROLS.values() if c["queue_setting"]} <= set(
        report["queue_urls_configured"]
    )
