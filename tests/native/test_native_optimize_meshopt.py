"""Meshopt optimization step (`lai_native.optimize`, ADR-070).

Unit tests use a fake tool runner that writes a prepared output, so they need no native binary.
The real-tool tests at the end run the pinned gltfpack only when `LAI_GLTFPACK` points at it
(`native/gltf/fetch-tools.sh`), and read the repository's own models; nothing is written to the
repository.
"""

from __future__ import annotations

import copy
import os
import struct
from pathlib import Path
from typing import Any

import pytest
from glb_builder import Builder, glb, skinned_model
from meshopt_builder import EXT, compress_views
from native_helpers import workspace_in

from lai_native.optimize import (
    MESHOPT_CONSERVATIVE,
    OptimizeError,
    ToolPaths,
    gltfpack_argv,
    optimize_meshopt,
)
from lai_native.optimize.meshopt import check_meshopt_output
from lai_native.optimize.signature import compare_signatures, model_signature
from lai_native.runtime import NativeToolError, ToolResult

REPO = Path(__file__).resolve().parents[2]
GLTFPACK = Path(os.environ.get("LAI_GLTFPACK", "/nonexistent/gltfpack"))


# --- fixtures ---------------------------------------------------------------------------------


def grid_model(vertices: int = 600) -> tuple[dict[str, Any], bytes, int]:
    """A named, animated mesh whose POSITION view is the last thing in the binary chunk."""
    builder = Builder()
    triangles = (vertices // 3) * 3
    indices = builder.accessor("H", list(range(triangles)), 5123, "SCALAR")
    times = builder.accessor("f", [0.0, 2.5], 5126, "SCALAR", min=[0.0], max=[2.5])
    moves = builder.accessor("f", [0, 0, 0, 0, 1, 0], 5126, "VEC3")
    positions = [float(i % 7) for i in range(vertices * 3)]
    position = builder.accessor("f", positions, 5126, "VEC3", min=[0, 0, 0], max=[6, 6, 6])
    document = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "grid", "mesh": 0, "translation": [1, 2, 3]}],
        "meshes": [
            {
                "primitives": [
                    {"attributes": {"POSITION": position}, "indices": indices, "material": 0}
                ]
            }
        ],
        "materials": [{"name": "Grid Mat", "doubleSided": True}],
        "animations": [
            {
                "name": "Bob",
                "samplers": [{"input": times, "output": moves}],
                "channels": [{"sampler": 0, "target": {"node": 0, "path": "translation"}}],
            }
        ],
    }
    document, binary = builder.finish(document)
    return document, binary, document["accessors"][position]["bufferView"]


def compressed_grid(change=None) -> tuple[bytes, bytes]:  # type: ignore[no-untyped-def]
    """(source GLB, a smaller meshopt output GLB with the same signature)."""
    document, binary, position_view = grid_model()
    cut = document["bufferViews"][position_view]["byteOffset"]
    out_doc, out_bin = compress_views(document, binary, [position_view])
    removed = len(binary) - cut
    out_bin = out_bin[:cut] + out_bin[len(binary) :]
    out_doc["bufferViews"][position_view]["extensions"][EXT]["byteOffset"] -= removed
    out_doc["buffers"][0]["byteLength"] = len(out_bin)
    if change:
        change(out_doc)
    return glb(document, binary), glb(out_doc, out_bin)


class FakeRun:
    def __init__(self, output: bytes | None, returncode: int = 0, stderr: bytes = b"") -> None:
        self.output = output
        self.returncode = returncode
        self.stderr = stderr
        self.calls: list[dict[str, Any]] = []

    def __call__(self, spec, argv, workspace, limits, **kwargs):  # type: ignore[no-untyped-def]
        self.calls.append(
            {"spec": spec, "argv": argv, "workspace": workspace, "limits": limits, **kwargs}
        )
        if self.output is not None:
            (workspace.root / "output.glb").write_bytes(self.output)
        return ToolResult(self.returncode, b"", self.stderr, False, 0.01, 1234)


