"""LAI-LAMBDA-010 policy pin for the Django synchronous validator.

Pins that compressed glTF stays rejected (so unpublishable) until the owner approves it (W4-6),
and documents one known gap. See `tests/processing/test_processing_glb_compression_policy.py`
for the processor side and `docs/processing/feasibility/LAI-LAMBDA-010-glb-optimization.md`
section 4.6 for the change list that will flip these assertions.
"""

import base64

import pytest

from apps.assets import validation
from apps.assets.tests.helpers import glb_bytes, gltf_document
from apps.assets.tests.test_validation import check, codes

COMPRESSION = ("KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu")


def test_the_refused_set_is_exactly_the_three_compression_extensions():
    assert validation.NEEDS_DECODER == frozenset(COMPRESSION)
    assert not validation.NEEDS_DECODER & validation.SUPPORTED_EXTENSIONS


@pytest.mark.parametrize("name", COMPRESSION)
@pytest.mark.parametrize("where", ["extensionsUsed", "extensionsRequired"])
def test_each_compression_extension_fails_validation(name, where):
    document, binary = gltf_document(extra={where: [name]})
    result = check(glb_bytes(document, binary))
    assert not result.passed
    assert "needs_decoder" in codes(result)


def test_a_ktx2_image_is_refused():
    uri = (
        "data:image/ktx2;base64,"
        + base64.b64encode(b"\xabKTX 20\xbb\r\n\x1a\n" + bytes(64)).decode()
    )
    document, binary = gltf_document(extra={"images": [{"uri": uri}]})
    assert "image_type" in codes(check(glb_bytes(document, binary)))


@pytest.mark.parametrize(
    "name", ["KHR_meshopt_compression", "EXT_texture_webp", "EXT_mesh_gpu_instancing"]
)
def test_known_gap_other_decoder_extensions_pass_when_only_used(name):
    """KNOWN GAP, pinned on purpose (same as the processor test): used-only passes with a
    warning, required fails. Closing it is a W4-6 change in both validators together."""
    document, binary = gltf_document(extra={"extensionsUsed": [name]})
    result = check(glb_bytes(document, binary))
    assert result.passed and "unknown_extension" in codes(result)
    document, binary = gltf_document(extra={"extensionsUsed": [name], "extensionsRequired": [name]})
    assert not check(glb_bytes(document, binary)).passed
