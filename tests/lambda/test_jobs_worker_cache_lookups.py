"""The worker's own cache lookups (stored results, shared speech clips) treat a 403 as absent.

S3 answers 403 instead of 404 for a missing key when the caller's s3:ListBucket grant does not
apply (the results and speech grants carry a plain `s3:prefix` condition). A first delivery of
every job looks up a result that does not exist yet; a 403 there must not make the job retry into
the DLQ. Asset inputs keep the strict rule (403 is access_denied, never missing): see
test_jobs_worker_asset_errors.py. Error shapes come from a real botocore client under Stubber."""

import uuid

import pytest
from botocore.stub import Stubber


@pytest.fixture
def stubbed_s3():
    import boto3

    session = boto3.session.Session(
        aws_access_key_id="test",
        aws_secret_access_key="test",  # noqa: S106 - dummy, Stubber
        region_name="us-west-1",
    )
    client = session.client("s3")
    with Stubber(client) as stubber:
        yield client, stubber


@pytest.mark.parametrize(
    ("code", "status"), [("AccessDenied", 403), ("NoSuchKey", 404), ("403", 403), ("404", 404)]
)
def test_a_result_lookup_denied_or_missing_is_absent(
    worker, make_runtime, stubbed_s3, code, status
):
    client, stubber = stubbed_s3
    rt = make_runtime("media")
    rt._clients["s3"] = client
    stubber.add_client_error("get_object", service_error_code=code, http_status_code=status)
    assert rt.load_result(str(uuid.uuid4())) is None


@pytest.mark.parametrize(("code", "status"), [("InternalError", 500), ("SlowDown", 503)])
def test_a_result_lookup_fault_still_retries(worker, make_runtime, stubbed_s3, code, status):
    client, stubber = stubbed_s3
    rt = make_runtime("media")
    rt._clients["s3"] = client
    stubber.add_client_error("get_object", service_error_code=code, http_status_code=status)
    with pytest.raises(worker.tasks.TaskError) as raised:
        rt.load_result(str(uuid.uuid4()))
    assert (raised.value.code, raised.value.retryable) == ("results_unavailable", True)


def test_a_denied_result_put_still_surfaces(worker, make_runtime, stubbed_s3):
    """A real permission fault is not hidden: the store that follows the lookup fails."""
    client, stubber = stubbed_s3
    rt = make_runtime("media")
    rt._clients["s3"] = client
    stubber.add_client_error("put_object", service_error_code="AccessDenied", http_status_code=403)
    final = worker.envelope.build_result(
        str(uuid.uuid4()), "asset.inspect", "failed", error_code="object_missing"
    )
    with pytest.raises(worker.tasks.TaskError) as raised:
        rt.store_result(final)
    assert raised.value.code == "results_unavailable"


@pytest.mark.parametrize(("code", "status"), [("403", 403), ("404", 404)])
def test_a_speech_cache_lookup_denied_or_missing_is_absent(
    worker, make_runtime, stubbed_s3, code, status
):
    client, stubber = stubbed_s3
    rt = make_runtime("media")
    rt._clients["s3"] = client
    ports = next(
        getattr(worker.aws, name)(rt)
        for name in dir(worker.aws)
        if name.endswith("Ports") and hasattr(getattr(worker.aws, name), "speech_object_size")
    )
    stubber.add_client_error("head_object", service_error_code=code, http_status_code=status)
    assert ports.speech_object_size("speech/shared/ab/" + "a" * 64 + ".mp3") is None


def test_an_asset_input_403_is_still_access_denied(worker):
    from jobs_worker_fakes import FakeClientError

    error = worker.aws._asset_error(FakeClientError("AccessDenied", 403))
    assert (error.code, error.retryable) == ("access_denied", False)


def test_results_are_stored_create_only(worker, make_runtime, stubbed_s3):
    """ADR-071 F11: the role may write jobs/results/* only with If-None-Match: *."""
    client, stubber = stubbed_s3
    rt = make_runtime("media")
    rt._clients["s3"] = client
    final = worker.envelope.build_result(
        str(uuid.uuid4()), "asset.inspect", "failed", error_code="object_missing"
    )
    stubber.add_response(
        "put_object",
        {},
        {
            "Bucket": rt.settings.results_bucket,
            "Key": worker.envelope.result_key(final["job_id"]),
            "Body": worker.envelope.encode(final).encode(),
            "ContentType": "application/json",
            "ServerSideEncryption": "AES256",
            "IfNoneMatch": "*",
        },
    )
    assert rt.store_result(final) is final


def test_a_concurrent_delivery_sends_the_result_stored_first(worker, make_runtime, stubbed_s3):
    import io

    client, stubber = stubbed_s3
    rt = make_runtime("media")
    rt._clients["s3"] = client
    job = str(uuid.uuid4())
    first = worker.envelope.build_result(
        job, "asset.inspect", "failed", error_code="object_missing"
    )
    second = worker.envelope.build_result(job, "asset.inspect", "failed", error_code="other")
    stubber.add_client_error(
        "put_object", service_error_code="PreconditionFailed", http_status_code=412
    )
    stubber.add_response("get_object", {"Body": io.BytesIO(worker.envelope.encode(first).encode())})
    assert rt.store_result(second) == first
