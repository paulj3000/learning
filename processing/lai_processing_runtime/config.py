"""Worker runtime configuration (docs/processing/WAVE2_INTERFACES.md, section 4).

`RuntimeConfig.from_env` reads exactly the worker settings of the frozen interface page and
nothing else; buckets and queue URLs come only from here, never from a message.
`LocalRuntimeConfig` is the local-worker variant: directory roots instead of buckets and queues.

A `ConfigError` names the setting at fault, never its value, so a misconfigured secret-looking
value cannot reach a log.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final
from urllib.parse import urlsplit

from lai_processing.contracts.identifiers import NAMESPACE, StoreName

__all__ = [
    "DEFAULT_CLEANUP_MARGIN_SECONDS",
    "LOG_LEVELS",
    "ConfigError",
    "LocalRuntimeConfig",
    "RuntimeConfig",
    "check_bucket_name",
    "check_cleanup_margin",
    "check_log_level",
    "check_namespace_setting",
    "check_queue_url",
]

ENV_NAMESPACE: Final = "LAI_PROCESSING_NAMESPACE"
ENV_PROCESSING_BUCKET: Final = "LAI_PROCESSING_BUCKET"
ENV_ASSET_BUCKET: Final = "LAI_ASSET_BUCKET"
ENV_COMPLETION_QUEUE_URL: Final = "LAI_PROCESSING_COMPLETION_QUEUE_URL"
ENV_CLEANUP_MARGIN: Final = "LAI_PROCESSING_CLEANUP_MARGIN_SECONDS"
ENV_LOG_LEVEL: Final = "LAI_PROCESSING_LOG_LEVEL"

DEFAULT_CLEANUP_MARGIN_SECONDS: Final = 30
MIN_CLEANUP_MARGIN_SECONDS: Final = 5
MAX_CLEANUP_MARGIN_SECONDS: Final = 300
LOG_LEVELS: Final = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")
MAX_NAMESPACE_LENGTH: Final = 32

# S3 bucket naming rules: 3 to 63 characters, lowercase letters, digits, dots and hyphens,
# starting and ending with a letter or digit, no "..", not shaped like an IP address.
_BUCKET: Final = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")
_IP_LIKE: Final = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")
# SQS queue URL path: /<12-digit account>/<queue name>; standard queues only (no .fifo).
_QUEUE_PATH: Final = re.compile(r"^/\d{12}/[A-Za-z0-9_-]{1,80}$")
_HOST: Final = re.compile(r"^[a-z0-9.-]{1,253}$")


class ConfigError(ValueError):
    """A worker setting is missing or invalid. The message names the setting only."""

    def __init__(self, setting: str, problem: str = "is missing or invalid") -> None:
        self.setting = setting
        super().__init__(f"{setting} {problem}")


def check_namespace_setting(value: str | None, setting: str = ENV_NAMESPACE) -> str:
    if not value or len(value) > MAX_NAMESPACE_LENGTH or not NAMESPACE.fullmatch(value):
        raise ConfigError(setting)
    return value


def check_bucket_name(value: str | None, setting: str) -> str:
    if not value or not _BUCKET.fullmatch(value) or ".." in value or _IP_LIKE.fullmatch(value):
        raise ConfigError(setting)
    return value


def check_queue_url(value: str | None, setting: str) -> str:
    """An `https://<host>/<account>/<queue>` SQS URL with no query, fragment or credentials."""
    if not value:
        raise ConfigError(setting)
    try:
        parts = urlsplit(value)
    except ValueError:
        raise ConfigError(setting) from None
    if (
        parts.scheme != "https"
        or not parts.hostname
        or not _HOST.fullmatch(parts.hostname)
        or parts.username is not None
        or parts.password is not None
        or parts.query
        or parts.fragment
        or not _QUEUE_PATH.fullmatch(parts.path)
    ):
        raise ConfigError(setting)
    return value


def check_cleanup_margin(value: str | int | None, setting: str = ENV_CLEANUP_MARGIN) -> int:
    if value is None or value == "":
        return DEFAULT_CLEANUP_MARGIN_SECONDS
    if isinstance(value, bool):
        raise ConfigError(setting)
    if isinstance(value, str):
        text = value.strip()
        if not text.isdigit():
            raise ConfigError(setting)
        number = int(text)
    else:
        number = value
    if not MIN_CLEANUP_MARGIN_SECONDS <= number <= MAX_CLEANUP_MARGIN_SECONDS:
        raise ConfigError(setting)
    return number


def check_log_level(value: str | None, setting: str = ENV_LOG_LEVEL) -> str:
    if value is None or value == "":
        return "INFO"
    level = value.strip().upper()
    if level not in LOG_LEVELS:
        raise ConfigError(setting)
    return level


@dataclass(frozen=True, slots=True)
class RuntimeConfig:
    """The Lambda worker's settings. Construct with `from_env`."""

    namespace: str
    processing_bucket: str
    asset_bucket: str
    completion_queue_url: str
    cleanup_margin_seconds: int = DEFAULT_CLEANUP_MARGIN_SECONDS
    log_level: str = "INFO"

    def __post_init__(self) -> None:
        check_namespace_setting(self.namespace)
        check_bucket_name(self.processing_bucket, ENV_PROCESSING_BUCKET)
        check_bucket_name(self.asset_bucket, ENV_ASSET_BUCKET)
        check_queue_url(self.completion_queue_url, ENV_COMPLETION_QUEUE_URL)
        check_cleanup_margin(self.cleanup_margin_seconds)
        check_log_level(self.log_level)

    @classmethod
    def from_env(cls, environ: Mapping[str, str]) -> RuntimeConfig:
        return cls(
            namespace=check_namespace_setting(environ.get(ENV_NAMESPACE)),
            processing_bucket=check_bucket_name(
                environ.get(ENV_PROCESSING_BUCKET), ENV_PROCESSING_BUCKET
            ),
            asset_bucket=check_bucket_name(environ.get(ENV_ASSET_BUCKET), ENV_ASSET_BUCKET),
            completion_queue_url=check_queue_url(
                environ.get(ENV_COMPLETION_QUEUE_URL), ENV_COMPLETION_QUEUE_URL
            ),
            cleanup_margin_seconds=check_cleanup_margin(environ.get(ENV_CLEANUP_MARGIN)),
            log_level=check_log_level(environ.get(ENV_LOG_LEVEL)),
        )

    def buckets(self) -> dict[StoreName, str]:
        """Logical store to bucket (section 3). Quarantine and artifacts share one bucket and
        are separated by their key prefixes."""
        return {
            StoreName.ASSETS: self.asset_bucket,
            StoreName.QUARANTINE: self.processing_bucket,
            StoreName.ARTIFACTS: self.processing_bucket,
        }


