"""Declared artifact roles of the job types (ADR-066, DERIVED_ARTIFACTS.md section 3)."""

import pytest

from lai_processing.contracts import (
    ARTIFACT_ROLES,
    JOB_TYPES,
    STAFF_CAPTURE_ROLES,
    job_type_spec,
    role_spec,
)
from lai_processing.contracts.job_types import CONTENT_TYPE_EXTENSIONS, KIB, MIB

EXPECTED = {
    "asset.transcode_audio": {
        "audio.transcoded": (("audio/ogg", "audio/mpeg"), 20 * MIB, 2, True),
        "audio.report": (("application/json",), 64 * KIB, 1, False),
    },
    "asset.convert_image": {
        "image.converted": (("image/webp", "image/png", "image/jpeg"), 8 * MIB, 3, True),
        "image.resized": (("image/webp", "image/png", "image/jpeg"), 8 * MIB, 4, True),
        "image.thumbnail": (("image/webp", "image/png", "image/jpeg"), 512 * KIB, 3, False),
    },
    "asset.optimize": {
        "model.optimized": (("model/gltf-binary",), 32 * MIB, 1, True),
        "texture.compressed": (("image/ktx2",), 16 * MIB, 4, True),
        "model.optimize_report": (("application/json",), 64 * KIB, 1, False),
    },
}


@pytest.mark.parametrize("job_type", sorted(EXPECTED))
def test_each_workload_declares_exactly_its_roles(job_type):
    spec = job_type_spec(job_type)
    assert spec.requires_asset and spec.requires_input and spec.subject_type == "asset_version"
    declared = {
        r.role: (r.content_types, r.max_size_bytes, r.max_count, r.promotable)
        for r in spec.artifact_roles
    }
    assert declared == EXPECTED[job_type]


def test_other_job_types_declare_no_artifact_roles():
    for name, spec in JOB_TYPES.items():
        if name not in EXPECTED:
            assert spec.artifact_roles == ()


def test_staff_capture_role_is_not_a_job_role():
    (capture,) = STAFF_CAPTURE_ROLES
    assert (capture.role, capture.producer, capture.promotable) == (
        "model.thumbnail",
        "staff_capture",
        False,
    )
    assert capture.content_types == ("image/webp", "image/png")
    assert all(capture.role != r.role for s in JOB_TYPES.values() for r in s.artifact_roles)
    assert set(ARTIFACT_ROLES) == {r for e in EXPECTED.values() for r in e} | {"model.thumbnail"}


def test_unknown_roles_are_undeclared_and_every_content_type_has_an_extension_rule():
    assert role_spec("audio.surprise") is None and role_spec(None) is None
    assert job_type_spec("asset.optimize").role("audio.transcoded") is None
    assert CONTENT_TYPE_EXTENSIONS["image/ktx2"] == ("ktx2",)
    for spec in ARTIFACT_ROLES.values():
        assert all(t in CONTENT_TYPE_EXTENSIONS for t in spec.content_types)
        assert spec.extensions_for(spec.content_types[0])


def test_ktx2_passes_the_contract_content_type_pattern():
    from lai_processing.contracts.identifiers import CONTENT_TYPE

    assert CONTENT_TYPE.fullmatch("image/ktx2")
