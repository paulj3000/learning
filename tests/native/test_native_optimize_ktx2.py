"""KTX2 optimization step (`lai_native.optimize.ktx2`, ADR-070).

Unit tests use a fake toktx that writes a synthetic KTX2 file (`ktx2_builder`). The real-tool
tests run the pinned toktx only when `LAI_TOKTX` is set (`native/gltf/fetch-tools.sh`), on the
repository's own models, and cross-check every produced texture with KTX-Software's own
`ktx validate` when `LAI_KTX` is set.
"""

from __future__ import annotations

import copy
import dataclasses
import os
import subprocess
from pathlib import Path
from typing import Any

import pytest
from glb_builder import glb, png, static_model
from ktx2_builder import BASISLZ, LINEAR, SRGB, ZSTD, ktx2
from native_helpers import workspace_in
from test_native_optimize_meshopt import REAL_MODELS, compressed_grid

from lai_native.optimize import ToolPaths
from lai_native.optimize.glbwrite import GlbLayoutError, read_glb, repack, write_glb
from lai_native.optimize.ktx2 import optimize_ktx2, texture_classes
from lai_native.optimize.meshopt import OptimizeError, check_meshopt_output, optimize_meshopt
from lai_native.optimize.profiles import KTX2_BASISU, toktx_argv
from lai_native.optimize.texture_prep import TextureError, passthrough_texture
from lai_native.runtime import ToolResult
from lai_processing.processors.gltf.compression.ktx2 import validate_basisu
from lai_processing.processors.gltf.report import Report

TOKTX = Path(os.environ.get("LAI_TOKTX", "/nonexistent/toktx"))
KTX = Path(os.environ.get("LAI_KTX", "/nonexistent/ktx"))
GLTFPACK = Path(os.environ.get("LAI_GLTFPACK", "/nonexistent/gltfpack"))
LOOSE = dataclasses.replace(KTX2_BASISU, max_size_ratio=1000.0)
TOOLS = ToolPaths(toktx=Path("/opt/toktx"))


class FakeToktx:
    """Writes a synthetic KTX2 sized like the input image, sRGB ETC1S or linear UASTC."""

    def __init__(self, transfer_override: int | None = None, returncode: int = 0) -> None:
        self.calls: list[list[str]] = []
        self.transfer_override = transfer_override
        self.returncode = returncode

    def __call__(self, spec, argv, workspace, limits, **kwargs):  # type: ignore[no-untyped-def]
        self.calls.append(list(argv))
        if self.returncode == 0:
            color = "etc1s" in argv
            width, height = 64, 32
            transfer = self.transfer_override or (SRGB if color else LINEAR)
            data = ktx2(width, height, scheme=BASISLZ if color else ZSTD, transfer=transfer)
            (workspace.root / argv[-2]).write_bytes(data)
        return ToolResult(self.returncode, b"", b"toktx: error", False, 0.02, 2048)


def textured(slots: dict[str, int] | None = None) -> tuple[dict[str, Any], bytes]:
    document, binary = static_model(texture=png(64, 32))
    if slots is not None:
        material = document["materials"][0]
        material["pbrMetallicRoughness"] = {}
        for slot, index in slots.items():
            holder = (
                material["pbrMetallicRoughness"]
                if slot in ("baseColorTexture", "metallicRoughnessTexture")
                else material
            )
            holder[slot] = {"index": index}
    return document, binary


# --- profile, classification, preparation -----------------------------------------------------


def test_ktx2_profile_commands() -> None:
    color = toktx_argv(KTX2_BASISU, True, "in.png", "out.ktx2")
    data = toktx_argv(KTX2_BASISU, False, "in.png", "out.ktx2")
    assert color[-2:] == ["out.ktx2", "in.png"]
    assert color[color.index("--encode") + 1] == "etc1s"
    assert color[color.index("--assign_oetf") + 1] == "srgb"
    assert data[data.index("--encode") + 1] == "uastc"
    assert data[data.index("--assign_oetf") + 1] == "linear"
    assert "--zcmp" in data and "--genmipmap" in color and "--genmipmap" in data
    assert "--lower_left_maps_to_s0t0" not in color + data  # glTF is top-left: never flip
    assert KTX2_BASISU.label == "ktx2-basisu/v1"


def test_texture_classes() -> None:
    document, _ = textured({"baseColorTexture": 0})
    assert texture_classes(document) == {0: "color"}
    document, _ = textured({"normalTexture": 0})
    assert texture_classes(document) == {0: "data"}
    document, _ = textured({"baseColorTexture": 0, "occlusionTexture": 0})
    with pytest.raises(OptimizeError) as caught:
        texture_classes(document)
    assert caught.value.code == "mixed_texture_usage"
    document, _ = textured({})
    with pytest.raises(OptimizeError) as caught:
        texture_classes(document)
    assert caught.value.code == "unclassified_texture"


