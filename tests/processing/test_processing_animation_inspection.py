"""The `asset.animation_inspector` processor (`asset.analyze_animation`, LAI-LAMBDA-009): the
bounded read-only pass over GLB animation data, through the inspector, the registry and the
engine. Every model is synthetic (glb_builder); no binary fixtures, no child data."""

from __future__ import annotations

import copy
import hashlib
import io
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from glb_builder import MIXAMO_CLIP, Builder, glb, skinned_glb, skinned_model, static_glb

from lai_processing.contracts import (
    AssetContext,
    InputObject,
    ObjectRef,
    ProcessingJobRequest,
    ProfileRef,
    ResultStatus,
    StoreName,
    SubjectRef,
    Verdict,
    decode_result,
    encode,
)
from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.core.execution import ExecutionEngine
from lai_processing.core.idempotency import request_idempotency_key
from lai_processing.core.limits import ResourceLimits
from lai_processing.core.registry import default_registry
from lai_processing.processors.animation import (
    ANIMATION_PROFILE,
    AnimationInspectorProcessor,
    AnimationSettings,
    build_metadata,
    inspect_glb,
)
from lai_processing.processors.gltf import GlbValidatorProcessor
from lai_processing.testing import ManualClock, MemoryObjectStorage, RecordingTelemetry

NS = "test"
JOB_ID = "11111111-1111-4111-8111-111111111111"
ATTEMPT_ID = "22222222-2222-4222-8222-222222222222"
VERSION_ID = "33333333-3333-4333-8333-333333333333"
KEY = f"processing/quarantine/{NS}/{JOB_ID}/input.bin"


def inspect(data: bytes, settings: AnimationSettings | None = None, max_bytes: int = 65_536):
    outcome = inspect_glb(io.BytesIO(data), len(data), settings or AnimationSettings(), _noop)
    return outcome, build_metadata(outcome, max_bytes)


def _noop() -> None:
    return None


def codes(outcome, severity: str | None = None) -> list[str]:
    return [
        f.code
        for f in outcome.report.findings()
        if severity is None or f.severity.value == severity
    ]


def mutated(change, clips=("Idle", "Walk")) -> bytes:
    document, binary = skinned_model(clips)
    document = copy.deepcopy(document)
    change(document)
    return glb(document, binary)


# --- clips ---------------------------------------------------------------------------------------


def test_no_clips_is_a_pass_with_a_warning() -> None:
    outcome, metadata = inspect(static_glb())
    assert metadata["document_read"] is True and metadata["clip_count"] == 0
    assert metadata["clips"] == [] and metadata["skins"] == []
    assert codes(outcome) == ["no_animations"]
    assert not outcome.report.has_errors


def test_one_clip_reports_exact_facts() -> None:
    outcome, metadata = inspect(skinned_glb(("Idle",)))
    assert not outcome.report.findings()
    (clip,) = metadata["clips"]
    assert clip == {
        "channel_count": 1,
        "channels_without_node": 0,
        "duration_seconds": 1.25,
        "duration_source": "accessor_bounds",
        "generic_name": False,
        "index": 0,
        "interpolations": ["LINEAR"],
        "invalid_channel_count": 0,
        "invalid_sampler_count": 0,
        "keyframe_count": 2,
        "max_sampler_keyframes": 2,
        "name": "Idle",
        "name_exact": True,
        "sampler_count": 1,
        "start_seconds": 0.0,
        "target_node_count": 1,
        "target_nodes": [{"index": 2, "name": "spine"}],
        "target_paths": ["translation"],
        "targets_outside_skins": 0,
    }
    assert metadata["counts"] == {
        "animations": 1,
        "channels": 1,
        "joints": 2,
        "keyframes": 2,
        "nodes": 3,
        "samplers": 1,
        "skins": 1,
    }
    assert metadata["skins"] == [
        {
            "hierarchy_depth": 2,
            "index": 0,
            "invalid_joint_count": 0,
            "joint_count": 2,
            "name": "Armature",
            "root_joint_count": 1,
            "root_joints": [{"index": 1, "name": "hips"}],
            "skeleton": None,
            "used_by_node_count": 1,
        }
    ]


def test_multiple_clips_keep_document_order_and_durations() -> None:
    _outcome, metadata = inspect(skinned_glb(("Idle", "Walk", "Run")))
    assert [(c["name"], c["duration_seconds"]) for c in metadata["clips"]] == [
        ("Idle", 1.25),
        ("Walk", 2.5),
        ("Run", 3.75),
    ]


