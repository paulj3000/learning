"""Asset-bucket S3 errors in the packaged jobs worker: a missing object is a terminal failure, a
denied one is a distinct terminal failure (never "missing"), and throttling, 5xx and transport
faults are retried by SQS. Covers `asset.inspect` and `asset.validate_model`
(docs/processing/CANONICAL_PATH.md, "Asset read errors").

Error shapes come from a real botocore S3 client under `botocore.stub.Stubber` and from real
botocore exception classes; nothing touches the network or AWS."""

import json
import uuid

import pytest
from botocore.exceptions import (
    ConnectTimeoutError,
    EndpointConnectionError,
    ReadTimeoutError,
    ResponseStreamingError,
)
from botocore.stub import Stubber
from jobs_worker_fakes import ASSET_BUCKET, FakeClientError, tiny_glb
from test_jobs_worker_contract import results_stored, statuses, submit

ASSET_KEY = f"assets/models/pip-boat/{uuid.uuid4()}/model.glb"


@pytest.fixture
def stubbed_s3():
    """A real S3 client with explicit dummy credentials (no ambient AWS configuration)."""
    import boto3

    session = boto3.session.Session(
        aws_access_key_id="test",
        aws_secret_access_key="test",  # noqa: S106 - dummy, Stubber
        region_name="us-west-1",
    )
    client = session.client("s3")
    with Stubber(client) as stubber:
        yield client, stubber


def asset_ports(worker, make_runtime, client):
    rt = make_runtime("media")
    rt._clients["s3"] = client
    return worker.aws.AssetPorts(rt)


def inspect_body(worker, key=ASSET_KEY):
    return json.dumps(
        worker.envelope.build_work(
            str(uuid.uuid4()), "asset.inspect", {"storage_key": key, "format": "glb"}
        )
    )


# --- classification at the port, with botocore's own error shapes -------------------------------

# (S3 error code, HTTP status, TaskError code, retryable). HEAD errors carry the status as the
# code ("404", "403"), GET errors the S3 code ("NoSuchKey", "AccessDenied").
HEAD_ERRORS = [
    ("403", 403, "access_denied", False),
    ("AccessDenied", 403, "access_denied", False),
    ("NoSuchVersion", 404, "object_missing", False),
    ("SlowDown", 503, "throttled", True),
    ("503", 503, "throttled", True),
    ("Throttling", 400, "throttled", True),
    ("InternalError", 500, "storage", True),
]
GET_ERRORS = [
    ("NoSuchKey", 404, "object_missing", False),
    ("NoSuchVersion", 404, "object_missing", False),
    *[case for case in HEAD_ERRORS if case[0] != "NoSuchVersion"],
]


def test_a_missing_object_on_head_is_none(worker, make_runtime, stubbed_s3):
    client, stubber = stubbed_s3
    stubber.add_client_error("head_object", service_error_code="404", http_status_code=404)
    assert asset_ports(worker, make_runtime, client).asset_object_size(ASSET_KEY) is None


@pytest.mark.parametrize(("code", "status", "expected", "retryable"), HEAD_ERRORS)
def test_head_errors_are_classified(
    worker, make_runtime, stubbed_s3, code, status, expected, retryable
):
    client, stubber = stubbed_s3
    stubber.add_client_error("head_object", service_error_code=code, http_status_code=status)
    ports = asset_ports(worker, make_runtime, client)
    if expected == "object_missing":
        assert ports.asset_object_size(ASSET_KEY) is None
        return
    with pytest.raises(worker.tasks.TaskError) as raised:
        ports.asset_object_size(ASSET_KEY)
    assert (raised.value.code, raised.value.retryable) == (expected, retryable)


@pytest.mark.parametrize(("code", "status", "expected", "retryable"), GET_ERRORS)
def test_ranged_read_errors_are_classified(
    worker, make_runtime, stubbed_s3, code, status, expected, retryable
):
    client, stubber = stubbed_s3
    stubber.add_client_error("get_object", service_error_code=code, http_status_code=status)
    with pytest.raises(worker.tasks.TaskError) as raised:
        asset_ports(worker, make_runtime, client).read_asset(ASSET_KEY, 0, 16)
    assert (raised.value.code, raised.value.retryable) == (expected, retryable)


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (EndpointConnectionError(endpoint_url="https://s3"), "connection"),
        (ConnectTimeoutError(endpoint_url="https://s3"), "timeout"),
        (ReadTimeoutError(endpoint_url="https://s3"), "timeout"),
        (ResponseStreamingError(error="reset"), "connection"),
    ],
)
def test_transport_errors_are_retryable(worker, fakes, make_runtime, error, expected):
    def fail(**_kwargs):
        raise error

    fakes.s3.head_object = fail
    fakes.s3.get_object = fail
    ports = worker.aws.AssetPorts(make_runtime("media"))
    for call in (
        lambda: ports.asset_object_size(ASSET_KEY),
        lambda: ports.read_asset(ASSET_KEY, 0, 4),
    ):
        with pytest.raises(worker.tasks.TaskError) as raised:
            call()
        assert (raised.value.code, raised.value.retryable) == (expected, True)


