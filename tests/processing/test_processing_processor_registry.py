"""Processor registry: explicit registration, refusal of ambiguity, and classified resolution."""

from __future__ import annotations

import json

import pytest

from lai_processing.contracts import (
    OptionSpec,
    ProcessingProfile,
    ProfileRef,
    Verdict,
)
from lai_processing.core.errors import ErrorCode, ProcessingError, RetryClass
from lai_processing.core.processor import (
    CancellationToken,
    ProcessingContext,
    Processor,
    ProcessorOutput,
)
from lai_processing.core.registry import ProcessorRegistry, default_registry
from lai_processing.processors.audio import AudioInspectorProcessor
from lai_processing.processors.gltf import GlbValidatorProcessor
from lai_processing.processors.reference import ReferenceProcessor


def _profile(
    profile_id: str = "alpha", version: int = 1, job_type: str = "reference.checksum"
) -> ProcessingProfile:
    return ProcessingProfile(
        profile_id=profile_id,
        version=version,
        job_type=job_type,
        description="test profile",
        options={"level": OptionSpec("int", default=1, minimum=0, maximum=3)},
    )


def _processor(
    pid: str = "test.alpha",
    profiles: tuple[ProcessingProfile, ...] | None = None,
    job_types: frozenset[str] = frozenset({"reference.checksum"}),
    version: str = "1.0.0",
) -> Processor:
    chosen = profiles if profiles is not None else (_profile(),)

    class _P(Processor):
        processor_id = pid
        job_types = frozenset()

        def profiles(self) -> tuple[ProcessingProfile, ...]:
            return chosen

        def process(self, context: ProcessingContext) -> ProcessorOutput:
            return ProcessorOutput(verdict=Verdict.PASS)

    _P.job_types = job_types
    _P.version = version
    return _P()


def test_register_and_resolve() -> None:
    registry = ProcessorRegistry()
    processor = _processor()
    registry.register(processor)
    found, profile = registry.resolve("reference.checksum", ProfileRef("alpha", 1))
    assert found is processor
    assert profile.profile_id == "alpha"


def test_duplicate_processor_id_refused() -> None:
    registry = ProcessorRegistry()
    registry.register(_processor())
    with pytest.raises(ValueError, match="duplicate processor id"):
        registry.register(_processor(profiles=(_profile("beta"),)))


def test_two_processors_cannot_claim_the_same_profile_version() -> None:
    registry = ProcessorRegistry()
    registry.register(_processor("test.alpha"))
    with pytest.raises(ValueError, match="already claimed"):
        registry.register(_processor("test.beta"))
    # A new version of the same profile id is a different profile and is accepted.
    registry.register(_processor("test.beta", profiles=(_profile("alpha", 2),)))


def test_one_processor_cannot_declare_a_profile_twice() -> None:
    with pytest.raises(ValueError, match="already claimed"):
        ProcessorRegistry().register(_processor(profiles=(_profile(), _profile())))


def test_profile_for_undeclared_job_type_refused() -> None:
    bad = _processor(profiles=(_profile(job_type="asset.validate_model"),))
    with pytest.raises(ValueError, match="undeclared"):
        ProcessorRegistry().register(bad)


def test_unknown_job_type_refused() -> None:
    with pytest.raises(ValueError, match="unknown job type"):
        ProcessorRegistry().register(_processor(job_types=frozenset({"made.up"})))


def test_empty_or_non_frozenset_job_types_refused() -> None:
    with pytest.raises(ValueError):
        ProcessorRegistry().register(_processor(job_types=frozenset()))
    with pytest.raises(ValueError):
        ProcessorRegistry().register(
            _processor(job_types={"reference.checksum"})  # type: ignore[arg-type]
        )


@pytest.mark.parametrize("pid,version", [("NotDotted", "1.0.0"), ("test.ok", "1.0")])
def test_invalid_identity_refused(pid: str, version: str) -> None:
    with pytest.raises(ValueError, match="invalid processor"):
        ProcessorRegistry().register(_processor(pid, version=version))


def test_non_processor_refused() -> None:
    with pytest.raises(ValueError):
        ProcessorRegistry().register(object())  # type: ignore[arg-type]


def test_frozen_registry_refuses_registration() -> None:
    registry = ProcessorRegistry()
    registry.freeze()
    assert registry.frozen
    with pytest.raises(ValueError, match="frozen"):
        registry.register(_processor())


def test_failed_registration_leaves_no_partial_state() -> None:
    registry = ProcessorRegistry()
    registry.register(_processor("test.alpha", profiles=(_profile("alpha"),)))
    with pytest.raises(ValueError):
        registry.register(_processor("test.beta", profiles=(_profile("beta"), _profile("alpha"))))
    assert [p.processor_id for p in registry.processors()] == ["test.alpha"]
    assert [p.profile_id for p in registry.profiles()] == ["alpha"]


