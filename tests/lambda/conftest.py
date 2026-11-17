"""Fixtures for the jobs worker tests: the worker imported from its packaged layout, and fake
AWS clients. Nothing here touches the network or AWS."""

import importlib
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from jobs_worker_fakes import (
    SSM_VALUES,
    FakeModel,
    FakePolly,
    FakeS3,
    FakeSQS,
    FakeSSM,
    environ,
)

ROOT = Path(__file__).resolve().parents[2]


def _load_build():
    spec = importlib.util.spec_from_file_location("lai_lambda_build", ROOT / "lambda" / "build.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def build_module():
    return _load_build()


@pytest.fixture(scope="session")
def worker(tmp_path_factory, build_module):
    """`jobs_worker` imported from a staged copy of exactly what the zip contains."""
    staged = build_module.stage(tmp_path_factory.mktemp("worker"))
    sys.path.insert(0, str(staged))
    handler = importlib.import_module("jobs_worker.handler")
    aws = importlib.import_module("jobs_worker.aws")
    core = importlib.import_module("jobs_worker.vendor.jobs_core.envelope")
    tasks = importlib.import_module("jobs_worker.vendor.jobs_core.tasks")
    base = importlib.import_module("jobs_worker.vendor.ai_providers.base")
    bedrock = importlib.import_module("jobs_worker.vendor.ai_providers.bedrock")
    yield SimpleNamespace(
        handler=handler, aws=aws, envelope=core, tasks=tasks, base=base, bedrock=bedrock
    )
    sys.path.remove(str(staged))


@pytest.fixture
def fakes():
    return SimpleNamespace(
        s3=FakeS3(),
        sqs=FakeSQS(),
        ssm=FakeSSM(dict(SSM_VALUES)),
        polly=FakePolly(),
        model=FakeModel([]),
    )


@pytest.fixture
def make_runtime(worker, fakes):
    def make(queue="ai", **env):
        settings = worker.aws.Settings({**environ(queue), **env})
        return worker.aws.Runtime(
            settings,
            clients={"s3": fakes.s3, "sqs": fakes.sqs, "ssm": fakes.ssm, "polly": fakes.polly},
            bedrock_factory=lambda config: fakes.model,
        )

    return make


@pytest.fixture
def context():
    return SimpleNamespace(
        function_name="lai-dev-jobs-ai",
        aws_request_id="req-1",
        get_remaining_time_in_millis=lambda: 290_000,
    )
