"""Read-only, bounded inspection of a GLB's animation data (LAI-LAMBDA-009).

`inspect_glb(handle, size, settings, check)` reports facts about animation clips, their channels
and samplers, and the skins and joint hierarchy they drive. It reuses the GLB validator's
container reader (`gltf.container`), strict JSON parser (`gltf.jsonparse`), bounded findings
(`gltf.report`) and its glTF tables and predicates (`gltf.document`); it changes none of them, so
the validator's behaviour and processor version are untouched.

What it never does:
- decode a buffer: keyframe counts come from accessor `count`, clip durations from the sampler
  input accessor's `min`/`max`. Only when those bounds are missing does it read the first and
  last keyframe time (two 4-byte floats) from the GLB binary chunk, after a range check;
- fetch, resolve or open a URI;
- interpret a clip name. Names are reported exactly (after removing control and format
  characters for staff UI, flagged by `name_exact: false`); an exporter's default take name such
  as `Armature|mixamo.com|Layer0` is flagged `generic_name` and given no meaning.

Every loop calls `check()` (cancellation, deadline) and every array is counted against its limit
before it is walked. Messages are code-authored and never quote file content; paths are index
paths such as `animations[2]`.
"""

from __future__ import annotations

import math
import struct
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, BinaryIO, Final

from ..gltf.container import GlbLayout, read_at, read_layout
from ..gltf.document import (
    COMPLEXITY_CEILINGS,
    COMPLEXITY_DEFAULTS,
    FLOAT,
    GENERIC_TAKE_NAME,
    INTERPOLATIONS,
    TARGET_PATHS,
    _dict,
    _finite,
    _index,
    _whole,
)
from ..gltf.jsonparse import parse_document
from ..gltf.report import Report, Stop, clean_text

__all__ = [
    "ANIMATION_COMPLEXITY_CEILINGS",
    "ANIMATION_COMPLEXITY_DEFAULTS",
    "AnimationSettings",
    "InspectionOutcome",
    "inspect_glb",
]

Check = Callable[[], None]

# Defaults for `animation-default` v1: the GLB validator's values where it has the same counter.
ANIMATION_COMPLEXITY_DEFAULTS: Final[Mapping[str, int]] = {
    "max_accessors": COMPLEXITY_DEFAULTS["max_accessors"],
    "max_animation_samplers": COMPLEXITY_DEFAULTS["max_animation_samplers"],
    "max_animations": COMPLEXITY_DEFAULTS["max_animations"],
    "max_buffer_views": COMPLEXITY_DEFAULTS["max_buffer_views"],
    "max_buffers": COMPLEXITY_DEFAULTS["max_buffers"],
    "max_channels": COMPLEXITY_DEFAULTS["max_channels"],
    "max_joints": COMPLEXITY_DEFAULTS["max_joints"],
    "max_json_bytes": COMPLEXITY_DEFAULTS["max_json_bytes"],
    "max_json_depth": COMPLEXITY_DEFAULTS["max_json_depth"],
    "max_json_elements": COMPLEXITY_DEFAULTS["max_json_elements"],
    # Keyframes summed over every sampler (counted from accessors, never iterated).
    "max_keyframes": COMPLEXITY_DEFAULTS["max_accessor_count"],
    "max_node_depth": COMPLEXITY_DEFAULTS["max_node_depth"],
    "max_nodes": COMPLEXITY_DEFAULTS["max_nodes"],
    "max_skins": COMPLEXITY_DEFAULTS["max_skins"],
}
ANIMATION_COMPLEXITY_CEILINGS: Final[Mapping[str, int]] = {
    **{name: value * 10 for name, value in ANIMATION_COMPLEXITY_DEFAULTS.items()},
    "max_json_bytes": 64 * 1024 * 1024,
    "max_json_depth": 128,
    # Not raisable, as in the GLB validator: it keeps parsing inside the media function's memory.
    "max_json_elements": COMPLEXITY_CEILINGS["max_json_elements"],
    "max_node_depth": 256,
}