def test_the_generic_mixamo_name_is_kept_verbatim_and_never_interpreted() -> None:
    outcome, metadata = inspect(skinned_glb((MIXAMO_CLIP,)))
    (clip,) = metadata["clips"]
    assert clip["name"] == "Armature|mixamo.com|Layer0" and clip["name_exact"] is True
    assert clip["generic_name"] is True
    assert metadata["generic_clip_count"] == 1
    assert codes(outcome) == ["generic_clip_name"]
    # No field anywhere names a runtime state or a movement.
    text = repr(metadata).lower()
    assert "idle" not in text and "walk" not in text


def test_duplicate_names_are_warnings_with_both_clips_listed() -> None:
    outcome, metadata = inspect(skinned_glb(("Walk", "Walk")))
    assert [c["name"] for c in metadata["clips"]] == ["Walk", "Walk"]
    assert codes(outcome) == ["duplicate_clip_name"]
    assert outcome.report.findings()[0].path == "animations[1]"
    assert "Walk" not in outcome.report.findings()[0].message  # never quotes the file


def test_missing_names_are_reported_as_none() -> None:
    def unname(document):
        del document["animations"][0]["name"]
        document["animations"][1]["name"] = "   "

    outcome, metadata = inspect(mutated(unname))
    assert [c["name"] for c in metadata["clips"]] == [None, None]
    assert [c["name_exact"] for c in metadata["clips"]] == [False, False]
    assert codes(outcome) == ["missing_clip_name", "missing_clip_name"]
    assert not outcome.report.has_errors


def test_control_characters_are_removed_and_flagged_not_exact() -> None:
    outcome, metadata = inspect(skinned_glb(("Wa‮lk",)))
    assert metadata["clips"][0]["name"] == "Walk"
    assert metadata["clips"][0]["name_exact"] is False
    assert codes(outcome) == ["clip_name_altered"]


# --- skins ---------------------------------------------------------------------------------------


def test_multiple_skins_and_targets_outside_any_skin() -> None:
    def two_skins(document):
        document["nodes"] += [
            {"name": "tail-root", "children": [4]},
            {"name": "tail-tip"},
            {"name": "prop"},
        ]
        document["scenes"][0]["nodes"] += [3, 5]
        document["skins"].append({"name": "Tail", "joints": [3, 4], "skeleton": 3})
        document["animations"][0]["channels"].append(
            {"sampler": 0, "target": {"node": 5, "path": "translation"}}
        )

    outcome, metadata = inspect(mutated(two_skins, ("Idle",)))
    assert [(s["name"], s["joint_count"], s["used_by_node_count"]) for s in metadata["skins"]] == [
        ("Armature", 2, 1),
        ("Tail", 2, 0),
    ]
    assert metadata["skins"][1]["skeleton"] == {"index": 3, "name": "tail-root"}
    assert metadata["skins"][1]["root_joints"] == [{"index": 3, "name": "tail-root"}]
    assert metadata["counts"]["joints"] == 4
    clip = metadata["clips"][0]
    assert clip["targets_outside_skins"] == 1 and clip["target_node_count"] == 2
    assert codes(outcome) == ["targets_outside_skins"]


def test_a_model_without_skins_does_not_warn_about_targets() -> None:
    def unskin(document):
        del document["skins"]
        del document["nodes"][0]["skin"]

    outcome, metadata = inspect(mutated(unskin, ("Idle",)))
    assert metadata["skins"] == [] and metadata["clips"][0]["targets_outside_skins"] == 0
    assert codes(outcome) == []


# --- malformed data -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("change", "code"),
    [
        (lambda d: d["animations"].__setitem__(0, "nope"), "invalid_animation"),
        (lambda d: d["animations"][0].__setitem__("samplers", []), "invalid_animation"),
        (
            lambda d: d["animations"][0]["samplers"][0].__setitem__("interpolation", "BEZIER"),
            "unsupported_interpolation",
        ),
        (
            lambda d: d["animations"][0]["channels"][0]["target"].__setitem__("node", 99),
            "invalid_node_reference",
        ),
        (
            lambda d: d["animations"][0]["channels"][0].__setitem__("sampler", 5),
            "invalid_sampler_reference",
        ),
        (
            lambda d: d["animations"][0]["samplers"][0].__setitem__("input", 999),
            "invalid_accessor_reference",
        ),
        (
            lambda d: d["animations"][0]["channels"][0]["target"].__setitem__("path", "color"),
            "unsupported_target_path",
        ),
        (lambda d: d["skins"][0].__setitem__("joints", [1, 77]), "invalid_node_reference"),
        (lambda d: d["skins"][0].__setitem__("skeleton", -1), "invalid_node_reference"),
    ],
)
def test_malformed_animation_data_is_an_error_finding(change, code) -> None:
    outcome, metadata = inspect(mutated(change, ("Idle",)))
    assert code in codes(outcome, "error")
    assert metadata["document_read"] is True
    findings = outcome.report.findings()
    assert all(f.path for f in findings if f.code == code)