def test_passthrough_preparation_never_resizes() -> None:
    prepared = passthrough_texture(png(64, 32), "ktx2-source")
    assert (prepared.width, prepared.height, prepared.mime_type) == (64, 32, "image/png")
    for image, code in (
        (png(66, 32), "texture_needs_resize"),
        (b"GIF89a" + bytes(30), "texture_type"),
    ):
        with pytest.raises(TextureError) as caught:
            passthrough_texture(image, "ktx2-source")
        assert caught.value.code == code


# --- GLB rewriting ----------------------------------------------------------------------------


def test_repack_replaces_a_view_and_keeps_the_rest() -> None:
    document, binary = static_model(texture=png(64, 32))
    image_view = document["images"][0]["bufferView"]
    new_doc, new_bin = repack(copy.deepcopy(document), binary, {image_view: b"KTX!" * 10})
    view = new_doc["bufferViews"][image_view]
    assert new_bin[view["byteOffset"] : view["byteOffset"] + view["byteLength"]] == b"KTX!" * 10
    for index, old in enumerate(document["bufferViews"]):
        if index == image_view:
            continue
        new = new_doc["bufferViews"][index]
        assert (
            new_bin[new["byteOffset"] : new["byteOffset"] + new["byteLength"]]
            == binary[old["byteOffset"] : old["byteOffset"] + old["byteLength"]]
        )
        assert new["byteOffset"] % 4 == 0
    round_trip = read_glb(write_glb(new_doc, new_bin))
    assert round_trip[0]["bufferViews"] == new_doc["bufferViews"]


def test_repack_relocates_meshopt_ranges() -> None:
    _source, output = compressed_grid()
    document, binary = read_glb(output)
    new_doc, new_bin = repack(document, binary, {})
    _facts, errors = check_meshopt_output(write_glb(new_doc, new_bin))
    assert errors == []


def test_repack_refuses_overlapping_views() -> None:
    document, binary = static_model()
    document["bufferViews"][1]["byteOffset"] = 0
    with pytest.raises(GlbLayoutError):
        repack(document, binary, {})


# --- optimize_ktx2 with a fake toktx ----------------------------------------------------------


def test_success(tmp_path: Path) -> None:
    document, binary = textured({"baseColorTexture": 0})
    source = glb(document, binary)
    fake = FakeToktx()
    result = optimize_ktx2(
        source, tools=TOOLS, workspace=workspace_in(tmp_path), profile=LOOSE, run=fake
    )
    out_doc, out_bin = read_glb(result.output)
    assert out_doc["images"][0]["mimeType"] == "image/ktx2"
    texture = out_doc["textures"][0]
    assert "source" not in texture
    assert texture["extensions"]["KHR_texture_basisu"] == {"source": 0}
    assert texture["sampler"] == 0  # samplers untouched
    assert "KHR_texture_basisu" in out_doc["extensionsRequired"]
    report = result.report
    assert report["profile"] == "ktx2-basisu/v1"
    encoded = report["textures"]["encoded"][0]
    assert (encoded["class"], encoded["codec"], encoded["color_space"]) == (
        "color",
        "etc1s",
        "srgb",
    )
    assert (
        report["textures"]["gpu_bytes_estimate_after"]
        < report["textures"]["gpu_bytes_estimate_before"]
    )
    assert report["preservation"]["differences"] == []
    assert "etc1s" in fake.calls[0]
    view = out_doc["bufferViews"][out_doc["images"][0]["bufferView"]]
    images = {0: out_bin[view["byteOffset"] : view["byteOffset"] + view["byteLength"]]}
    validation = Report()
    validate_basisu(out_doc, validation, read_image=images.get)
    assert not validation.has_errors


def test_normal_maps_get_uastc_linear(tmp_path: Path) -> None:
    document, binary = textured({"normalTexture": 0})
    fake = FakeToktx()
    result = optimize_ktx2(
        glb(document, binary),
        tools=TOOLS,
        workspace=workspace_in(tmp_path),
        profile=LOOSE,
        run=fake,
    )
    assert "uastc" in fake.calls[0]
    assert result.report["textures"]["encoded"][0]["color_space"] == "linear"


def test_wrong_colour_space_from_the_tool_fails(tmp_path: Path) -> None:
    document, binary = textured({"baseColorTexture": 0})
    with pytest.raises(OptimizeError) as caught:
        optimize_ktx2(
            glb(document, binary),
            tools=TOOLS,
            workspace=workspace_in(tmp_path),
            profile=LOOSE,
            run=FakeToktx(transfer_override=LINEAR),
        )
    assert caught.value.code == "output_invalid"


def test_tool_failure_and_missing_tool(tmp_path: Path) -> None:
    document, binary = textured({"baseColorTexture": 0})
    with pytest.raises(OptimizeError) as caught:
        optimize_ktx2(
            glb(document, binary),
            tools=TOOLS,
            workspace=workspace_in(tmp_path),
            profile=LOOSE,
            run=FakeToktx(returncode=1),
        )
    assert caught.value.code == "tool_failed"
    with pytest.raises(OptimizeError) as caught:
        optimize_ktx2(
            glb(document, binary),
            tools=ToolPaths(),
            workspace=workspace_in(tmp_path),
            run=FakeToktx(),
        )
    assert caught.value.code == "tool_not_configured"


