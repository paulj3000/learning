"""LAI-LAMBDA-009: NPC animation inspection (`asset.analyze_animation`) on the canonical jobs path.

The real processor runs through the inline backend (or, for result-order cases, the same task code
applied as a worker result). In-memory asset storage, PostgreSQL. Nothing here may write
`NpcModelVariant.animation_map`, publish anything, or rewrite a published version."""

import hashlib
import io
from types import SimpleNamespace

import pytest
from django.contrib.auth.models import Group, Permission
from django.core.management import call_command
from django.test import Client

from apps.assets.jobs import InlinePorts
from apps.assets.models import VersionStatus
from apps.assets.storage import get_storage, reset_storage_cache
from apps.assets.tests.helpers import glb_bytes, gltf_document, make_definition, make_version
from apps.jobs import services
from apps.jobs.core import envelope, tasks
from apps.jobs.models import JobStatus, ProcessingJob
from apps.jobs.tests.helpers import FakeS3, FakeSQS, use_sqs
from apps.npcs import animation_inspection as inspection
from apps.npcs.management.commands.ensure_npc_roles import EDITORS
from apps.npcs.models import NpcModelVariant

from .helpers import make_character, make_staff, make_variant

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

MIXAMO = "Armature|mixamo.com|Layer0"
VARIANTS = "/admin/npcs/npcmodelvariant/"
KIND = "asset.analyze_animation"


@pytest.fixture(autouse=True)
def memory_storage(settings):
    settings.LAI_ASSET_STORAGE = "memory"
    reset_storage_cache()
    yield
    reset_storage_cache()


@pytest.fixture
def aws(settings):
    """The SQS backend with fake clients: jobs stay PENDING until a result is applied."""
    use_sqs(settings)
    fakes = SimpleNamespace(sqs=FakeSQS(), s3=FakeS3())
    services.set_aws_clients(sqs=fakes.sqs, s3=fakes.s3)
    yield fakes
    services.set_aws_clients()


def model(clips=("Idle", MIXAMO)) -> bytes:
    return glb_bytes(*gltf_document(clips=clips))


def stored_version(asset_id, data=None, *, status=VersionStatus.PUBLISHED, **fields):
    data = model() if data is None else data
    asset = make_definition(asset_id)
    version = make_version(
        asset,
        1,
        status=status,
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
        metadata={"source": "upload"},
        **fields,
    )
    get_storage().put(
        version.storage_key,
        io.BytesIO(data),
        content_type=version.content_type,
        sha256=version.sha256,
    )
    if status == VersionStatus.PUBLISHED:
        asset.default_version = version
        asset.save()
    return version


def variant_for(version, npc_id="pip-inspect", animation_map=None):
    character = make_character(npc_id, with_variant=False)
    return make_variant(
        character,
        model_asset=version.asset,
        pinned_version=version if version.status == VersionStatus.PUBLISHED else None,
        animation_map=animation_map if animation_map is not None else {},
    )


def worker_result(job) -> dict:
    """What the media worker would send for `job`: the same task code, the inline ports."""
    data = tasks.run(job.kind, job.payload, InlinePorts())
    return envelope.build_result(
        str(job.pk), job.kind, envelope.SUCCEEDED, result=data, function="lai-dev-jobs-media"
    )


# --- the handler ----------------------------------------------------------------------------------


def test_a_published_version_keeps_its_metadata_and_the_result_stays_on_the_job():
    version = stored_version("pip-published")
    before = {name: getattr(version, name) for name in ("metadata", "clips", "validation_report")}
    job = inspection.submit_animation_inspection(version, user=None)
    job.refresh_from_db()
    assert job.kind == KIND and job.queue == "media" and job.status == JobStatus.COMPLETED
    assert job.idempotency_key.startswith("ik1:")
    assert job.subject_outcome == "result_recorded"
    version.refresh_from_db()
    assert version.status == VersionStatus.PUBLISHED
    assert {n: getattr(version, n) for n in before} == before
    _job, summary = inspection.latest_inspection(version)
    assert summary["job_id"] == str(job.pk)
    assert [c["name"] for c in summary["clips"]] == ["Idle", MIXAMO]
    assert summary["processor_id"] == "asset.animation_inspector"


def test_a_never_published_version_gets_a_read_only_copy_and_stays_a_draft():
    version = stored_version("pip-draft", status=VersionStatus.DRAFT)
    job = inspection.submit_animation_inspection(version, user=None)
    job.refresh_from_db()
    assert job.subject_outcome == "inspection_stored"
    version.refresh_from_db()
    assert version.status == VersionStatus.DRAFT and version.published_at is None
    stored = version.metadata["animation_inspection"]
    assert stored["job_id"] == str(job.pk) and stored["clip_count"] == 2
    assert version.metadata["source"] == "upload"  # merged, nothing else replaced
    # Applying the same job again is a no-op.
    inspection.apply(job)
    assert job.subject_outcome == "duplicate_result"