# Output bounds (the metadata object is also fitted under the job's max_metadata_bytes).
MAX_LISTED_CLIPS: Final = 100
MAX_LISTED_TARGETS: Final = 32
MAX_LISTED_SKINS: Final = 20
MAX_LISTED_ROOTS: Final = 16
MAX_NAME_CHARS: Final = 200
_CHECK_EVERY: Final = 1024
_ARRAYS: Final = (
    ("nodes", "max_nodes"),
    ("accessors", "max_accessors"),
    ("bufferViews", "max_buffer_views"),
    ("buffers", "max_buffers"),
    ("skins", "max_skins"),
    ("animations", "max_animations"),
)


@dataclass(frozen=True, slots=True)
class AnimationSettings:
    limits: Mapping[str, int] = field(default_factory=lambda: dict(ANIMATION_COMPLEXITY_DEFAULTS))

    @classmethod
    def resolve(cls, requested: Mapping[str, int]) -> AnimationSettings:
        """Requested complexity limits over the defaults, clamped to the ceilings."""
        return cls(
            {
                name: min(requested.get(name, default), ANIMATION_COMPLEXITY_CEILINGS[name])
                for name, default in ANIMATION_COMPLEXITY_DEFAULTS.items()
            }
        )

    def limit(self, name: str) -> int:
        return self.limits[name]


@dataclass
class InspectionOutcome:
    report: Report
    file_size: int
    layout: GlbLayout | None = None
    document_read: bool = False
    counts: dict[str, int] | None = None
    clips: list[dict[str, Any]] = field(default_factory=list)
    skins: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class _Accessor:
    component_type: object
    type: object
    count: int
    minimum: float | None
    maximum: float | None
    view: object
    offset: object
    sparse: bool


def _scalar(value: object) -> float | None:
    if isinstance(value, list) and len(value) == 1 and _finite(value[0]):
        return float(value[0])
    return None


def _round(value: float | None) -> float | None:
    if value is None:
        return None
    rounded = round(value, 6)
    return 0.0 if rounded == 0 else rounded


