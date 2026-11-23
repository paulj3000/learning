"""IAM read semantics (Workstream B): in the worker, 403 / AccessDenied on an INPUT read (asset
objects now, derived artifacts later) is always an error and never "missing".

Why it matters: without s3:ListBucket on a prefix, S3 answers a missing key with 403, so a worker
that read 403 as "absent" would hide a broken IAM policy behind an empty result. The only place a
403 may mean "not stored yet" is the worker's OWN idempotency cache (stored results and shared
speech clips), where a later PutObject exposes a real permission fault. A source-level test pins
that exception to exactly those two call sites. Storage is a real botocore client under
`botocore.stub.Stubber`: no network, no AWS.
"""

import ast
import uuid
from pathlib import Path

import pytest
from botocore.stub import Stubber
from jobs_worker_fakes import FakeClientError

ROOT = Path(__file__).resolve().parents[2]
AWS_SOURCE = ROOT / "lambda" / "jobs_worker" / "aws.py"
KEY = f"assets/models/pip-boat/{uuid.uuid4()}/model.glb"
DENIALS = [
    ("AccessDenied", 403),
    ("403", 403),
    ("Forbidden", 403),
    ("AllAccessDisabled", 403),
    ("InvalidAccessKeyId", 403),
    ("SignatureDoesNotMatch", 403),
    ("", 403),  # only the HTTP status says denied
]


@pytest.fixture
def stubbed_s3():
    import boto3

    client = boto3.session.Session(
        aws_access_key_id="test",
        aws_secret_access_key="test",  # noqa: S106 - dummy, Stubber
        region_name="us-west-1",
    ).client("s3")
    with Stubber(client) as stubber:
        yield client, stubber


def ports(worker, make_runtime, client):
    runtime = make_runtime("media")
    runtime._clients["s3"] = client
    return worker.aws.AssetPorts(runtime)


@pytest.mark.parametrize(("code", "status"), DENIALS)
def test_a_denied_head_is_access_denied_never_a_missing_object(
    worker, make_runtime, stubbed_s3, code, status
):
    client, stubber = stubbed_s3
    stubber.add_client_error("head_object", service_error_code=code, http_status_code=status)
    with pytest.raises(worker.tasks.TaskError) as raised:
        ports(worker, make_runtime, client).asset_object_size(KEY)  # None would mean "missing"
    assert (raised.value.code, raised.value.retryable) == ("access_denied", False)


@pytest.mark.parametrize(("code", "status"), DENIALS)
def test_a_denied_ranged_read_is_access_denied(worker, make_runtime, stubbed_s3, code, status):
    client, stubber = stubbed_s3
    stubber.add_client_error("get_object", service_error_code=code, http_status_code=status)
    with pytest.raises(worker.tasks.TaskError) as raised:
        ports(worker, make_runtime, client).read_asset(KEY, 0, 16)
    assert (raised.value.code, raised.value.retryable) == ("access_denied", False)


@pytest.mark.parametrize(("code", "status"), [("NoSuchKey", 404), ("404", 404), ("NotFound", 404)])
def test_only_404_is_missing(worker, make_runtime, stubbed_s3, code, status):
    client, stubber = stubbed_s3
    stubber.add_client_error("head_object", service_error_code=code, http_status_code=status)
    assert ports(worker, make_runtime, client).asset_object_size(KEY) is None


def test_the_classifier_never_calls_a_denial_missing(worker):
    for code, status in DENIALS:
        error = FakeClientError(code, status)
        assert worker.aws._is_missing(error) is False
        assert worker.aws._asset_error(error).code == "access_denied"


def test_the_403_as_absent_rule_is_confined_to_the_workers_own_cache_lookups():
    """`_is_absent_cache_entry` may be called only by `load_result` (stored results) and
    `speech_object_size` (shared speech clips). Any new read path, an artifact input included,
    must use `_asset_error` (403 is an error)."""
    tree = ast.parse(AWS_SOURCE.read_text())
    callers: set[str] = set()
    for function in ast.walk(tree):
        if isinstance(function, ast.FunctionDef):
            for node in ast.walk(function):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and node.func.id == "_is_absent_cache_entry"
                ):
                    callers.add(function.name)
    assert callers == {"load_result", "speech_object_size"}
