"""Processing profiles: named, versioned, immutable processing configurations.

A profile fixes which job type it serves, which options a request may set (with types, bounds,
allowed values and defaults), and the default limits. A profile version never changes once
used; a new behaviour is a new version. Profiles are declared in code alongside their
processor and indexed by the processor registry; Django later stores which profile version a job
used (Wave 2, LAI-LAMBDA-004).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Final, Literal

from ..core.errors import ErrorCode, ProcessingError
from ..core.limits import DEFAULT_LIMITS, ResourceLimits
from . import _fields as f
from .common import ProfileRef
from .identifiers import SLUG, SNAKE
from .job_types import job_type_spec

__all__ = ["OptionSpec", "ProcessingProfile"]

OptionType = Literal["bool", "int", "str"]
_PY_TYPES: Final = {"bool": bool, "int": int, "str": str}


def _profile_error(field: str) -> ProcessingError:
    return ProcessingError(ErrorCode.INVALID_PROCESSING_PROFILE, {"field": field})


@dataclass(frozen=True, slots=True)
class OptionSpec:
    """One option a request may set. Unknown options are always refused."""

    type: OptionType
    default: bool | int | str | None = None
    required: bool = False
    choices: tuple[str, ...] | None = None
    minimum: int | None = None
    maximum: int | None = None

    def __post_init__(self) -> None:
        if self.type not in _PY_TYPES:
            raise ValueError("unknown option type")
        if self.required and self.default is not None:
            raise ValueError("a required option has no default")
        if self.default is not None:
            self.check(self.default, "default")

    def check(self, value: object, name: str) -> bool | int | str:
        expected = _PY_TYPES[self.type]
        if type(value) is not expected:
            raise _profile_error(f"options.{name}")
        if self.choices is not None and value not in self.choices:
            raise _profile_error(f"options.{name}")
        if self.type == "int":
            assert isinstance(value, int)
            if self.minimum is not None and value < self.minimum:
                raise _profile_error(f"options.{name}")
            if self.maximum is not None and value > self.maximum:
                raise _profile_error(f"options.{name}")
        return value  # type: ignore[return-value]


@dataclass(frozen=True, slots=True)
class ProcessingProfile:
    profile_id: str
    version: int
    job_type: str
    description: str
    options: Mapping[str, OptionSpec] = field(default_factory=lambda: MappingProxyType({}))
    limits: ResourceLimits = DEFAULT_LIMITS

    def __post_init__(self) -> None:
        f.string(self.profile_id, "profile.profile_id", SLUG)
        f.integer(self.version, "profile.version", minimum=1, maximum=1_000_000)
        job_type_spec(self.job_type)
        for name, spec in self.options.items():
            if not SNAKE.fullmatch(name) or not isinstance(spec, OptionSpec):
                raise ValueError("invalid option declaration")
        object.__setattr__(self, "options", MappingProxyType(dict(sorted(self.options.items()))))

    @property
    def ref(self) -> ProfileRef:
        return ProfileRef(profile_id=self.profile_id, version=self.version)

    def resolve_options(self, supplied: Mapping[str, Any]) -> Mapping[str, Any]:
        """Validate `supplied` against the declared options and fill in defaults.

        Refuses unknown options, wrong types, out-of-range values and missing required options
        with INVALID_PROCESSING_PROFILE. The result is deterministic (sorted keys)."""
        unknown = set(supplied) - set(self.options)
        if unknown:
            raise _profile_error(f"options.{sorted(unknown)[0]}")
        resolved: dict[str, Any] = {}
        for name, spec in self.options.items():
            if name in supplied:
                resolved[name] = spec.check(supplied[name], name)
            elif spec.required:
                raise _profile_error(f"options.{name}")
            elif spec.default is not None:
                resolved[name] = spec.default
        return MappingProxyType(resolved)