class _Inspector:
    def __init__(
        self,
        handle: BinaryIO,
        layout: GlbLayout,
        document: dict[str, Any],
        settings: AnimationSettings,
        report: Report,
        check: Check,
    ) -> None:
        self.handle = handle
        self.layout = layout
        self.doc = document
        self.settings = settings
        self.report = report
        self.check = check
        self.arrays: dict[str, list[Any]] = {}
        self.parents: list[int | None] = []
        self.hierarchy_known = True
        self.accessor_cache: dict[int, _Accessor | None] = {}
        self.joint_nodes: set[int] = set()
        self.keyframes = 0
        self.counts: dict[str, int] = {}

    # --- helpers --------------------------------------------------------------------------

    def items(self, name: str) -> list[Any]:
        return self.arrays.get(name, [])

    def node_ref(self, index: int) -> dict[str, Any]:
        node = _dict(self.items("nodes")[index])
        name, _truncated = clean_text(node.get("name") if node else None, MAX_NAME_CHARS)
        return {"index": index, "name": name}

    def _tick(self, counter: int) -> None:
        if counter % _CHECK_EVERY == 0:
            self.check()

    # --- entry point ----------------------------------------------------------------------

    def run(self, outcome: InspectionOutcome) -> None:
        asset = _dict(self.doc.get("asset"))
        if asset is None or asset.get("version") != "2.0":
            self.report.error(
                "gltf_version", 'Only glTF 2.0 models are supported ("asset.version": "2.0").'
            )
            raise Stop
        outcome.document_read = True
        self._arrays()
        self._hierarchy()
        outcome.skins = self._skins()
        outcome.clips = self._animations()
        self.counts.update(
            {
                "animations": len(self.items("animations")),
                "keyframes": self.keyframes,
                "nodes": len(self.items("nodes")),
                "skins": len(self.items("skins")),
            }
        )
        outcome.counts = dict(sorted(self.counts.items()))
        if not self.items("animations"):
            self.report.warn("no_animations", "The model has no animation clips.")

    def _arrays(self) -> None:
        for name, limit_name in _ARRAYS:
            self.check()
            value = self.doc.get(name, [])
            if not isinstance(value, list):
                self.report.error(
                    "invalid_structure", "A top-level glTF property is not an array.", name
                )
                value = []
            limit = self.settings.limit(limit_name)
            if len(value) > limit:
                self.report.error("too_complex", f"The model has more than {limit:,} {name}.", name)
                raise Stop
            self.arrays[name] = value

    # --- nodes ----------------------------------------------------------------------------

    def _hierarchy(self) -> None:
        """Parent of each node from `children`, bounded: total child entries may not exceed the
        node limit (each node has at most one parent in a valid file)."""
        nodes = self.items("nodes")
        self.parents = [None] * len(nodes)
        budget = self.settings.limit("max_nodes")
        seen = 0
        broken = False
        for index, raw in enumerate(nodes):
            self._tick(index)
            node = _dict(raw)
            children = node.get("children", []) if node else []
            if not isinstance(children, list):
                broken = True
                continue
            seen += len(children)
            if seen > budget:
                self.report.warn(
                    "hierarchy_not_measured",
                    "The node hierarchy has too many child entries to measure.",
                    "nodes",
                )
                self.hierarchy_known = False
                self.parents = [None] * len(nodes)
                return
            for child in children:
                if not _index(child, nodes):
                    self.report.error(
                        "invalid_node_reference",
                        "A node refers to a missing child node.",
                        f"nodes[{index}]",
                    )
                elif child == index or self.parents[child] is not None:
                    broken = True
                else:
                    self.parents[child] = index
        if broken:
            self.report.warn(
                "node_hierarchy_invalid",
                "The node hierarchy is malformed (a node with two parents, its own child, or "
                "children that are not a list); joint depths may be incomplete.",
                "nodes",
            )

    # --- skins ----------------------------------------------------------------------------

    def _skins(self) -> list[dict[str, Any]]:
        nodes = self.items("nodes")
        max_joints = self.settings.limit("max_joints")
        max_depth = self.settings.limit("max_node_depth")
        total = 0
        out: list[dict[str, Any]] = []
        users: dict[int, int] = {}
        for number, raw_node in enumerate(nodes):
            self._tick(number + 1)
            skin_index = raw_node.get("skin") if isinstance(raw_node, dict) else None
            if _whole(skin_index):
                users[skin_index] = users.get(skin_index, 0) + 1  # type: ignore[index]
        for index, raw in enumerate(self.items("skins")):
            self.check()
            path = f"skins[{index}]"
            skin = _dict(raw)
            joints = skin.get("joints") if skin else None
            if skin is None or not isinstance(joints, list) or not joints:
                self.report.error("invalid_skin", "A skin has no joints.", path)
                continue
            total += len(joints)
            if total > max_joints:
                self.report.error(
                    "too_complex", f"The model has more than {max_joints:,} joints.", "skins"
                )
                raise Stop
            members: list[int] = []
            member_set: set[int] = set()
            invalid = repeated = 0
            for number, joint in enumerate(joints):
                self._tick(number + 1)
                if not _index(joint, nodes):
                    invalid += 1
                elif joint in member_set:
                    repeated += 1
                else:
                    members.append(joint)
                    member_set.add(joint)
            if invalid:
                self.report.error(
                    "invalid_node_reference", "A skin's joints refer to missing nodes.", path
                )
            if repeated:
                self.report.warn("repeated_joint", "A skin lists the same joint twice.", path)
            self.joint_nodes |= member_set
            skeleton = None
            if "skeleton" in skin:
                if _index(skin["skeleton"], nodes):
                    skeleton = self.node_ref(skin["skeleton"])
                else:
                    self.report.error(
                        "invalid_node_reference",
                        "A skin's skeleton refers to a missing node.",
                        path,
                    )
            roots = [j for j in members if self.parents[j] not in member_set]
            depth = self._joint_depth(members, member_set, max_depth) if members else 0
            if depth is None:
                self.report.warn(
                    "hierarchy_too_deep", "A skin's joint hierarchy is too deep to measure.", path
                )
            name, _truncated = clean_text(skin.get("name"), MAX_NAME_CHARS)
            out.append(
                {
                    "index": index,
                    "name": name,
                    "joint_count": len(joints),
                    "invalid_joint_count": invalid,
                    "skeleton": skeleton,
                    "root_joint_count": len(roots),
                    "root_joints": [self.node_ref(j) for j in roots[:MAX_LISTED_ROOTS]],
                    "hierarchy_depth": depth if self.hierarchy_known else None,
                    "used_by_node_count": users.get(index, 0),
                }
            )
        self.counts["joints"] = total
        return out

    def _joint_depth(self, members: list[int], member_set: set[int], limit: int) -> int | None:
        """The longest joint-to-root chain inside one skin (1 for a single joint), walking parent
        links at most `limit` steps per joint; None when a chain is longer (or cycles)."""
        deepest = 0
        for number, joint in enumerate(members):
            self._tick(number + 1)
            depth, node = 1, self.parents[joint]
            while node is not None and node in member_set:
                depth += 1
                if depth > limit:
                    return None
                node = self.parents[node]
            deepest = max(deepest, depth)
        return deepest

    # --- accessors ------------------------------------------------------------------------

    def accessor(self, index: int) -> _Accessor | None:
        if index in self.accessor_cache:
            return self.accessor_cache[index]
        raw = _dict(self.items("accessors")[index])
        info = None
        count = raw.get("count") if raw else None
        if raw is not None and _whole(count) and count >= 1:  # type: ignore[operator]
            assert isinstance(count, int)  # noqa: S101 - narrowed above
            info = _Accessor(
                component_type=raw.get("componentType"),
                type=raw.get("type"),
                count=count,
                minimum=_scalar(raw.get("min")),
                maximum=_scalar(raw.get("max")),
                view=raw.get("bufferView"),
                offset=raw.get("byteOffset", 0),
                sparse="sparse" in raw,
            )
        self.accessor_cache[index] = info
        return info

    def _keyframe_ends(self, info: _Accessor) -> tuple[float, float] | None:
        """The first and last keyframe times read from the GLB binary chunk (8 bytes), or None
        when the accessor is not a plain float scalar inside buffer 0's chunk."""
        views = self.items("bufferViews")
        buffers = self.items("buffers")
        bin_offset, bin_length = self.layout.bin_offset, self.layout.bin_length
        if info.sparse or bin_offset is None or bin_length is None or not _index(info.view, views):
            return None
        view = _dict(views[info.view])  # type: ignore[index]
        first_buffer = _dict(buffers[0]) if buffers else None
        if view is None or view.get("buffer") != 0 or first_buffer is None:
            return None
        if "uri" in first_buffer:
            return None
        view_offset, view_length = view.get("byteOffset", 0), view.get("byteLength")
        stride = view.get("byteStride", 4)
        if not (_whole(view_offset) and _whole(view_length) and _whole(info.offset)):
            return None
        if not (type(stride) is int and 4 <= stride <= 252 and stride % 4 == 0):
            return None
        assert isinstance(view_offset, int) and isinstance(view_length, int)  # noqa: S101
        assert isinstance(info.offset, int)  # noqa: S101 - narrowed above
        last = info.offset + stride * (info.count - 1)
        if last + 4 > view_length or view_offset + view_length > bin_length:
            return None
        start = bin_offset + view_offset + info.offset
        head = read_at(self.handle, start, 4, self.layout.file_size)
        tail = read_at(self.handle, start + stride * (info.count - 1), 4, self.layout.file_size)
        if len(head) != 4 or len(tail) != 4:
            return None
        low, high = struct.unpack("<f", head)[0], struct.unpack("<f", tail)[0]
        if not (math.isfinite(low) and math.isfinite(high)):
            return None
        return low, high

    # --- animations -----------------------------------------------------------------------

    def _animations(self) -> list[dict[str, Any]]:
        clips: list[dict[str, Any]] = []
        names: set[str] = set()
        channels_total = samplers_total = 0
        max_channels = self.settings.limit("max_channels")
        max_samplers = self.settings.limit("max_animation_samplers")
        for index, raw in enumerate(self.items("animations")):
            self.check()
            path = f"animations[{index}]"
            animation = _dict(raw)
            if animation is None:
                self.report.error("invalid_animation", "An animation is malformed.", path)
                continue
            samplers = animation.get("samplers")
            channels = animation.get("channels")
            if not isinstance(samplers, list) or not samplers:
                self.report.error("invalid_animation", "An animation has no samplers.", path)
                samplers = []
            if not isinstance(channels, list) or not channels:
                self.report.error("invalid_animation", "An animation has no channels.", path)
                channels = []
            samplers_total += len(samplers)
            channels_total += len(channels)
            if channels_total > max_channels or samplers_total > max_samplers:
                self.report.error(
                    "too_complex", "The model has too many animation channels.", "animations"
                )
                raise Stop
            clip = self._name(animation.get("name"), names, index, path)
            clip.update(self._clip_data(samplers, channels, path))
            clips.append(clip)
        self.counts["channels"] = channels_total
        self.counts["samplers"] = samplers_total
        return clips

    def _name(self, raw: object, names: set[str], index: int, path: str) -> dict[str, Any]:
        entry: dict[str, Any] = {"index": index, "generic_name": False}
        if not isinstance(raw, str) or not raw.strip():
            self.report.warn(
                "missing_clip_name", "An animation has no name, so nothing can play it.", path
            )
            entry.update(name=None, name_exact=False)
            return entry
        name, _truncated = clean_text(raw, MAX_NAME_CHARS)
        entry.update(name=name, name_exact=name == raw)
        if name != raw:
            self.report.warn(
                "clip_name_altered",
                "An animation name has control characters or is too long, so the name shown "
                "is not exact.",
                path,
            )
        if raw in names:
            self.report.warn("duplicate_clip_name", "Two animations have the same name.", path)
        names.add(raw)
        if GENERIC_TAKE_NAME.search(raw):
            entry["generic_name"] = True
            self.report.warn(
                "generic_clip_name",
                "An animation has an exporter's default take name: it does not say what the "
                "motion is, and nothing here will guess.",
                path,
            )
        return entry

    def _sampler(self, raw: object, path: str) -> tuple[dict[str, Any] | None, bool]:
        """(facts of one sampler, or None when unusable; whether it is invalid)."""
        accessors = self.items("accessors")
        sampler = _dict(raw)
        if sampler is None:
            self.report.error("invalid_animation", "An animation sampler is malformed.", path)
            return None, True
        interpolation = sampler.get("interpolation", "LINEAR")
        if not (type(interpolation) is str and interpolation in INTERPOLATIONS):
            self.report.error(
                "unsupported_interpolation",
                "An animation sampler uses an interpolation other than LINEAR, STEP or "
                "CUBICSPLINE.",
                path,
            )
            return None, True
        source_index, output_index = sampler.get("input"), sampler.get("output")
        if not _index(source_index, accessors) or not _index(output_index, accessors):
            self.report.error(
                "invalid_accessor_reference",
                "An animation sampler refers to a missing accessor.",
                path,
            )
            return None, True
        source = self.accessor(source_index)  # type: ignore[arg-type]
        if source is None or self.accessor(output_index) is None:  # type: ignore[arg-type]
            self.report.error(
                "invalid_accessor_reference",
                "An animation sampler refers to a malformed accessor.",
                path,
            )
            return None, True
        if source.type != "SCALAR" or source.component_type != FLOAT:
            self.report.error(
                "invalid_keyframe_times",
                "An animation's keyframe times must be float scalars.",
                path,
            )
            return None, True
        self.keyframes += source.count
        if self.keyframes > self.settings.limit("max_keyframes"):
            self.report.error(
                "too_complex", "The model has too many animation keyframes.", "animations"
            )
            raise Stop
        facts: dict[str, Any] = {
            "interpolation": interpolation,
            "keyframes": source.count,
            "start": None,
            "end": None,
            "source": None,
        }
        if source.minimum is not None and source.maximum is not None:
            facts.update(start=source.minimum, end=source.maximum, source="accessor_bounds")
        else:
            ends = self._keyframe_ends(source)
            if ends is not None:
                facts.update(start=ends[0], end=ends[1], source="keyframe_data")
        if facts["start"] is not None and (facts["start"] < 0 or facts["end"] < facts["start"]):
            self.report.error(
                "invalid_keyframe_times",
                "An animation's keyframe times are negative or end before they start.",
                path,
            )
            facts.update(start=None, end=None, source=None)
        return facts, False

    def _clip_data(self, samplers: list[Any], channels: list[Any], path: str) -> dict[str, Any]:
        nodes = self.items("nodes")
        linked: list[dict[str, Any] | None] = []
        invalid_samplers = 0
        for number, raw in enumerate(samplers):
            self._tick(number + 1)
            facts, invalid = self._sampler(raw, path)
            invalid_samplers += invalid
            linked.append(facts)
        valid = [s for s in linked if s is not None]
        timed = [s for s in valid if s["start"] is not None]
        if valid and len(timed) < len(valid):
            self.report.warn(
                "duration_unknown",
                "Some keyframe times have no min/max and could not be read, so the clip's "
                "duration may be incomplete.",
                path,
            )
        targets: set[int] = set()
        paths: set[str] = set()
        interpolations: set[str] = set()
        invalid_channels = untargeted = outside = 0
        for number, raw in enumerate(channels):
            self._tick(number + 1)
            channel = _dict(raw)
            target = _dict(channel.get("target")) if channel else None
            sampler_index = channel.get("sampler") if channel else None
            target_path = target.get("path") if target else None
            if channel is None or target is None:
                self.report.error("invalid_animation", "An animation channel is malformed.", path)
                invalid_channels += 1
                continue
            if not _index(sampler_index, samplers):
                self.report.error(
                    "invalid_sampler_reference",
                    "An animation channel refers to a missing sampler.",
                    path,
                )
                invalid_channels += 1
                continue
            if not (type(target_path) is str and target_path in TARGET_PATHS):
                self.report.error(
                    "unsupported_target_path",
                    "An animation channel targets something other than translation, rotation, "
                    "scale or weights.",
                    path,
                )
                invalid_channels += 1
                continue
            if "node" not in target:
                untargeted += 1
            elif not _index(target["node"], nodes):
                self.report.error(
                    "invalid_node_reference",
                    "An animation channel targets a missing node.",
                    path,
                )
                invalid_channels += 1
                continue
            else:
                targets.add(target["node"])
                if self.joint_nodes and target["node"] not in self.joint_nodes:
                    outside += 1
            paths.add(target_path)
            facts = linked[sampler_index]  # type: ignore[index]
            if facts is not None:
                interpolations.add(facts["interpolation"])
        if untargeted:
            self.report.warn(
                "channel_without_node",
                "An animation channel has no target node; the game ignores it.",
                path,
            )
        if outside:
            self.report.warn(
                "targets_outside_skins",
                "An animation moves nodes that are not joints of any skin.",
                path,
            )
        sources = {s["source"] for s in timed}
        return {
            "channel_count": len(channels),
            "sampler_count": len(samplers),
            "invalid_channel_count": invalid_channels,
            "invalid_sampler_count": invalid_samplers,
            "keyframe_count": sum(s["keyframes"] for s in valid),
            "max_sampler_keyframes": max((s["keyframes"] for s in valid), default=0),
            "start_seconds": _round(min((s["start"] for s in timed), default=None)),
            "duration_seconds": _round(max((s["end"] for s in timed), default=None)),
            "duration_source": (
                None
                if not sources
                else "keyframe_data"
                if "keyframe_data" in sources
                else "accessor_bounds"
            ),
            "interpolations": sorted(interpolations),
            "target_paths": sorted(paths),
            "target_node_count": len(targets),
            "target_nodes": [self.node_ref(n) for n in sorted(targets)[:MAX_LISTED_TARGETS]],
            "targets_outside_skins": outside,
            "channels_without_node": untargeted,
        }


def inspect_glb(
    handle: BinaryIO, size: int, settings: AnimationSettings, check: Check
) -> InspectionOutcome:
    """Inspect the GLB in `handle` (`size` bytes). Never raises for a bad file; raises only what
    `check()` raises (cancellation, deadline)."""
    report = Report()
    outcome = InspectionOutcome(report=report, file_size=size)
    try:
        check()
        outcome.layout = read_layout(handle, size, report, settings.limit("max_json_bytes"))
        raw = read_at(handle, outcome.layout.json_offset, outcome.layout.json_length, size)
        check()
        document = parse_document(
            raw,
            report,
            settings.limit("max_json_depth"),
            settings.limit("max_json_elements"),
            check,
        )
        del raw
        _Inspector(handle, outcome.layout, document, settings, report, check).run(outcome)
    except Stop:
        pass
    return outcome
