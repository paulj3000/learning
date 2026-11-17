"""The processor registry: an explicit, closed mapping from job types and profiles to code.

Security decisions:
- Processors are registered by explicit Python calls (`default_registry` lists them). There are
  no entry points, no `importlib`, and no name-to-class lookup, so a message can only select
  among processors the worker was built with, never cause code to be loaded.
- A registry is frozen before use; a frozen registry refuses further registration.
- A profile is identified globally by (profile_id, version) and served by exactly one
  processor, and every profile must belong to a job type its processor declares and that the
  contracts catalog (`JOB_TYPES`) knows. Ambiguity is refused at registration, not at runtime.
- Profiles are snapshotted at registration, so a processor cannot change them afterwards.
"""

from __future__ import annotations

from typing import Any

from ..contracts.common import ProfileRef
from ..contracts.job_types import JOB_TYPES
from ..contracts.profiles import ProcessingProfile
from ..processors.animation.processor import AnimationInspectorProcessor
from ..processors.gltf.processor import GlbValidatorProcessor
from ..processors.reference import ReferenceProcessor
from .errors import ErrorCode, ProcessingError
from .processor import Processor

__all__ = ["ProcessorRegistry", "default_registry"]


class ProcessorRegistry:
    def __init__(self) -> None:
        self._processors: dict[str, Processor] = {}
        self._profiles: dict[tuple[str, int], tuple[Processor, ProcessingProfile]] = {}
        self._frozen = False

    @property
    def frozen(self) -> bool:
        return self._frozen

    def register(self, processor: Processor) -> None:
        if self._frozen:
            raise ValueError("the registry is frozen")
        if not isinstance(processor, Processor):
            raise ValueError("not a Processor")
        try:
            identity = processor.identity
        except (AttributeError, ProcessingError):
            raise ValueError("invalid processor id or version") from None
        if identity.processor_id in self._processors:
            raise ValueError(f"duplicate processor id: {identity.processor_id}")
        job_types = getattr(processor, "job_types", None)
        if not isinstance(job_types, frozenset) or not job_types:
            raise ValueError("job_types must be a non-empty frozenset")
        for job_type in job_types:
            if not isinstance(job_type, str) or job_type not in JOB_TYPES:
                raise ValueError(f"unknown job type: {job_type!r}")
        profiles = tuple(processor.profiles())
        claimed: dict[tuple[str, int], tuple[Processor, ProcessingProfile]] = {}
        for profile in profiles:
            if not isinstance(profile, ProcessingProfile):
                raise ValueError("profiles() must return ProcessingProfile instances")
            if profile.job_type not in job_types:
                raise ValueError(
                    f"profile {profile.profile_id} v{profile.version} serves an undeclared "
                    f"job type {profile.job_type}"
                )
            key = (profile.profile_id, profile.version)
            if key in self._profiles or key in claimed:
                raise ValueError(
                    f"profile already claimed: {profile.profile_id} v{profile.version}"
                )
            claimed[key] = (processor, profile)
        self._processors[identity.processor_id] = processor
        self._profiles.update(claimed)

    def freeze(self) -> None:
        self._frozen = True

    def resolve(self, job_type: str, profile: ProfileRef) -> tuple[Processor, ProcessingProfile]:
        """The processor and profile for a job, or a classified refusal.

        UNSUPPORTED_PROCESSOR (MANUAL): no registered processor serves the job type at all, a
        deployment problem. INVALID_PROCESSING_PROFILE (PERMANENT): the profile id/version is
        unknown or belongs to another job type, a request problem.
        """
        if not any(job_type in p.job_types for p in self._processors.values()):
            raise ProcessingError(ErrorCode.UNSUPPORTED_PROCESSOR, {"field": "job_type"})
        entry = self._profiles.get((profile.profile_id, profile.version))
        if entry is None:
            raise ProcessingError(ErrorCode.INVALID_PROCESSING_PROFILE, {"field": "profile"})
        processor, found = entry
        if found.job_type != job_type:
            raise ProcessingError(
                ErrorCode.INVALID_PROCESSING_PROFILE, {"field": "profile", "reason": "job_type"}
            )
        return processor, found

    def processors(self) -> list[Processor]:
        return [self._processors[k] for k in sorted(self._processors)]

    def profiles(self) -> list[ProcessingProfile]:
        return [self._profiles[k][1] for k in sorted(self._profiles)]

    def describe(self) -> list[dict[str, Any]]:
        """A deterministic, JSON-ready description of every processor and profile."""
        out: list[dict[str, Any]] = []
        for processor in self.processors():
            own = [
                profile
                for key, (owner, profile) in sorted(self._profiles.items())
                if owner is processor
            ]
            out.append(
                {
                    "processor_id": processor.processor_id,
                    "version": processor.version,
                    "job_types": sorted(processor.job_types),
                    "profiles": [
                        {
                            "profile_id": profile.profile_id,
                            "version": profile.version,
                            "job_type": profile.job_type,
                            "options": {
                                name: {
                                    "type": spec.type,
                                    "default": spec.default,
                                    "required": spec.required,
                                    "choices": (
                                        list(spec.choices) if spec.choices is not None else None
                                    ),
                                    "minimum": spec.minimum,
                                    "maximum": spec.maximum,
                                }
                                for name, spec in sorted(profile.options.items())
                            },
                        }
                        for profile in own
                    ],
                }
            )
        return out


def default_registry() -> ProcessorRegistry:
    """A new frozen registry with the processors this build ships, listed explicitly."""
    registry = ProcessorRegistry()
    for processor in (
        ReferenceProcessor(),
        GlbValidatorProcessor(),
        AnimationInspectorProcessor(),
    ):
        registry.register(processor)
    registry.freeze()
    return registry