def test_a_denial_is_never_reported_as_missing(worker):
    # A 403 is AccessDenied whatever its code says; only 404 and the missing codes are "missing".
    for code in ("403", "AccessDenied", "Forbidden", ""):
        error = worker.aws._asset_error(FakeClientError(code, 403))
        assert (error.code, error.retryable) == ("access_denied", False)


# --- asset.inspect end to end ---------------------------------------------------------------------


def run_inspect(worker, fakes, make_runtime, context):
    return worker.handler.process(inspect_body(worker), context, make_runtime("media"))


def test_inspect_missing_object_is_a_terminal_object_missing(
    worker, fakes, make_runtime, context, stubbed_s3
):
    client, stubber = stubbed_s3
    stubber.add_client_error("head_object", service_error_code="404", http_status_code=404)
    original = fakes.s3.head_object
    fakes.s3.head_object = lambda Bucket, Key: (
        client.head_object(Bucket=Bucket, Key=Key)
        if Bucket == ASSET_BUCKET
        else original(Bucket=Bucket, Key=Key)
    )
    assert run_inspect(worker, fakes, make_runtime, context) == "failed"
    assert fakes.sqs.sent[-1]["Body"]["error"] == {"code": "object_missing", "retryable": False}


def test_inspect_no_such_version_is_terminal(worker, fakes, make_runtime, context):
    fakes.s3.objects[(ASSET_BUCKET, ASSET_KEY)] = tiny_glb()

    def gone(**_kwargs):
        raise FakeClientError("NoSuchVersion", 404)

    fakes.s3.get_object = gone
    assert run_inspect(worker, fakes, make_runtime, context) == "failed"
    assert fakes.sqs.sent[-1]["Body"]["error"] == {"code": "object_missing", "retryable": False}


def test_inspect_access_denied_is_terminal_and_not_missing(worker, fakes, make_runtime, context):
    def denied(Bucket, Key):
        raise FakeClientError("403", 403)

    fakes.s3.head_object = denied
    assert run_inspect(worker, fakes, make_runtime, context) == "failed"
    assert fakes.sqs.sent[-1]["Body"]["error"] == {"code": "access_denied", "retryable": False}


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (FakeClientError("SlowDown", 503), "throttled"),
        (FakeClientError("InternalError", 500), "storage"),
        (EndpointConnectionError(endpoint_url="https://s3"), "connection"),
    ],
)
def test_inspect_transient_head_errors_are_retried(
    worker, fakes, make_runtime, context, error, expected
):
    def fail(Bucket, Key):
        raise error

    fakes.s3.head_object = fail
    with pytest.raises(worker.tasks.TaskError) as raised:
        run_inspect(worker, fakes, make_runtime, context)
    assert (raised.value.code, raised.value.retryable) == (expected, True)
    assert statuses(fakes) == ["running"] and results_stored(fakes) == []


def test_inspect_transient_ranged_read_error_is_retried(worker, fakes, make_runtime, context):
    fakes.s3.objects[(ASSET_BUCKET, ASSET_KEY)] = tiny_glb()
    original = fakes.s3.get_object

    def flaky(Bucket, Key, Range=None):
        if Bucket == ASSET_BUCKET:
            raise ReadTimeoutError(endpoint_url="https://s3")
        return original(Bucket=Bucket, Key=Key, Range=Range)

    fakes.s3.get_object = flaky
    with pytest.raises(worker.tasks.TaskError) as raised:
        run_inspect(worker, fakes, make_runtime, context)
    assert (raised.value.code, raised.value.retryable) == ("timeout", True)
    fakes.s3.get_object = original  # the redelivery succeeds
    assert run_inspect(worker, fakes, make_runtime, context) == "succeeded"


# --- asset.validate_model end to end --------------------------------------------------------------


def run_validate(worker, fakes, make_runtime, context, body):
    return worker.handler.process(body, context, make_runtime("media"))


