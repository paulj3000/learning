"""LAI-LAMBDA-010 policy pin: compressed glTF output stays refused until it is approved.

These tests pin TODAY's behaviour of the shared GLB validator (the processor and Django must
agree, `test_processing_glb_parity.py`). They do not enable anything. When the owner approves a
compressed format (W4-6), the matching assertions here change in the same commit as the loader
and both validators (`docs/processing/feasibility/LAI-LAMBDA-010-glb-optimization.md`, 4.6 and 8).
"""

from __future__ import annotations

import pytest
from glb_builder import Document, data_uri, error_codes, mutated, validate, warning_codes
from test_processing_glb_document import change, setter

from lai_processing.processors.gltf import document as gltf_document

COMPRESSION = ("KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu")
KTX2_MAGIC = b"\xabKTX 20\xbb\r\n\x1a\n"


def test_the_refused_set_is_exactly_the_three_compression_extensions() -> None:
    assert frozenset(COMPRESSION) == gltf_document.NEEDS_DECODER
    assert not gltf_document.NEEDS_DECODER & gltf_document.SUPPORTED_EXTENSIONS


@pytest.mark.parametrize("name", COMPRESSION)
@pytest.mark.parametrize("where", ["extensionsUsed", "extensionsRequired"])
def test_each_compression_extension_is_a_failing_verdict(name: str, where: str) -> None:
    outcome = validate(mutated(setter(where, [name])))
    assert outcome.report.has_errors
    assert change(setter(where, [name])) == {"needs_decoder"}


def test_a_ktx2_image_is_refused_as_a_texture_type() -> None:
    def add_ktx2(document: Document) -> None:
        document["images"] = [{"uri": data_uri("image/ktx2", KTX2_MAGIC + b"\x00" * 64)}]
        document["textures"] = [
            {"extensions": {"KHR_texture_basisu": {"source": 0}}},
        ]
        document["extensionsUsed"] = ["KHR_texture_basisu"]

    codes = error_codes(mutated(add_ktx2))
    assert {"needs_decoder", "image_type"} <= codes


@pytest.mark.parametrize(
    "name", ["KHR_meshopt_compression", "EXT_texture_webp", "EXT_mesh_gpu_instancing"]
)
def test_other_decoder_extensions_are_refused_only_when_required(name: str) -> None:
    """KNOWN GAP, pinned on purpose.

    three 0.185.1 `GLTFLoader` implements these three (`GLTFLoader.js:243,647,651`), and
    `gltfpack -ce khr`, `-tw` and `-mi` emit them, yet neither validator lists them in
    `NEEDS_DECODER`. Declared in `extensionsUsed` only, a file passes with the warning
    `unknown_extension`; declared in `extensionsRequired`, it fails as `unsupported_extension`.
    A file that is genuinely compressed is normally marked required, but nothing here proves it.
    The decision in section 4.6 (add all three to `NEEDS_DECODER` in both validators together,
    bump the processor version) closes the gap; until then this test documents it.
    """
    used = mutated(setter("extensionsUsed", [name]))
    assert error_codes(used) == set()
    assert "unknown_extension" in warning_codes(used)
    assert change(setter("extensionsRequired", [name])) == {"unsupported_extension"}


def test_quantization_and_texture_transform_remain_loadable_without_a_decoder() -> None:
    """The output of `gltfpack` without `-c` or `-tc` uses only these two (benchmark section 6)."""
    for name in ("KHR_mesh_quantization", "KHR_texture_transform"):
        assert name in gltf_document.SUPPORTED_EXTENSIONS
        assert name not in gltf_document.NEEDS_DECODER
