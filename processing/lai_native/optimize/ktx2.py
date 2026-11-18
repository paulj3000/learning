"""The KTX2 step: every PNG or JPEG texture becomes a Basis Universal KTX2 texture.

`optimize_ktx2(source, tools=..., workspace=..., prepare=...)` with profile `ktx2-basisu/v1`:

1. reads the GLB (it may already be Meshopt-compressed; Meshopt ranges are relocated intact);
2. classifies every texture by material usage: colour (base colour, emissive: ETC1S, sRGB) or
   data (normal, occlusion, metallic-roughness: UASTC + Zstandard, linear). An image used both
   ways, or a texture no core material slot uses, fails the job (`mixed_texture_usage`,
   `unclassified_texture`) rather than guessing a colour space;
3. prepares each image through Workstream D's `prepare_texture(data, profile)` (until D lands:
   `texture_prep.passthrough_texture`, which never resizes and refuses sides that are not
   multiples of 4) and encodes it with `toktx`;
4. rewrites the GLB: the image becomes `image/ktx2`, each texture moves its `source` into
   `extensions.KHR_texture_basisu.source` with no PNG/JPEG fallback, and the extension is added
   to `extensionsUsed` and `extensionsRequired`. Samplers, texture coordinates, transforms and
   material slots are untouched;
5. fails the job when any KTX2 file or the glTF side is invalid (`validate_basisu`, the same
   module the validators will call), when anything the game relies on changed (`signature`,
   textures rule `ktx2`), when the output exceeds `max_size_ratio` of the source, or when the
   calculated GPU texture memory does not go down.
"""

from __future__ import annotations

import copy
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, Final

from lai_processing.processors.gltf.compression.ktx2 import (
    BASISU_EXTENSION,
    KTX2_MIME,
    Ktx2Info,
    parse_ktx2,
    validate_basisu,
)
from lai_processing.processors.gltf.report import Report

from ..runtime import Deadline, NativeToolError, Workspace, run_tool
from .glbwrite import GlbLayoutError, read_glb, repack, write_glb
from .meshopt import (
    REPORT_SCHEMA,
    OptimizeError,
    OptimizeResult,
    ToolPaths,
    _sha256,
    _signature,
    run_step_tool,
)
from .profiles import KTX2_BASISU, OptimizeProfile, toktx_argv
from .signature import compare_signatures
from .texture_prep import PrepareTexture, TextureError, default_preparer
from .textures import texture_memory

__all__ = ["optimize_ktx2", "texture_classes"]

_REFUSED_SOURCE: Final = frozenset(
    {
        "KHR_texture_basisu",
        "KHR_draco_mesh_compression",
        "KHR_meshopt_compression",
        "EXT_texture_webp",
        "EXT_texture_avif",
    }
)
_COLOR_SLOTS: Final = (("pbrMetallicRoughness", "baseColorTexture"), (None, "emissiveTexture"))
_DATA_SLOTS: Final = (
    ("pbrMetallicRoughness", "metallicRoughnessTexture"),
    (None, "normalTexture"),
    (None, "occlusionTexture"),
)


def texture_classes(document: dict[str, Any]) -> dict[int, str]:
    """image index -> "color" or "data", from the core material slots. Raises OptimizeError for
    an image used both ways or a texture no core slot reaches."""
    textures = document.get("textures") or []
    usage: dict[int, set[str]] = {}
    for material in document.get("materials") or []:
        for slots, kind in ((_COLOR_SLOTS, "color"), (_DATA_SLOTS, "data")):
            for group, slot in slots:
                holder = material.get(group) or {} if group else material
                info = holder.get(slot)
                if isinstance(info, dict) and isinstance(info.get("index"), int):
                    usage.setdefault(info["index"], set()).add(kind)
    classes: dict[int, str] = {}
    for index, texture in enumerate(textures):
        source = texture.get("source")
        if not isinstance(source, int):
            continue
        kinds = usage.get(index)
        if not kinds:
            raise OptimizeError(
                "unclassified_texture",
                "A texture is not used by a base colour, emissive, normal, occlusion or "
                "metallic-roughness slot, so its colour space is unknown.",
                [{"code": "texture", "path": f"textures[{index}]"}],
            )
        merged = classes.get(source, None)
        kinds_all = kinds | ({merged} if merged else set())
        if len(kinds_all) > 1:
            raise OptimizeError(
                "mixed_texture_usage",
                "One image is used both as colour and as data.",
                [{"code": "image", "path": f"images[{source}]"}],
            )
        classes[source] = next(iter(kinds_all))
    return classes