@dataclass(frozen=True, slots=True)
class LocalRuntimeConfig:
    """The local worker's settings: one processing root and an assets root.

    Layout (section 3; the same layout Django's `local` backend uses under
    `LAI_PROCESSING_LOCAL_ROOT`):
    - `<root>/<key>` for the quarantine and artifacts stores (keys start `processing/`);
    - `<assets_root>/<key>` for the assets store (keys start `assets/`), which is the layout of
      Django's `LocalAssetStorage` under `LAI_ASSET_LOCAL_ROOT`;
    - `<root>/queues/work` and `<root>/queues/completions` for the two local queues.
    """

    root: Path
    assets_root: Path
    namespace: str = "local"
    cleanup_margin_seconds: int = DEFAULT_CLEANUP_MARGIN_SECONDS
    log_level: str = "INFO"

    def __post_init__(self) -> None:
        check_namespace_setting(self.namespace, "--namespace")
        check_cleanup_margin(self.cleanup_margin_seconds, "--cleanup-margin")
        check_log_level(self.log_level, "--log-level")
        object.__setattr__(self, "root", Path(self.root))
        object.__setattr__(self, "assets_root", Path(self.assets_root))

    @property
    def work_queue_dir(self) -> Path:
        return self.root / "queues" / "work"

    @property
    def completion_queue_dir(self) -> Path:
        return self.root / "queues" / "completions"

    @property
    def workspace_dir(self) -> Path:
        return self.root / "tmp" / "workspaces"

    def storage_roots(self) -> dict[StoreName, Path]:
        return {
            StoreName.ASSETS: self.assets_root,
            StoreName.QUARANTINE: self.root,
            StoreName.ARTIFACTS: self.root,
        }