def test_the_same_work_returns_the_same_job():
    version = stored_version("pip-reuse")
    first = inspection.submit_animation_inspection(version, user=None)
    again = inspection.submit_animation_inspection(version, user=None)
    assert again.pk == first.pk
    assert inspection.inspection_jobs(version).count() == 1


def test_a_duplicate_result_message_is_ignored(aws):
    version = stored_version("pip-dupe", status=VersionStatus.VALIDATED)
    job = inspection.submit_animation_inspection(version, user=None)
    assert job.status == JobStatus.PENDING
    message = worker_result(job)
    assert services.apply_result(message) == services.APPLIED
    version.refresh_from_db()
    stored = dict(version.metadata["animation_inspection"])
    assert services.apply_result(message) == services.DUPLICATE
    version.refresh_from_db()
    assert version.metadata["animation_inspection"] == stored
    job.refresh_from_db()
    assert job.deliveries == 2 and job.subject_outcome == "inspection_stored"


def test_a_result_for_a_changed_file_is_refused_and_may_be_resubmitted(aws):
    version = stored_version("pip-stale", status=VersionStatus.DRAFT)
    job = inspection.submit_animation_inspection(version, user=None)
    message = worker_result(job)
    # The version row now describes other bytes (a stale request for this version).
    replacement = model(("Wave",))
    version.sha256 = hashlib.sha256(replacement).hexdigest()
    version.size_bytes = len(replacement)
    version.save()
    assert services.apply_result(message) == services.APPLIED
    job.refresh_from_db()
    assert job.subject_outcome == "checksum_mismatch"
    version.refresh_from_db()
    assert "animation_inspection" not in version.metadata
    # A refused result does not block a new inspection of the current file.
    again = inspection.submit_animation_inspection(version, user=None)
    assert again.pk != job.pk


def test_an_older_result_never_replaces_a_newer_stored_one(aws):
    version = stored_version("pip-order", status=VersionStatus.DRAFT)
    older = inspection.submit_animation_inspection(version, user=None)
    payload = inspection.inspection_request(version, job_id="00000000-0000-4000-8000-0000000000aa")
    newer = services.submit(
        KIND,
        payload,
        subject=version,
        job_id=payload["job_id"],
        idempotency_key=payload["idempotency_key"],
    )
    assert services.apply_result(worker_result(newer)) == services.APPLIED
    assert services.apply_result(worker_result(older)) == services.APPLIED
    older.refresh_from_db()
    assert older.subject_outcome == "stale_result"
    version.refresh_from_db()
    assert version.metadata["animation_inspection"]["job_id"] == str(newer.pk)


def test_a_failed_job_may_be_resubmitted(aws):
    version = stored_version("pip-failed")
    job = inspection.submit_animation_inspection(version, user=None)
    assert services.fail_job(job.pk, "timeout")
    job.refresh_from_db()
    assert job.subject_outcome == "processing_failed"
    again = inspection.submit_animation_inspection(version, user=None)
    assert again.pk != job.pk and again.status == JobStatus.PENDING


def test_an_oversized_file_is_refused_before_any_job_exists():
    version = stored_version("pip-huge")
    version.size_bytes = 50 * 1024 * 1024 + 1  # the profile's max_input_bytes, plus one
    with pytest.raises(services.JobsError) as raised:
        inspection.submit_animation_inspection(version, user=None)
    assert raised.value.code == "resource_limit_exceeded"
    assert not ProcessingJob.objects.filter(kind=KIND).exists()


def test_only_glb_models_of_active_assets_are_inspected():
    version = stored_version("pip-gltf", format="gltf")
    with pytest.raises(inspection.InspectionRefused) as raised:
        inspection.submit_animation_inspection(version, user=None)
    assert raised.value.code == "unsupported_format"
    assert not ProcessingJob.objects.filter(kind=KIND).exists()


def test_broken_animation_data_is_reported_not_raised():
    document, binary = gltf_document(clips=("Idle",))
    document["animations"][0]["samplers"][0]["interpolation"] = "BEZIER"
    version = stored_version("pip-broken", glb_bytes(document, binary))
    job = inspection.submit_animation_inspection(version, user=None)
    _job, summary = inspection.latest_inspection(version)
    assert job.status == JobStatus.COMPLETED and summary["verdict"] == "fail"
    assert "unsupported_interpolation" in {f["code"] for f in summary["findings"]}


# --- the advisory mapping helper ------------------------------------------------------------------