TOOLS = ToolPaths(gltfpack=Path("/opt/gltfpack"))


# --- profile and command ----------------------------------------------------------------------


def test_conservative_profile_command() -> None:
    argv = gltfpack_argv(MESHOPT_CONSERVATIVE)
    assert argv[:4] == ["-i", "source.glb", "-o", "output.glb"]
    flags = argv[4:]
    assert flags[flags.index("-ce") + 1] == "ext"  # never KHR_meshopt_compression
    assert flags[flags.index("-si") + 1] == "1"  # no simplification
    assert flags[flags.index("-af") + 1] == "0"  # no resampling
    for flag in ("-cc", "-kn", "-km", "-ke", "-kv", "-ac", "-vpf", "-vtf"):
        assert flag in flags
    for texture_flag in ("-tc", "-tu", "-tw", "-tl", "-ts", "-tp", "-tq"):
        assert texture_flag not in flags
    for forbidden in ("-cz", "-cf", "-mi", "-mm", "-noq"):
        assert forbidden not in flags
    assert MESHOPT_CONSERVATIVE.label == "meshopt-conservative/v1"
    assert MESHOPT_CONSERVATIVE.textures == "identical"


def test_tool_paths_from_environment() -> None:
    tools = ToolPaths.from_environment({"LAI_GLTFPACK": "/x/gltfpack", "LAI_TOKTX": " "})
    assert tools.gltfpack == Path("/x/gltfpack")
    assert tools.toktx is None


# --- optimize_meshopt with a fake runner ------------------------------------------------------


def test_success_report(tmp_path: Path) -> None:
    source, output = compressed_grid()
    run = FakeRun(output)
    result = optimize_meshopt(source, tools=TOOLS, workspace=workspace_in(tmp_path), run=run)
    assert result.output == output
    report = result.report
    assert report["schema"] == "lai.optimize_report/1"
    assert report["profile"] == "meshopt-conservative/v1"
    assert report["source"]["bytes"] == len(source)
    assert report["output"]["bytes"] == len(output) < len(source)
    assert report["meshopt"]["compressed_view_count"] == 1
    assert report["meshopt"]["payload_decoded"] is False
    assert report["animation"] == {
        "clips": [{"name": "Bob", "duration_seconds": 2.5}],
        "compatible": True,
    }
    assert report["preservation"]["differences"] == []
    assert report["tool"]["argv"] == gltfpack_argv(MESHOPT_CONSERVATIVE)
    assert report["tool"]["executable"] == "gltfpack"
    assert report["geometry"]["output"]["triangle_count"] == 200
    call = run.calls[0]
    assert call["limits"] == MESHOPT_CONSERVATIVE.limits()
    assert call["limits"].timeout_seconds == MESHOPT_CONSERVATIVE.timeout_s
    assert call["spec"].name == "gltfpack" and call["spec"].path == "/opt/gltfpack"
    assert call["deadline"] is None
    assert (call["workspace"].root / "source.glb").read_bytes() == source


def test_no_size_gain(tmp_path: Path) -> None:
    source, _output = compressed_grid()
    with pytest.raises(OptimizeError) as caught:
        optimize_meshopt(
            source, tools=TOOLS, workspace=workspace_in(tmp_path), run=FakeRun(source + b"")
        )
    assert caught.value.code == "no_size_gain"


def test_tool_failure(tmp_path: Path) -> None:
    source, _output = compressed_grid()
    with pytest.raises(OptimizeError) as caught:
        optimize_meshopt(
            source,
            tools=TOOLS,
            workspace=workspace_in(tmp_path),
            run=FakeRun(None, 1, b"Error: bad input"),
        )
    assert caught.value.code == "tool_failed"
    assert caught.value.details[0]["path"].endswith("bad input")


def test_tool_not_configured(tmp_path: Path) -> None:
    source, _output = compressed_grid()
    with pytest.raises(OptimizeError) as caught:
        optimize_meshopt(
            source, tools=ToolPaths(), workspace=workspace_in(tmp_path), run=FakeRun(None)
        )
    assert caught.value.code == "tool_not_configured"