def _image_bytes(document: dict[str, Any], binary: bytes, index: int) -> tuple[int, bytes]:
    image = document["images"][index]
    view_index = image.get("bufferView")
    if not isinstance(view_index, int):
        raise OptimizeError(
            "unsupported_image_source",
            "Only images stored in the GLB binary chunk can be converted.",
            [{"code": "image", "path": f"images[{index}]"}],
        )
    view = document["bufferViews"][view_index]
    if view.get("buffer", 0) != 0 or "extensions" in view:
        raise OptimizeError("unsupported_image_source", "An image is not in the binary chunk.")
    start = view.get("byteOffset", 0)
    return view_index, binary[start : start + view["byteLength"]]


def optimize_ktx2(
    source: bytes,
    *,
    tools: ToolPaths,
    workspace: Workspace,
    profile: OptimizeProfile = KTX2_BASISU,
    prepare: PrepareTexture | None = None,
    run: Callable[..., Any] = run_tool,
    deadline: Deadline | None = None,
    cancelled: Callable[[], bool] | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> OptimizeResult:
    started = clock()
    if profile.kind != "ktx2":
        raise OptimizeError("profile_mismatch", "This step runs KTX2 profiles only.")
    before = _signature(source, "source_unreadable")
    refused = sorted(set(before.extensions_used) & _REFUSED_SOURCE)
    if refused:
        raise OptimizeError(
            "source_already_compressed",
            "The source model already uses a texture or unsupported compression extension.",
            [{"code": "extension", "path": name} for name in refused],
        )
    spec = tools.toktx_spec()
    prepare = prepare or default_preparer()
    try:
        document, binary = read_glb(source)
    except (GlbLayoutError, ValueError):
        raise OptimizeError("source_unreadable", "The model could not be read.") from None
    classes = texture_classes(document)
    if not classes:
        raise OptimizeError("no_textures", "The model has no textures to convert.")
    replacements: dict[int, bytes] = {}
    encoded: list[dict[str, Any]] = []
    tool_seconds = 0.0
    peak_rss: int | None = None
    for image_index, kind in sorted(classes.items()):
        view_index, data = _image_bytes(document, binary, image_index)
        try:
            prepared = prepare(data, f"ktx2-{kind}")
        except TextureError as error:
            raise OptimizeError(
                error.code,
                "A texture cannot be encoded without resizing (image preparation).",
                [{"code": "image", "path": f"images[{image_index}]"}],
            ) from None
        suffix = "png" if prepared.mime_type == "image/png" else "jpg"
        source_name, output_name = f"texture-{image_index}.{suffix}", f"texture-{image_index}.ktx2"
        try:
            workspace.write(source_name, prepared.data)
        except NativeToolError as error:
            raise OptimizeError.from_native(error) from None
        argv = toktx_argv(profile, kind == "color", source_name, output_name)
        result, ktx = run_step_tool(
            run, spec, argv, workspace, profile, output_name, deadline, cancelled
        )
        tool_seconds += result.elapsed_seconds
        peak_rss = max(peak_rss or 0, result.peak_rss_kb)
        report = Report()
        info: Ktx2Info | None = parse_ktx2(ktx, report, f"images[{image_index}]")
        expected = "srgb" if kind == "color" else "linear"
        if info is None or info.color_space != expected:
            raise OptimizeError(
                "output_invalid",
                "toktx produced a texture the validators would refuse.",
                [{"code": c, "path": f"images[{image_index}]"} for c in report.codes()]
                or [{"code": "ktx2_color_space", "path": f"images[{image_index}]"}],
            )
        replacements[view_index] = ktx
        encoded.append(
            {
                "image": image_index,
                "class": kind,
                "source_mime_type": prepared.mime_type,
                "source_bytes": len(data),
                "argv": argv,
                "wall_seconds": round(result.elapsed_seconds, 4),
                "peak_rss_kib": result.peak_rss_kb,
                **info.as_metadata(),
            }
        )
    output_document = copy.deepcopy(document)
    for image_index in classes:
        image = output_document["images"][image_index]
        image["mimeType"] = KTX2_MIME
        image.pop("uri", None)
    for texture in output_document.get("textures") or []:
        source_index = texture.get("source")
        if isinstance(source_index, int) and source_index in classes:
            del texture["source"]
            texture.setdefault("extensions", {})[BASISU_EXTENSION] = {"source": source_index}
    for key in ("extensionsUsed", "extensionsRequired"):
        names = set(output_document.get(key) or [])
        names.add(BASISU_EXTENSION)
        output_document[key] = sorted(names)
    try:
        output_document, output_binary = repack(output_document, binary, replacements)
    except GlbLayoutError as error:
        raise OptimizeError(error.code, "The model's binary layout cannot be rewritten.") from None
    output = write_glb(output_document, output_binary)
    if len(output) > len(source) * profile.max_size_ratio:
        raise OptimizeError(
            "size_limit",
            "The KTX2 model is larger than the profile allows.",
            [{"code": "bytes", "path": f"{len(source)}->{len(output)}"}],
        )
    report = Report()
    images = {index: replacements[document["images"][index]["bufferView"]] for index in classes}
    facts = validate_basisu(output_document, report, read_image=images.get)
    if report.has_errors:
        raise OptimizeError(
            "output_invalid",
            "The KTX2 model is not valid.",
            [
                {"code": f.code, "path": f.path}
                for f in report.findings()
                if f.severity.value == "error"
            ],
        )
    after = _signature(output, "output_unreadable")
    differences = compare_signatures(before, after, textures="ktx2")
    if differences:
        raise OptimizeError(
            "preservation_failed",
            "The KTX2 model changed something the game relies on.",
            [{"code": d.code, "path": d.path} for d in differences],
        )
    before_gpu = texture_memory(before)["gpu_bytes_estimate"]
    after_gpu = facts.as_metadata()["gpu_bytes_estimate"]
    if not after_gpu < before_gpu:
        raise OptimizeError("no_gpu_gain", "KTX2 would not reduce texture memory.")
    report_body: dict[str, Any] = {
        "schema": REPORT_SCHEMA,
        "profile": profile.label,
        "tool": {
            "name": "toktx",
            "executable": Path(spec.path).name,
            "wall_seconds": round(tool_seconds, 4),
            "peak_rss_kib": peak_rss,
        },
        "source": {"bytes": len(source), "sha256": _sha256(source)},
        "output": {"bytes": len(output), "sha256": _sha256(output)},
        "size_ratio": round(len(output) / len(source), 4),
        "geometry": {"source": before.summary(), "output": after.summary()},
        "ktx2": facts.as_metadata(),
        "textures": {
            "encoded": encoded,
            "gpu_bytes_estimate_before": before_gpu,
            "gpu_bytes_estimate_after": after_gpu,
            "gpu_bytes_rgba8_fallback_after": facts.as_metadata()["gpu_bytes_rgba8_fallback"],
            "basis": "calculated",
        },
        "animation": {
            "clips": [
                {"name": c["name"], "duration_seconds": c["duration_seconds"]} for c in after.clips
            ],
            "compatible": True,
        },
        "preservation": {"differences": [], "textures": profile.textures},
        "processing_seconds": round(clock() - started, 4),
        "measurement": "measured on the machine that ran the job",
    }
    return OptimizeResult(output=output, report=report_body)
