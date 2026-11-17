"""RuntimeConfig.from_env reads exactly the frozen worker settings (WAVE2_INTERFACES.md s. 4)."""

from __future__ import annotations

from pathlib import Path

import pytest

from lai_processing.contracts.identifiers import StoreName
from lai_processing_runtime.config import ConfigError, LocalRuntimeConfig, RuntimeConfig

URL = "https://sqs.eu-west-2.amazonaws.com/123456789012/lai-dev-processing-completions"
ENV = {
    "LAI_PROCESSING_NAMESPACE": "dev",
    "LAI_PROCESSING_BUCKET": "lai-processing-dev-123456789012-eu-west-2",
    "LAI_ASSET_BUCKET": "lai-assets-dev",
    "LAI_PROCESSING_COMPLETION_QUEUE_URL": URL,
}


def test_defaults_and_store_mapping() -> None:
    config = RuntimeConfig.from_env(ENV)
    assert config.namespace == "dev"
    assert config.cleanup_margin_seconds == 30
    assert config.log_level == "INFO"
    assert config.buckets() == {
        StoreName.ASSETS: "lai-assets-dev",
        StoreName.QUARANTINE: "lai-processing-dev-123456789012-eu-west-2",
        StoreName.ARTIFACTS: "lai-processing-dev-123456789012-eu-west-2",
    }


def test_optional_settings() -> None:
    config = RuntimeConfig.from_env(
        {**ENV, "LAI_PROCESSING_CLEANUP_MARGIN_SECONDS": "60", "LAI_PROCESSING_LOG_LEVEL": "debug"}
    )
    assert config.cleanup_margin_seconds == 60
    assert config.log_level == "DEBUG"


def test_unrelated_settings_are_ignored() -> None:
    # A work queue URL or a bucket in some other variable never reaches the worker.
    config = RuntimeConfig.from_env({**ENV, "LAI_PROCESSING_WORK_QUEUE_URL": "x", "OTHER": "y"})
    assert config == RuntimeConfig.from_env(ENV)


@pytest.mark.parametrize("name", sorted(ENV))
def test_required_settings(name: str) -> None:
    env = dict(ENV)
    del env[name]
    with pytest.raises(ConfigError) as caught:
        RuntimeConfig.from_env(env)
    assert caught.value.setting == name


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("LAI_PROCESSING_NAMESPACE", "Dev"),
        ("LAI_PROCESSING_NAMESPACE", "dev_1"),
        ("LAI_PROCESSING_NAMESPACE", "-dev"),
        ("LAI_PROCESSING_NAMESPACE", "a" * 33),
        ("LAI_PROCESSING_BUCKET", "UPPER"),
        ("LAI_PROCESSING_BUCKET", "ab"),
        ("LAI_PROCESSING_BUCKET", "a..b"),
        ("LAI_PROCESSING_BUCKET", "192.168.1.1"),
        ("LAI_ASSET_BUCKET", "bucket/key"),
        ("LAI_PROCESSING_COMPLETION_QUEUE_URL", URL.replace("https:", "http:")),
        ("LAI_PROCESSING_COMPLETION_QUEUE_URL", "https://sqs.amazonaws.com/123/q"),
        ("LAI_PROCESSING_COMPLETION_QUEUE_URL", URL + "?x=1"),
        ("LAI_PROCESSING_COMPLETION_QUEUE_URL", "https://user:pw@sqs.x.com/123456789012/q"),
        ("LAI_PROCESSING_COMPLETION_QUEUE_URL", "sqs-queue"),
        ("LAI_PROCESSING_CLEANUP_MARGIN_SECONDS", "4"),
        ("LAI_PROCESSING_CLEANUP_MARGIN_SECONDS", "301"),
        ("LAI_PROCESSING_CLEANUP_MARGIN_SECONDS", "30s"),
        ("LAI_PROCESSING_CLEANUP_MARGIN_SECONDS", "-5"),
        ("LAI_PROCESSING_LOG_LEVEL", "LOUD"),
    ],
)
def test_invalid_values_name_the_setting_not_the_value(name: str, value: str) -> None:
    with pytest.raises(ConfigError) as caught:
        RuntimeConfig.from_env({**ENV, name: value})
    assert caught.value.setting == name
    assert value not in str(caught.value) or value in name


@pytest.mark.parametrize("margin", ["5", "300"])
def test_margin_bounds_are_inclusive(margin: str) -> None:
    env = {**ENV, "LAI_PROCESSING_CLEANUP_MARGIN_SECONDS": margin}
    assert RuntimeConfig.from_env(env).cleanup_margin_seconds == int(margin)


def test_local_config_layout(tmp_path: Path) -> None:
    config = LocalRuntimeConfig(root=tmp_path / "p", assets_root=tmp_path / "a")
    assert config.namespace == "local"
    assert config.work_queue_dir == tmp_path / "p" / "queues" / "work"
    assert config.completion_queue_dir == tmp_path / "p" / "queues" / "completions"
    assert config.storage_roots() == {
        StoreName.ASSETS: tmp_path / "a",
        StoreName.QUARANTINE: tmp_path / "p",
        StoreName.ARTIFACTS: tmp_path / "p",
    }
    with pytest.raises(ConfigError):
        LocalRuntimeConfig(root=tmp_path, assets_root=tmp_path, namespace="Bad")
    with pytest.raises(ConfigError):
        LocalRuntimeConfig(root=tmp_path, assets_root=tmp_path, cleanup_margin_seconds=1)
