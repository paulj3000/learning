"""Contract-kind models: constraints, the state mirror, and migration 0002 both ways."""

import pytest
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor

from apps.jobs.core import envelope
from apps.jobs.models import (
    CONTRACT_KINDS,
    STATE_STATUS,
    JobAttempt,
    JobKind,
    JobState,
    JobStatus,
    ProcessingJob,
)
from lai_processing.core.lifecycle import JobState as CoreState

KEY = "ik1:" + "a" * 64


def contract(**fields):
    values = {
        "kind": "reference.checksum",
        "queue": "processing",
        "backend": "local",
        "state": JobState.QUEUED,
        "namespace": "test",
        "idempotency_key": KEY,
    }
    values.update(fields)
    return ProcessingJob.objects.create(**values)


def test_state_values_mirror_the_lifecycle_module():
    assert set(JobState.values) == {state.value for state in CoreState}
    assert set(STATE_STATUS) == set(JobState.values)
    assert STATE_STATUS[JobState.PROCESSING] == JobStatus.RUNNING
    assert STATE_STATUS[JobState.CANCELLED] == JobStatus.FAILED


def test_contract_kinds_never_reach_the_legacy_envelope():
    assert CONTRACT_KINDS <= set(JobKind.values)
    assert not CONTRACT_KINDS & envelope.KINDS
    assert not CONTRACT_KINDS & set(envelope.KIND_QUEUE)


@pytest.mark.postgres
@pytest.mark.django_db
def test_duplicate_idempotency_key_is_rejected_per_namespace():
    contract()
    with pytest.raises(IntegrityError), transaction.atomic():
        contract()
    contract(namespace="other")  # the same key in another namespace is another job


@pytest.mark.postgres
@pytest.mark.django_db
@pytest.mark.parametrize(
    "fields",
    [
        {"state": "exploded"},
        {"state": ""},  # a contract kind needs a state
        {"idempotency_key": ""},
        {"namespace": ""},
        {"kind": "asset.inspect"},  # a legacy kind never has a state
    ],
)
def test_state_and_contract_field_checks(fields):
    with pytest.raises(IntegrityError), transaction.atomic():
        contract(**fields)


@pytest.mark.postgres
@pytest.mark.django_db
def test_legacy_rows_need_no_contract_fields_and_share_blank_keys():
    for _ in range(2):
        ProcessingJob.objects.create(kind="asset.inspect", queue="media", backend="sqs")
    assert ProcessingJob.objects.filter(state="", idempotency_key="").count() == 2


@pytest.mark.postgres
@pytest.mark.django_db
def test_attempt_numbers_are_unique_and_bounded():
    job = contract()
    JobAttempt.objects.create(job=job, number=1)
    with pytest.raises(IntegrityError), transaction.atomic():
        JobAttempt.objects.create(job=job, number=1)
    with pytest.raises(IntegrityError), transaction.atomic():
        JobAttempt.objects.create(job=job, number=101)


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_migration_0002_applies_backward_and_forward_keeping_legacy_rows():
    legacy = ProcessingJob.objects.create(
        kind="asset.inspect", queue="media", backend="sqs", payload={"storage_key": "k"}
    )
    executor = MigrationExecutor(connection)
    executor.migrate([("jobs", "0001_initial")])
    old_apps = MigrationExecutor(connection).loader.project_state([("jobs", "0001_initial")]).apps
    OldJob = old_apps.get_model("jobs", "ProcessingJob")  # noqa: N806
    assert OldJob.objects.get(pk=legacy.pk).payload == {"storage_key": "k"}
    with connection.cursor() as cursor:
        tables = connection.introspection.table_names(cursor)
    assert "jobs_jobattempt" not in tables and "jobs_joboutbox" not in tables

    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate(executor.loader.graph.leaf_nodes("jobs"))
    restored = ProcessingJob.objects.get(pk=legacy.pk)
    assert (restored.state, restored.idempotency_key, restored.payload) == (
        "",
        "",
        {"storage_key": "k"},
    )
    contract()  # the new constraints and columns are back
