"""Rollback compatibility of jobs migration 0003 (ADR-064 consumer-first release).

0003 adds two NOT NULL columns. They keep a database default (`db_default=""`), so code from
before 0003 (which never names them) can still insert jobs after a Django rollback that leaves the
schema migrated. Without the default every insert by the older release fails.
"""

import uuid

import pytest
from django.db import connection

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.mark.parametrize("column", ["idempotency_key", "subject_outcome"])
def test_new_columns_keep_a_database_default(column):
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT column_default, is_nullable FROM information_schema.columns "
            "WHERE table_name = 'jobs_processingjob' AND column_name = %s",
            [column],
        )
        default, nullable = cursor.fetchone()
    assert nullable == "NO"
    assert default is not None and default.startswith("''")


def test_an_insert_that_omits_the_new_columns_succeeds():
    """What the pre-0003 release does: an INSERT that does not name the 0003 columns."""
    from apps.jobs.models import ProcessingJob

    model_columns = {f.column for f in ProcessingJob._meta.concrete_fields}
    old_columns = sorted(model_columns - {"idempotency_key", "subject_outcome"})
    job = ProcessingJob(
        id=uuid.uuid4(), kind="asset.inspect", queue="media", payload={"asset_key": "x"}
    )
    values = []
    for name in old_columns:
        field = next(f for f in ProcessingJob._meta.concrete_fields if f.column == name)
        values.append(field.get_db_prep_save(getattr(job, field.attname), connection))
    with connection.cursor() as cursor:
        cursor.execute(
            f"INSERT INTO jobs_processingjob ({', '.join(old_columns)}) "  # noqa: S608 - model names
            f"VALUES ({', '.join(['%s'] * len(values))})",
            values,
        )
    stored = ProcessingJob.objects.get(pk=job.pk)
    assert stored.idempotency_key == "" and stored.subject_outcome == ""


def test_reversing_0003_is_refused_clearly_while_new_kind_rows_exist():
    from importlib import import_module

    from django.apps import apps as global_apps

    from apps.jobs.models import ProcessingJob

    migration = import_module("apps.jobs.migrations.0003_contract_kinds")
    migration.refuse_reverse_with_new_kinds(global_apps, None)  # no rows: allowed
    ProcessingJob.objects.create(
        kind="reference.checksum", queue="media", payload={}, backend="inline"
    )
    with pytest.raises(RuntimeError, match="cannot be reversed"):
        migration.refuse_reverse_with_new_kinds(global_apps, None)


def test_submit_returns_a_uuid_pk_whatever_the_backend(settings):
    from apps.jobs import services
    from apps.jobs.models import ProcessingJob

    settings.LAI_JOBS_BACKEND = "sqs"
    settings.LAI_JOBS_MEDIA_QUEUE_URL = "https://sqs.us-west-1.amazonaws.com/123456789012/q"
    services.set_aws_clients(sqs=object(), s3=object())
    try:
        job = services.submit(
            "asset.inspect", {"asset_key": "assets/x.glb"}, job_id=str(uuid.uuid4())
        )
    finally:
        services.set_aws_clients(sqs=None, s3=None)
    assert isinstance(job.pk, uuid.UUID)
    assert job.pk == ProcessingJob.objects.get(pk=job.pk).pk
    with pytest.raises(services.JobsError):
        services.submit("asset.inspect", {"asset_key": "assets/x.glb"}, job_id="not-a-uuid")