def test_unsupported_interpolation_counts_the_sampler_as_invalid() -> None:
    outcome, metadata = inspect(
        mutated(lambda d: d["animations"][0]["samplers"][0].__setitem__("interpolation", 7))
    )
    assert metadata["clips"][0]["invalid_sampler_count"] == 1
    assert metadata["clips"][0]["duration_seconds"] is None
    assert "unsupported_interpolation" in codes(outcome, "error")


def test_keyframe_times_that_are_not_floats_are_refused() -> None:
    def ints(document):
        times = document["animations"][0]["samplers"][0]["input"]
        document["accessors"][times]["componentType"] = 5125

    outcome, _metadata = inspect(mutated(ints))
    assert "invalid_keyframe_times" in codes(outcome, "error")


def test_an_unreadable_file_is_a_fail_without_a_document() -> None:
    outcome, metadata = inspect(b"not a model at all")
    assert codes(outcome, "error") == ["not_a_model"]
    assert metadata["document_read"] is False and metadata["format"] is None
    assert metadata["clips"] == [] and metadata["counts"] is None


def test_invalid_json_is_a_fail() -> None:
    outcome, metadata = inspect(glb(b'{"asset": ', None))
    assert codes(outcome, "error") == ["invalid_json"]
    assert metadata["document_read"] is False


# --- durations without min/max ------------------------------------------------------------------


def test_duration_is_read_from_the_first_and_last_keyframe_when_bounds_are_missing() -> None:
    builder = Builder()
    times = builder.accessor("f", [0.5, 1.0, 4.25], 5126, "SCALAR")
    moves = builder.accessor("f", [0.0] * 9, 5126, "VEC3")
    document, binary = builder.finish(
        {
            "asset": {"version": "2.0"},
            "nodes": [{"name": "root"}],
            "animations": [
                {
                    "name": "Bob",
                    "samplers": [{"input": times, "output": moves}],
                    "channels": [{"sampler": 0, "target": {"node": 0, "path": "translation"}}],
                }
            ],
        }
    )
    outcome, metadata = inspect(glb(document, binary))
    clip = metadata["clips"][0]
    assert (clip["start_seconds"], clip["duration_seconds"]) == (0.5, 4.25)
    assert clip["duration_source"] == "keyframe_data" and clip["keyframe_count"] == 3
    assert not outcome.report.has_errors


def test_duration_unknown_when_bounds_are_missing_and_the_data_is_out_of_range() -> None:
    def no_bounds(document):
        times = document["animations"][0]["samplers"][0]["input"]
        accessor = document["accessors"][times]
        del accessor["min"], accessor["max"]
        accessor["count"] = 10_000  # past the end of its buffer view: never read

    outcome, metadata = inspect(mutated(no_bounds, ("Idle",)))
    assert metadata["clips"][0]["duration_seconds"] is None
    assert "duration_unknown" in codes(outcome, "warning")


# --- bounds ---------------------------------------------------------------------------------------


def test_too_many_clips_is_too_complex() -> None:
    settings = AnimationSettings.resolve({"max_animations": 2})
    outcome, metadata = inspect(skinned_glb(("A", "B", "C")), settings)
    assert codes(outcome, "error") == ["too_complex"]
    assert metadata["clips"] == []


def test_too_many_keyframes_is_too_complex() -> None:
    settings = AnimationSettings.resolve({"max_keyframes": 3})
    outcome, _metadata = inspect(skinned_glb(("A", "B")), settings)
    assert "too_complex" in codes(outcome, "error")


def test_requested_limits_are_clamped_to_the_ceilings() -> None:
    settings = AnimationSettings.resolve({"max_animations": 10**9})
    assert settings.limit("max_animations") == 2_000


def test_too_many_json_elements_is_too_complex_and_the_limit_cannot_be_raised() -> None:
    # The GLB validator's structural pre-scan runs before json.loads here too.
    assert AnimationSettings.resolve({"max_json_elements": 10**9}).limit(
        "max_json_elements"
    ) == AnimationSettings().limit("max_json_elements")
    settings = AnimationSettings.resolve({"max_json_elements": 5})
    outcome, metadata = inspect(skinned_glb(("A", "B")), settings)
    assert codes(outcome, "error") == ["too_complex"]
    assert metadata["clips"] == []


def test_metadata_is_fitted_under_the_budget_and_counts_stay_complete() -> None:
    clips = tuple(f"clip-{n:03d}-" + "x" * 150 for n in range(150))
    outcome, metadata = inspect(skinned_glb(clips), max_bytes=20_000)
    assert metadata["clip_count"] == 150 and metadata["counts"]["animations"] == 150
    assert metadata["lists_truncated"] is True
    assert len(metadata["clips"]) <= 100
    codes_noted = {w.code for w in outcome.report.warnings()}
    assert {"metadata_list_truncated", "metadata_truncated"} <= codes_noted