def test_size_limit(tmp_path: Path) -> None:
    document, binary = textured({"baseColorTexture": 0})
    with pytest.raises(OptimizeError) as caught:
        optimize_ktx2(
            glb(document, binary), tools=TOOLS, workspace=workspace_in(tmp_path), run=FakeToktx()
        )
    assert caught.value.code == "size_limit"


def test_texture_needing_resize_is_refused_before_encoding(tmp_path: Path) -> None:
    document, binary = static_model(texture=png(66, 30))
    fake = FakeToktx()
    with pytest.raises(OptimizeError) as caught:
        optimize_ktx2(
            glb(document, binary),
            tools=TOOLS,
            workspace=workspace_in(tmp_path),
            profile=LOOSE,
            run=fake,
        )
    assert caught.value.code == "texture_needs_resize"
    assert fake.calls == []


def test_injected_preparer_is_used(tmp_path: Path) -> None:
    document, binary = textured({"baseColorTexture": 0})
    seen: list[str] = []

    def prepare(data: bytes, profile: str):  # type: ignore[no-untyped-def]
        seen.append(profile)
        return passthrough_texture(data, profile)

    optimize_ktx2(
        glb(document, binary),
        tools=TOOLS,
        workspace=workspace_in(tmp_path),
        profile=LOOSE,
        run=FakeToktx(),
        prepare=prepare,
    )
    assert seen == ["ktx2-source"]


def test_refuses_sources_with_ktx2_or_no_textures(tmp_path: Path) -> None:
    document, binary = textured({"baseColorTexture": 0})
    first = optimize_ktx2(
        glb(document, binary),
        tools=TOOLS,
        workspace=workspace_in(tmp_path),
        profile=LOOSE,
        run=FakeToktx(),
    )
    with pytest.raises(OptimizeError) as caught:
        optimize_ktx2(
            first.output,
            tools=TOOLS,
            workspace=workspace_in(tmp_path),
            profile=LOOSE,
            run=FakeToktx(),
        )
    assert caught.value.code == "source_already_compressed"
    _source, meshopt_only = compressed_grid()
    with pytest.raises(OptimizeError) as caught:
        optimize_ktx2(
            meshopt_only,
            tools=TOOLS,
            workspace=workspace_in(tmp_path),
            profile=LOOSE,
            run=FakeToktx(),
        )
    assert caught.value.code == "no_textures"


# --- real toktx (and gltfpack for the chain), skipped unless configured ------------------------

TEXTURED = [p for p in REAL_MODELS]


def _tools() -> ToolPaths:
    return ToolPaths.from_environment()


@pytest.mark.skipif(not TOKTX.is_file(), reason="LAI_TOKTX is not set")
@pytest.mark.parametrize("path", [p for p in TEXTURED if "npc" not in p.name], ids=lambda p: p.name)
def test_real_toktx_on_repository_kit_models(tmp_path: Path, path: Path) -> None:
    source = path.read_bytes()
    result = optimize_ktx2(source, tools=_tools(), workspace=workspace_in(tmp_path))
    report = result.report
    assert report["preservation"]["differences"] == []
    assert (
        report["textures"]["gpu_bytes_estimate_after"] * 4
        <= report["textures"]["gpu_bytes_estimate_before"] * 1.01
    )
    if KTX.is_file():
        document, binary = read_glb(result.output)
        for image in document["images"]:
            view = document["bufferViews"][image["bufferView"]]
            texture = tmp_path / "check.ktx2"
            texture.write_bytes(
                binary[view["byteOffset"] : view["byteOffset"] + view["byteLength"]]
            )
            env = {**os.environ}
            checked = subprocess.run(
                [str(KTX), "validate", str(texture)], capture_output=True, env=env, check=False
            )
            assert checked.returncode == 0, checked.stdout + checked.stderr
    assert path.read_bytes() == source


@pytest.mark.skipif(
    not (TOKTX.is_file() and GLTFPACK.is_file()), reason="LAI_TOKTX and LAI_GLTFPACK not set"
)
def test_real_meshopt_then_ktx2_chain(tmp_path: Path) -> None:
    path = next(p for p in REAL_MODELS if p.name == "kenney-tree-large.glb")
    meshopt = optimize_meshopt(
        path.read_bytes(), tools=_tools(), workspace=workspace_in(tmp_path / "m")
    )
    chained = optimize_ktx2(meshopt.output, tools=_tools(), workspace=workspace_in(tmp_path / "k"))
    _facts, errors = check_meshopt_output(chained.output)
    assert errors == []
    assert "KHR_texture_basisu" in chained.report["geometry"]["output"]["extensions_required"]
    assert "EXT_meshopt_compression" in chained.report["geometry"]["output"]["extensions_required"]