def clip(name, *, exact=True, generic=False):
    return {"name": name, "name_exact": exact, "generic_name": generic}


def test_suggestions_are_exact_or_case_insensitive_and_never_for_take_names():
    summary = {
        "clips": [
            clip("Idle"),
            clip("talk"),
            clip("Walk"),
            clip("WALK"),
            clip(MIXAMO, generic=True),
            clip("Wave", exact=False),
        ]
    }
    rows = {r["state"]: r for r in inspection.suggest_mapping(summary, {"idle": "Idle"})}
    assert (rows["idle"]["suggestion"], rows["idle"]["match"]) == ("Idle", "case_insensitive")
    assert (rows["talk"]["suggestion"], rows["talk"]["match"]) == ("talk", "exact")
    assert (rows["walk"]["suggestion"], rows["walk"]["match"]) == (None, "ambiguous")
    assert (rows["wave"]["suggestion"], rows["wave"]["match"]) == (None, "none")
    assert rows["idle"]["current"] == "Idle" and rows["idle"]["current_in_model"] is True
    assert set(rows) == set(inspection.ANIMATION_STATES)


def test_a_mixamo_only_model_gets_no_suggestion_at_all():
    summary = {"clips": [clip(MIXAMO, generic=True), clip(MIXAMO + ".001", generic=True)]}
    rows = inspection.suggest_mapping(summary, {"idle": MIXAMO})
    assert all(r["suggestion"] is None and r["match"] == "none" for r in rows)
    idle = next(r for r in rows if r["state"] == "idle")
    assert idle["current"] == MIXAMO and idle["current_in_model"] is True


# --- Django Admin ---------------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def roles():
    call_command("ensure_npc_roles", verbosity=0)


def login(username, *groups, permissions=()):
    account = make_staff(username)
    account.groups.set(Group.objects.filter(name__in=groups))
    for codename in permissions:
        account.user_permissions.add(Permission.objects.get(codename=codename))
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    return client


def run_action(client, variant):
    return client.post(
        VARIANTS,
        {"action": "inspect_animations_in_background", "_selected_action": [variant.pk]},
        follow=True,
    )


def test_staff_without_change_permission_cannot_inspect():
    version = stored_version("pip-denied")
    variant = variant_for(version)
    viewer = login("npc-viewer", permissions=("view_npcmodelvariant",))
    page = viewer.get(VARIANTS).content.decode()
    assert "inspect_animations_in_background" not in page
    run_action(viewer, variant)
    assert not ProcessingJob.objects.filter(kind=KIND).exists()


def test_editors_inspect_and_see_an_escaped_read_only_report():
    hostile = "<b>Idle</b>"
    version = stored_version("pip-admin", model((hostile, MIXAMO, "Talk")))
    variant = variant_for(version, animation_map={"talk": "Talk"})
    editor = login("npc-editor", EDITORS)
    page = editor.get(VARIANTS).content.decode()
    assert "Inspect animations in background" in page
    response = run_action(editor, variant)
    assert response.status_code == 200
    job = ProcessingJob.objects.get(kind=KIND)
    assert job.status == JobStatus.COMPLETED and job.subject_outcome == "result_recorded"
    text = editor.get(f"{VARIANTS}{variant.pk}/change/").content.decode()
    assert "Animation inspection" in text and "Suggestion only." in text
    assert "&lt;b&gt;Idle&lt;/b&gt;" in text and hostile not in text
    assert MIXAMO in text
    assert f"/admin/jobs/processingjob/{job.pk}/change/" in text
    # Nothing was mapped, published or rewritten.
    variant.refresh_from_db()
    assert variant.animation_map == {"talk": "Talk"}
    version.refresh_from_db()
    assert version.metadata == {"source": "upload"}
    # A second run reports the existing job instead of submitting another.
    run_action(editor, variant)
    assert ProcessingJob.objects.filter(kind=KIND).count() == 1


def test_the_action_reports_a_bundled_model_and_creates_nothing():
    character = make_character("pip-bundled")  # the helper variant uses a bundled asset
    editor = login("npc-editor-2", EDITORS)
    response = run_action(editor, character.variants.get())
    assert "no stored version to inspect" in response.content.decode()
    assert not ProcessingJob.objects.filter(kind=KIND).exists()


def test_the_change_page_without_an_inspection_explains_how_to_start_one():
    version = stored_version("pip-none")
    variant = variant_for(version)
    editor = login("npc-editor-3", EDITORS)
    text = editor.get(f"{VARIANTS}{variant.pk}/change/").content.decode()
    assert "No animation inspection has run for this file." in text
    assert NpcModelVariant.objects.get(pk=variant.pk).animation_map == {}