def test_runner_errors_become_optimize_errors(tmp_path: Path) -> None:
    source, _output = compressed_grid()

    def timeout(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise NativeToolError("timeout")

    with pytest.raises(OptimizeError) as caught:
        optimize_meshopt(source, tools=TOOLS, workspace=workspace_in(tmp_path), run=timeout)
    assert caught.value.code == "timeout"
    assert caught.value.retryable


def test_already_compressed_source_is_refused(tmp_path: Path) -> None:
    _source, output = compressed_grid()
    with pytest.raises(OptimizeError) as caught:
        optimize_meshopt(output, tools=TOOLS, workspace=workspace_in(tmp_path), run=FakeRun(None))
    assert caught.value.code == "source_already_compressed"


def test_unreadable_source(tmp_path: Path) -> None:
    with pytest.raises(OptimizeError) as caught:
        optimize_meshopt(
            b"not a glb", tools=TOOLS, workspace=workspace_in(tmp_path), run=FakeRun(None)
        )
    assert caught.value.code == "source_unreadable"


def test_invalid_meshopt_output_fails(tmp_path: Path) -> None:
    def break_stride(document: dict[str, Any]) -> None:
        for view in document["bufferViews"]:
            if "extensions" in view:
                view["extensions"][EXT]["byteStride"] = 6
                view["byteStride"] = 6

    source, output = compressed_grid(break_stride)
    with pytest.raises(OptimizeError) as caught:
        optimize_meshopt(source, tools=TOOLS, workspace=workspace_in(tmp_path), run=FakeRun(output))
    assert caught.value.code == "output_invalid"
    assert "meshopt_stride" in {d["code"] for d in caught.value.details}


@pytest.mark.parametrize(
    ("change", "code"),
    [
        (lambda d: d["nodes"][0].update(name="renamed"), "node_missing"),
        (lambda d: d["nodes"][0].update(translation=[1, 2, 4]), "node_transform_changed"),
        (lambda d: d["materials"][0].update(name="Other"), "materials_changed"),
        (lambda d: d["materials"][0].update(doubleSided=False), "material_double_sided_changed"),
        (lambda d: d["animations"][0].update(name="Hop"), "animation_names_changed"),
        (lambda d: d["accessors"][1].update(max=[3.0]), "animation_duration_changed"),
        (
            lambda d: d["animations"][0]["channels"][0]["target"].update(path="scale"),
            "animation_target_paths_changed",
        ),
        (lambda d: d["accessors"][0].update(count=597), "primitive_index_count_changed"),
    ],
)
def test_preservation_failures(tmp_path: Path, change, code: str) -> None:  # type: ignore[no-untyped-def]
    source, output = compressed_grid(change)
    with pytest.raises(OptimizeError) as caught:
        optimize_meshopt(source, tools=TOOLS, workspace=workspace_in(tmp_path), run=FakeRun(output))
    assert caught.value.code == "preservation_failed"
    assert code in {d["code"] for d in caught.value.details}


# --- signature comparison ---------------------------------------------------------------------


def _signature(document: dict[str, Any], binary: bytes):  # type: ignore[no-untyped-def]
    return model_signature(glb(document, binary))


def test_skinned_signature_and_skin_changes() -> None:
    document, binary = skinned_model()
    before = _signature(document, binary)
    assert compare_signatures(before, _signature(document, binary)) == []
    changed = copy.deepcopy(document)
    changed["skins"][0]["joints"] = [2, 1]
    codes = {d.code for d in compare_signatures(before, _signature(changed, binary))}
    assert "skin_joints_changed" in codes
    moved = copy.deepcopy(document)
    moved["nodes"].append({"mesh": 0, "skin": 0})
    moved["nodes"][0] = {"name": "body", "children": [3]}
    codes = {d.code for d in compare_signatures(before, _signature(moved, binary))}
    assert {"node_count_changed", "node_mesh_changed", "mesh_missing"} <= codes


def test_identity_texture_transform_counts_as_none() -> None:
    document, binary, _ = grid_model()
    document["materials"][0]["pbrMetallicRoughness"] = {"baseColorTexture": {"index": 0}}
    with_identity = copy.deepcopy(document)
    with_identity["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["extensions"] = {
        "KHR_texture_transform": {"texCoord": 0, "offset": [0, 0], "scale": [1, 1]}
    }
    scaled = copy.deepcopy(document)
    scaled["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["extensions"] = {
        "KHR_texture_transform": {"scale": [16, 16]}
    }
    # Textures are not part of this model; only the material slot description is compared.
    for doc in (document, with_identity, scaled):
        doc["textures"] = [{"source": 0}]
        doc["images"] = [{"uri": "data:image/png;base64,"}]
    before = _signature(document, binary)
    assert compare_signatures(before, _signature(with_identity, binary)) == []
    codes = {d.code for d in compare_signatures(before, _signature(scaled, binary))}
    assert codes == {"material_slots_changed"}


def test_vertex_welding_is_tolerated_but_splitting_is_not() -> None:
    document, binary, position_view = grid_model()
    before = _signature(document, binary)
    position = next(
        i for i, a in enumerate(document["accessors"]) if a["bufferView"] == position_view
    )
    welded = copy.deepcopy(document)
    welded["accessors"][position]["count"] = 590
    welded["bufferViews"][position_view]["byteLength"] = 590 * 12
    assert compare_signatures(before, _signature(welded, binary)) == []
    split = copy.deepcopy(document)
    split["accessors"][position]["count"] = 601
    split["bufferViews"][position_view]["byteLength"] = 601 * 12
    split["buffers"][0]["byteLength"] += 12
    codes = {d.code for d in compare_signatures(before, _signature(split, binary + bytes(12)))}
    assert "primitive_vertex_count_changed" in codes


def test_texture_rule_identical_compares_image_bytes() -> None:
    from glb_builder import png, static_model

    document, binary = static_model(texture=png(64, 32))
    before = _signature(document, binary)
    other_doc, other_bin = static_model(texture=png(32, 32))
    codes = {d.code for d in compare_signatures(before, _signature(other_doc, other_bin))}
    assert "images_changed" in codes
    assert before.images[0]["width"] == 64


def test_check_meshopt_output_on_a_valid_and_a_plain_glb() -> None:
    _source, output = compressed_grid()
    facts, errors = check_meshopt_output(output)
    assert errors == []
    assert facts["compressed_view_count"] == 1
    _facts, errors = check_meshopt_output(b"junk")
    assert errors


# --- real gltfpack (skipped unless LAI_GLTFPACK is set) ---------------------------------------

REAL_MODELS = sorted(
    [REPO / "content/models/npc-pip-pirate.glb", *(REPO / "react/public/models").glob("*.glb")]
)


@pytest.mark.skipif(not GLTFPACK.is_file(), reason="LAI_GLTFPACK is not set")
@pytest.mark.parametrize("path", REAL_MODELS, ids=lambda p: p.name)
def test_real_gltfpack_preserves_repository_models(tmp_path: Path, path: Path) -> None:
    source = path.read_bytes()
    result = optimize_meshopt(
        source, tools=ToolPaths(gltfpack=GLTFPACK), workspace=workspace_in(tmp_path)
    )
    report = result.report
    assert report["output"]["bytes"] < report["source"]["bytes"]
    assert report["preservation"]["differences"] == []
    assert "EXT_meshopt_compression" in report["geometry"]["output"]["extensions_required"]
    assert "KHR_meshopt_compression" not in report["geometry"]["output"]["extensions_used"]
    _facts, errors = check_meshopt_output(result.output)
    assert errors == []
    # The source on disk is never touched.
    assert path.read_bytes() == source
    assert struct.unpack_from("<I", result.output, 0)[0] == 0x46546C67