def test_listed_targets_are_capped_per_clip() -> None:
    def many_targets(document):
        document["nodes"] += [{"name": f"n{i}"} for i in range(40)]
        document["animations"][0]["channels"] = [
            {"sampler": 0, "target": {"node": 3 + i, "path": "translation"}} for i in range(40)
        ]

    _outcome, metadata = inspect(mutated(many_targets, ("Idle",)))
    clip = metadata["clips"][0]
    assert clip["target_node_count"] == 40 and len(clip["target_nodes"]) == 32


def test_the_inspector_honours_the_deadline_check() -> None:
    calls = {"n": 0}

    def check() -> None:
        calls["n"] += 1
        if calls["n"] > 3:
            raise ProcessingError(ErrorCode.PROCESSING_TIMEOUT)

    data = skinned_glb(tuple(f"c{n}" for n in range(20)))
    with pytest.raises(ProcessingError):
        inspect_glb(io.BytesIO(data), len(data), AnimationSettings(), check)


# --- through the engine ---------------------------------------------------------------------------


def make_request(data: bytes, limits: ResourceLimits | None = None) -> ProcessingJobRequest:
    request = ProcessingJobRequest(
        job_id=JOB_ID,
        job_type="asset.analyze_animation",
        namespace=NS,
        subject=SubjectRef("asset_version", VERSION_ID),
        asset=AssetContext("pip-model", VERSION_ID, 1),
        profile=ProfileRef("animation-default", 1),
        idempotency_key="ik1:" + "c" * 64,
        correlation_id="corr-anim-0001",
        attempt_id=ATTEMPT_ID,
        attempt_number=1,
        submitted_at=datetime(2026, 11, 17, 11, 0, tzinfo=UTC),
        input=InputObject(
            ref=ObjectRef(StoreName.QUARANTINE, KEY, None, NS),
            content_type="model/gltf-binary",
            size_bytes=len(data),
            sha256=hashlib.sha256(data).hexdigest(),
        ),
        options={},
        limits=limits or ANIMATION_PROFILE.limits,
    )
    return replace(request, idempotency_key=request_idempotency_key(request))


def run(tmp_path: Path, data: bytes, limits: ResourceLimits | None = None) -> Any:
    storage = MemoryObjectStorage()
    storage.seed(ObjectRef(StoreName.QUARANTINE, KEY, None, NS), data)
    engine = ExecutionEngine(
        registry=default_registry(),
        storage=storage,
        telemetry=RecordingTelemetry(),
        clock=ManualClock(),
        workspace_root=tmp_path,
        id_factory=lambda: "44444444-4444-4444-8444-444444444444",
    )
    result = engine.execute(make_request(data, limits))
    assert decode_result(encode(result)) == result
    return result, storage


def test_registered_with_its_profile_and_the_validator_is_unchanged() -> None:
    registry = default_registry()
    processor, profile = registry.resolve(
        "asset.analyze_animation", ProfileRef("animation-default", 1)
    )
    assert isinstance(processor, AnimationInspectorProcessor)
    assert (processor.processor_id, processor.version) == ("asset.animation_inspector", "1.0.0")
    assert profile.options == {} and profile.limits.max_input_bytes == 50 * 1024 * 1024
    # LAI-LAMBDA-009 must not bump the GLB validator (the publication gate keys on its version).
    validator, _ = registry.resolve("asset.validate_model", ProfileRef("glb-default", 1))
    assert isinstance(validator, GlbValidatorProcessor) and validator.version == "1.1.0"


def test_the_engine_runs_the_inspection_read_only(tmp_path: Path) -> None:
    result, storage = run(tmp_path, skinned_glb((MIXAMO_CLIP, "Idle")))
    assert result.status is ResultStatus.SUCCEEDED and result.verdict is Verdict.PASS
    assert result.artifacts == ()
    assert [c["name"] for c in result.metadata["clips"]] == [MIXAMO_CLIP, "Idle"]
    assert storage.keys(StoreName.ARTIFACTS) == []


def test_the_engine_refuses_an_oversized_input(tmp_path: Path) -> None:
    data = skinned_glb(("Idle",))
    small = replace(ANIMATION_PROFILE.limits, max_input_bytes=len(data) - 1)
    with pytest.raises(ProcessingError) as raised:
        make_request(data, small)  # refused while the request is built
    assert raised.value.code is ErrorCode.RESOURCE_LIMIT_EXCEEDED