def test_resolve_unknown_processor_is_manual() -> None:
    registry = default_registry()
    with pytest.raises(ProcessingError) as info:
        registry.resolve("asset.optimize", ProfileRef("reference-default", 1))
    assert info.value.code is ErrorCode.UNSUPPORTED_PROCESSOR
    assert info.value.retry_class is RetryClass.MANUAL


def test_resolve_unknown_profile_version() -> None:
    with pytest.raises(ProcessingError) as info:
        default_registry().resolve("reference.checksum", ProfileRef("reference-default", 2))
    assert info.value.code is ErrorCode.INVALID_PROCESSING_PROFILE


def test_resolve_unknown_profile_id() -> None:
    with pytest.raises(ProcessingError) as info:
        default_registry().resolve("reference.checksum", ProfileRef("nope", 1))
    assert info.value.code is ErrorCode.INVALID_PROCESSING_PROFILE


def test_resolve_profile_of_another_job_type() -> None:
    registry = ProcessorRegistry()
    registry.register(_processor("test.ref"))
    registry.register(
        _processor(
            "test.model",
            profiles=(_profile("model-profile", job_type="asset.validate_model"),),
            job_types=frozenset({"asset.validate_model"}),
        )
    )
    with pytest.raises(ProcessingError) as info:
        registry.resolve("reference.checksum", ProfileRef("model-profile", 1))
    assert info.value.code is ErrorCode.INVALID_PROCESSING_PROFILE


def test_profiles_are_snapshotted_at_registration() -> None:
    profiles = [_profile("alpha")]

    class Mutable(Processor):
        processor_id = "test.mutable"
        version = "1.0.0"
        job_types = frozenset({"reference.checksum"})

        def profiles(self) -> tuple[ProcessingProfile, ...]:
            return tuple(profiles)

        def process(self, context: ProcessingContext) -> ProcessorOutput:
            return ProcessorOutput(verdict=Verdict.PASS)

    registry = ProcessorRegistry()
    registry.register(Mutable())
    profiles.append(_profile("sneaky"))
    with pytest.raises(ProcessingError):
        registry.resolve("reference.checksum", ProfileRef("sneaky", 1))


def test_listing_is_sorted_and_describe_is_deterministic() -> None:
    def build(order: list[str]) -> ProcessorRegistry:
        registry = ProcessorRegistry()
        for pid in order:
            registry.register(_processor(pid, profiles=(_profile(pid.split(".")[1]),)))
        return registry

    a = build(["test.zeta", "test.alpha", "test.mid"])
    b = build(["test.mid", "test.zeta", "test.alpha"])
    assert [p.processor_id for p in a.processors()] == ["test.alpha", "test.mid", "test.zeta"]
    assert [p.profile_id for p in a.profiles()] == ["alpha", "mid", "zeta"]
    assert json.dumps(a.describe(), sort_keys=True) == json.dumps(b.describe(), sort_keys=True)
    assert json.dumps(a.describe()) == json.dumps(b.describe())


def test_default_registry_describe() -> None:
    registry = default_registry()
    assert registry.frozen
    assert [type(p) for p in registry.processors()] == [
        AudioInspectorProcessor,
        GlbValidatorProcessor,
        ReferenceProcessor,
    ]
    # The GLB processor's own description is covered by test_processing_glb_processor.py.
    described = [p for p in registry.describe() if p["processor_id"] == "reference.checksum"]
    assert described == [
        {
            "processor_id": "reference.checksum",
            "version": "1.0.0",
            "job_types": ["reference.checksum"],
            "profiles": [
                {
                    "profile_id": "reference-default",
                    "version": 1,
                    "job_type": "reference.checksum",
                    "options": {
                        "metadata_level": {
                            "type": "str",
                            "default": "basic",
                            "required": False,
                            "choices": ["basic", "full"],
                            "minimum": None,
                            "maximum": None,
                        },
                        "write_report": {
                            "type": "bool",
                            "default": False,
                            "required": False,
                            "choices": None,
                            "minimum": None,
                            "maximum": None,
                        },
                    },
                }
            ],
        }
    ]
    json.dumps(described)  # JSON-ready
    # Each call is a new registry, so callers cannot mutate a shared one.
    assert default_registry() is not registry


def test_cancellation_token() -> None:
    token = CancellationToken()
    assert not token.cancelled
    token.raise_if_cancelled()
    token.cancel()
    assert token.cancelled
    with pytest.raises(ProcessingError) as info:
        token.raise_if_cancelled()
    assert info.value.code is ErrorCode.CANCELLED


def test_processor_output_validates_types() -> None:
    with pytest.raises(ValueError):
        ProcessorOutput(verdict="maybe")  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        ProcessorOutput(verdict=Verdict.PASS, findings=("x",))  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        ProcessorOutput(verdict=Verdict.PASS, metadata=[1])  # type: ignore[arg-type]
    assert ProcessorOutput(verdict="pass").verdict is Verdict.PASS  # type: ignore[arg-type]
