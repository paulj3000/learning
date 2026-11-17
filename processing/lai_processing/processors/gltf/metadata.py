"""The GLB metadata object (`docs/processing/CONTRACTS.md`, "GLB validation metadata").

Deterministic: the same bytes and settings always give the same object (sorted keys when
encoded, lists in document order, integers for counts, floats rounded to 6 decimal places).
It holds no timestamps, paths, ids or staff-supplied file names. Strings copied from the file
(names, the generator) are cleaned and bounded by `clean_text`; animation clip names are
otherwise preserved exactly (e.g. Mixamo's `Armature|mixamo.com|Layer0`) and never classified.
`clip_vocabulary_matches` is exact string membership in the clip vocabulary, nothing fuzzier.

Lists are capped at `MAX_LISTED` entries and, if the encoded object still exceeds the job's
`max_metadata_bytes`, the per-item lists are emptied (`lists_truncated: true`), with a run
warning either way; counts always stay complete.
"""

from __future__ import annotations

from typing import Any, Final

from ...core.canonical import canonical_json
from .document import CLIP_VOCABULARY, DocumentFacts, ValidationOutcome
from .report import Report, clean_text

__all__ = ["MAX_LISTED", "METADATA_VERSION", "build_metadata"]

METADATA_VERSION: Final = 1
MAX_LISTED: Final = 100
_LIST_KEYS: Final = ("animations", "images", "material_names", "skins", "clip_vocabulary_matches")


def _round(value: float) -> float:
    rounded = round(value, 6)
    return 0.0 if rounded == 0 else rounded  # never "-0.0"


class _Cleaner:
    def __init__(self, report: Report) -> None:
        self.report = report

    def __call__(self, value: object) -> str | None:
        text, truncated = clean_text(value)
        if truncated:
            self.report.note(
                "metadata_text_truncated",
                "A name copied from the model was longer than 200 characters and was shortened.",
            )
        return text


def _cap(items: list[Any], report: Report) -> list[Any]:
    if len(items) > MAX_LISTED:
        report.note(
            "metadata_list_truncated",
            f"A metadata list was shortened to its first {MAX_LISTED} entries.",
        )
        return items[:MAX_LISTED]
    return items


def _document(facts: DocumentFacts, report: Report) -> dict[str, Any]:
    clean = _Cleaner(report)
    animations = [
        {
            "channel_count": a["channel_count"],
            "duration_seconds": a["duration_seconds"],
            "name": clean(a["name"]),
            "sampler_count": a["sampler_count"],
        }
        for a in facts.animations
    ]
    matches = sorted(
        {a["name"] for a in facts.animations if isinstance(a["name"], str)} & CLIP_VOCABULARY
    )
    bounds = None
    if facts.bounds_min is not None and facts.bounds_max is not None:
        bounds = {
            "max": [_round(v) for v in facts.bounds_max],
            "min": [_round(v) for v in facts.bounds_min],
        }
    return {
        "animations": _cap(animations, report),
        "bounds": bounds,
        "clip_vocabulary_matches": matches,
        "counts": dict(sorted(facts.counts.items())),
        "extensions_required": [clean(e) for e in facts.extensions_required],
        "extensions_used": [clean(e) for e in facts.extensions_used],
        "generator": clean(facts.generator),
        "gltf_version": facts.gltf_version,
        "images": _cap([dict(sorted(i.items())) for i in facts.images], report),
        "material_names": _cap([clean(n) for n in facts.material_names], report),
        "min_version": facts.min_version,
        "skins": _cap(
            [{"joint_count": s["joint_count"], "name": clean(s["name"])} for s in facts.skins],
            report,
        ),
        "triangle_count": facts.triangle_count,
        "unsupported_extensions": [clean(e) for e in facts.unsupported_extensions],
        "vertex_count": facts.vertex_count,
    }


def _empty_document() -> dict[str, Any]:
    return {
        "animations": [],
        "bounds": None,
        "clip_vocabulary_matches": [],
        "counts": None,
        "extensions_required": [],
        "extensions_used": [],
        "generator": None,
        "gltf_version": None,
        "images": [],
        "material_names": [],
        "min_version": None,
        "skins": [],
        "triangle_count": None,
        "unsupported_extensions": [],
        "vertex_count": None,
    }


def build_metadata(outcome: ValidationOutcome, max_bytes: int) -> dict[str, Any]:
    """The metadata object for `outcome`, fitted under `max_bytes` of canonical JSON."""
    report = outcome.report
    layout = outcome.layout
    metadata: dict[str, Any] = {
        "bin_chunk_bytes": layout.bin_length if layout else None,
        "document_read": outcome.facts is not None,
        "file_size_bytes": outcome.file_size,
        "format": "glb" if layout else None,
        "json_chunk_bytes": layout.json_length if layout else None,
        "lists_truncated": False,
        "metadata_version": METADATA_VERSION,
    }
    metadata.update(
        _document(outcome.facts, report) if outcome.facts is not None else _empty_document()
    )
    if len(canonical_json(metadata)) > max_bytes:
        for key in _LIST_KEYS:
            metadata[key] = []
        metadata["lists_truncated"] = True
        report.note(
            "metadata_truncated",
            "The model's per-item metadata lists did not fit in the result and were left out.",
        )
    return dict(sorted(metadata.items()))