def test_validate_missing_object_via_botocore_404_is_terminal_input_missing(
    worker, fakes, make_runtime, context, stubbed_s3
):
    client, stubber = stubbed_s3
    _job_id, body, key = submit(worker, fakes, store=False)
    stubber.add_client_error("head_object", service_error_code="404", http_status_code=404)
    original = fakes.s3.head_object
    fakes.s3.head_object = lambda Bucket, Key: (
        client.head_object(Bucket=Bucket, Key=Key)
        if Bucket == ASSET_BUCKET
        else original(Bucket=Bucket, Key=Key)
    )
    assert run_validate(worker, fakes, make_runtime, context, body) == "failed"
    error = fakes.sqs.sent[-1]["Body"]["error"]
    assert error == {"code": "input_missing", "retryable": False}


def test_validate_object_gone_during_the_read_is_terminal_input_missing(
    worker, fakes, make_runtime, context
):
    # Present at the size check, NoSuchKey (or NoSuchVersion) on the ranged GET: ObjectMissing,
    # not StorageUnavailable, so the job fails now instead of looping into the DLQ.
    for code in ("NoSuchKey", "NoSuchVersion"):
        _job_id, body, _key = submit(worker, fakes)
        original = fakes.s3.get_object

        def gone(Bucket, Key, Range=None, _code=code, _original=original):
            if Bucket == ASSET_BUCKET:
                raise FakeClientError(_code, 404)
            return _original(Bucket=Bucket, Key=Key, Range=Range)

        fakes.s3.get_object = gone
        assert run_validate(worker, fakes, make_runtime, context, body) == "failed"
        assert fakes.sqs.sent[-1]["Body"]["error"] == {"code": "input_missing", "retryable": False}
        fakes.s3.get_object = original


@pytest.mark.parametrize("where", ["head", "get"])
def test_validate_access_denied_is_permission_denied_not_missing(
    worker, fakes, make_runtime, context, where
):
    _job_id, body, _key = submit(worker, fakes)
    if where == "head":

        def denied_head(Bucket, Key):
            raise FakeClientError("403", 403)

        fakes.s3.head_object = denied_head
    else:
        original = fakes.s3.get_object

        def denied_get(Bucket, Key, Range=None):
            if Bucket == ASSET_BUCKET:
                raise FakeClientError("AccessDenied", 403)
            return original(Bucket=Bucket, Key=Key, Range=Range)

        fakes.s3.get_object = denied_get
    assert run_validate(worker, fakes, make_runtime, context, body) == "failed"
    error = fakes.sqs.sent[-1]["Body"]["error"]
    assert error == {"code": "permission_denied", "retryable": False}


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (FakeClientError("SlowDown", 503), "throttled"),
        (FakeClientError("Throttling", 400), "throttled"),
        (FakeClientError("InternalError", 500), "storage_failure"),
        (EndpointConnectionError(endpoint_url="https://s3"), "storage_failure"),
        (ConnectTimeoutError(endpoint_url="https://s3"), "storage_failure"),
    ],
)
def test_validate_transient_head_errors_are_retried(
    worker, fakes, make_runtime, context, error, expected
):
    _job_id, body, _key = submit(worker, fakes)

    def fail(Bucket, Key):
        raise error

    fakes.s3.head_object = fail
    with pytest.raises(worker.tasks.TaskError) as raised:
        run_validate(worker, fakes, make_runtime, context, body)
    assert (raised.value.code, raised.value.retryable) == (expected, True)
    assert statuses(fakes) == ["running"] and results_stored(fakes) == []


@pytest.mark.parametrize(
    "error",
    [
        FakeClientError("SlowDown", 503),
        ReadTimeoutError(endpoint_url="https://s3"),
        ResponseStreamingError(error="reset"),
    ],
)
def test_validate_transient_ranged_read_error_is_retried(
    worker, fakes, make_runtime, context, error
):
    _job_id, body, _key = submit(worker, fakes)
    original = fakes.s3.get_object

    def flaky(Bucket, Key, Range=None):
        if Bucket == ASSET_BUCKET:
            raise error
        return original(Bucket=Bucket, Key=Key, Range=Range)

    fakes.s3.get_object = flaky
    with pytest.raises(worker.tasks.TaskError) as raised:
        run_validate(worker, fakes, make_runtime, context, body)
    assert raised.value.retryable
    assert results_stored(fakes) == []
    fakes.s3.get_object = original  # the redelivery succeeds
    assert run_validate(worker, fakes, make_runtime, context, body) == "succeeded"
