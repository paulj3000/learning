"""Import allowlists per package family (Workstream B): `lai_processing` is standard library
only, `jobs_worker` may add boto3 and botocore, `lai_native` alone may use subprocess and approved
native libraries (PIL), and neither `lai_processing` nor any worker imports `lai_native` or PIL.
The policy lives in `lambda/build.py` (it is enforced when the zip is built) and is audited here
for every guarded package, future `lambda/*_worker` packages included."""

import pytest


@pytest.fixture
def policy(build_module):
    return build_module


def found(policy, source, family, package=""):
    return policy.import_violations(source, family, package=package)


def test_the_repository_is_clean(policy):
    assert policy.audit_imports() == []


def test_every_guarded_package_is_classified(policy):
    files = policy.guarded_files()
    assert files, "no guarded files found"
    families = {policy.classify_package(f)[0] for f in files}
    assert {"processing", "jobs_worker", "native"} <= families or {
        "processing",
        "jobs_worker",
    } <= families
    assert all(policy.classify_package(f) is not None for f in files)


def test_future_native_workers_are_discovered_by_name(policy, tmp_path, monkeypatch):
    worker = policy.ROOT / "lambda" / "audio_worker" / "handler.py"
    assert policy.classify_package(worker) == ("native_worker", "audio_worker")
    assert policy.classify_package(policy.ROOT / "lambda" / "jobs_worker" / "aws.py") == (
        "jobs_worker",
        "jobs_worker",
    )
    assert policy.classify_package(policy.ROOT / "processing" / "lai_native" / "x.py") == (
        "native",
        "lai_native",
    )


@pytest.mark.parametrize(
    "source",
    [
        "import lai_native",
        "from lai_native.audio import transcode",
        "import PIL",
        "from PIL import Image",
        "import boto3",
        "import botocore.config",
        "import subprocess",
        "import ctypes",
        "import django",
        "import numpy",
        "__import__('PIL')",
        "import importlib\nimportlib.import_module('lai_native')",
    ],
)
def test_the_pure_library_refuses_everything_but_the_standard_library(policy, source):
    assert found(policy, source, "processing", "lai_processing"), source


def test_the_pure_library_accepts_the_standard_library_and_itself(policy):
    source = "import json, hashlib\nfrom typing import Any\nimport lai_processing.core.errors\n"
    assert found(policy, source, "processing", "lai_processing") == []


@pytest.mark.parametrize(
    "source",
    [
        "import lai_native",
        "from PIL import Image",
        "import subprocess",
        "import ctypes",
        "import django",
        "import numpy",
        "from lai_native.image import resize",
    ],
)
def test_jobs_worker_never_imports_native_code(policy, source):
    assert found(policy, source, "jobs_worker", "jobs_worker"), source


def test_jobs_worker_may_import_aws_and_the_pure_library(policy):
    source = (
        "import json, os, threading\nimport boto3\nfrom botocore.config import Config\n"
        "import lai_processing.core.registry\nimport jobs_worker.aws\nfrom . import aws\n"
    )
    assert found(policy, source, "jobs_worker", "jobs_worker") == []


def test_native_workers_use_lai_native_not_the_native_libraries(policy):
    ok = "import boto3\nimport lai_native.image\nimport lai_processing\nimport image_worker.x\n"
    assert found(policy, ok, "native_worker", "image_worker") == []
    for bad in ("from PIL import Image", "import subprocess", "import django", "import numpy"):
        assert found(policy, bad, "native_worker", "image_worker"), bad


def test_lai_native_may_run_tools_and_use_approved_libraries_but_not_aws(policy):
    ok = "import subprocess\nimport shutil\nfrom PIL import Image\nimport lai_processing\n"
    assert found(policy, ok, "native", "lai_native") == []
    for bad in ("import boto3", "import django", "import jobs_worker.aws", "import numpy"):
        assert found(policy, bad, "native", "lai_native"), bad


def test_the_build_refuses_native_imports_in_the_worker_and_the_pure_library(
    policy, monkeypatch, tmp_path
):
    worker = tmp_path / "jobs_worker"
    worker.mkdir()
    (worker / "handler.py").write_text("from PIL import Image\n")
    monkeypatch.setattr(policy, "WORKER", worker)
    with pytest.raises(policy.BuildError, match="jobs_worker import policy"):
        policy.entries()


def test_the_build_refuses_lai_native_in_the_pure_library(policy, monkeypatch, tmp_path):
    import shutil

    copy = tmp_path / "lai_processing"
    shutil.copytree(policy.PROCESSING, copy, ignore=shutil.ignore_patterns("__pycache__"))
    (copy / "core" / "sneaky.py").write_text("import lai_native\n")
    monkeypatch.setattr(policy, "PROCESSING", copy)
    with pytest.raises(policy.BuildError, match="processing import policy"):
        policy.entries()


def test_the_zip_never_ships_lai_native_and_stays_reproducible(policy, tmp_path):
    names = set(policy.entries())
    assert not [n for n in names if n.startswith(("lai_native/", "PIL/"))]
    first, second = policy.build(tmp_path / "a"), policy.build(tmp_path / "b")
    assert first.read_bytes() == second.read_bytes() and first.name == second.name
