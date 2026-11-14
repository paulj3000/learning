"""Import third-party environment model packs into the asset library (TR-PALM-03, TR-ENV-03).

A *pack* is a set of source files an administrator downloaded (GLBs, each holding one or several
models, loose or inside a ZIP), plus a declaration in code of which model in them becomes which
asset id, how it is re-posed and sized, and where it came from. The declaration is reviewed like
any code; the binaries never enter the repository. `import_pack` finds each declared model by its
node name, prepares it (`gltf_prep`), validates it with the service every upload uses, stores it
through the configured storage backend (`services.upload_version`), and, only where explicitly
allowed, publishes it.

Packs are grouped (`palms`, `barrels`, `logs`), so one command can import everything or one group
(`manage.py import_treasure_rush_environment --category logs`). The assets are ordinary asset
library assets for any region; Treasure Cove is the first to place them.

Idempotent: a model whose prepared bytes, or whose source checksum, node and preparation pipeline,
are already a non-rejected version of its asset is skipped. A definition that already exists keeps
every field an administrator may have edited; only missing definitions are created.

Publication rules (TR-PALM-04):

- `local` or `memory` storage, `DEBUG` on and the database on loopback: `publish=True` publishes
  the validated versions with `services.publish_version`.
- `s3` storage (a shared AWS environment): nothing is uploaded unless the operator passes
  `allow_shared_storage=True`, and nothing is ever published by this tool. Publishing there is an
  administrator's decision in Django Admin (docs/ASSET_LIBRARY.md section 19.2).
- A pack whose licence the owner has not confirmed (`licence_confirmed=False`) is imported and
  validated but never published, unless the operator passes `licence_confirmed=True` to record
  that the owner has now confirmed it (TR-ENV-04: no publication without established rights).
"""

import hashlib
import io
import json
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from django.conf import settings
from django.utils.text import slugify

from apps.catalog.models import AssetCategory, AssetOrigin, AssetStatus, ContentAsset

from . import gltf_prep, services
from .models import AssetVersion, VersionStatus
from .validation import validate_upload

PIPELINE_VERSION = 1
# The largest source file or archive member this reads into memory.
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MODEL_SUFFIXES = (".glb", ".gltf")
# Files a .gltf may pull in by name (TR-NAT: .gltf + .bin + shared textures, possibly in other ZIPs).
RESOURCE_SUFFIXES = (".bin", ".png", ".jpg", ".jpeg")
# Recognised but not convertible here: there is no conversion pipeline (ASSET_LIBRARY.md s. 4).
UNSUPPORTED_SUFFIXES = (".fbx", ".obj", ".blend", ".dae", ".3ds", ".stl", ".usdz")

QUATERNIUS_LICENCE_EVIDENCE = (
    "Quaternius publishes its models as CC0 (docs/ASSET_LICENCES.md records earlier Quaternius "
    "packs). The files carry no licence text."
)


@dataclass(frozen=True)
class PackModel:
    asset_id: str
    node: str
    display_name: str
    description: str
    source_url: str
    known_source_sha256: str
    # Preparation (gltf_prep.extract_model): the size to fit, as (axis, metres), and re-posing.
    fit: tuple[str, float]
    yaw_degrees: float = 0.0
    align_axis: tuple[float, float, float] | None = None
    roll_degrees: float = 0.0
    center_footprint: bool = False
    kind: str = ""  # defaults to the pack's
    category: str = ""
    tags: tuple[str, ...] = ()

    def prep_options(self) -> dict:
        return {
            "fit": self.fit,
            "yaw_degrees": self.yaw_degrees,
            "align_axis": self.align_axis,
            "roll_degrees": self.roll_degrees,
            "center_footprint": self.center_footprint,
        }


@dataclass(frozen=True)
class SkippedModel:
    source: str
    reason: str


@dataclass(frozen=True)
class ModelPack:
    pack_id: str
    group: str
    title: str
    author: str
    licence: str
    licence_url: str
    licence_evidence: str
    licence_confirmed: bool
    kind: str
    category: str
    tags: tuple[str, ...]
    models: tuple[PackModel, ...]
    not_imported: tuple[SkippedModel, ...] = ()
    max_texture_size: int = 512
    fixes: gltf_prep.MaterialFixes = gltf_prep.MaterialFixes()
    # Tag definitions with the author's name; off when the files name no author (TR-NAT).
    tag_author: bool = True

    def provenance(self, model: PackModel, source_sha256: str, *, confirmed: bool) -> dict:
        return {
            "pack": self.pack_id,
            "title": self.title,
            "author": self.author,
            "sourceUrl": model.source_url,
            "licence": self.licence,
            "licenceUrl": self.licence_url,
            "licenceEvidence": self.licence_evidence,
            "licenceStatus": "confirmed" if confirmed else "unconfirmed",
            "sourceSha256": source_sha256,
            "pipelineVersion": PIPELINE_VERSION,
        }


_FBX_PBR = gltf_prep.MaterialFixes(metallic=0.0, roughness=1.0)

QUATERNIUS_PALM_TREES = ModelPack(
    pack_id="quaternius-palm-trees",
    group="palms",
    title="Palm Trees",
    author="Quaternius",
    licence="CC0 1.0 Universal",
    licence_url="https://creativecommons.org/publicdomain/zero/1.0/",
    licence_evidence="Owner-provided download from poly.pizza, stated CC0 by the owner. "
    + QUATERNIUS_LICENCE_EVIDENCE,
    licence_confirmed=True,  # stated by the owner in the TR-PALM request (2026-11-14)
    kind="kit-piece",
    category=AssetCategory.SCENERY,
    tags=("nature", "vegetation", "trees", "tropical", "environment", "treasure-rush", "cc0"),
    models=tuple(
        PackModel(
            asset_id,
            node,
            display_name,
            description,
            source_url="https://poly.pizza/m/VYslw9DEi6",
            known_source_sha256="70275b7159f1790e2997113ce1373a6abc93dd609a2fa778e6edd5c0d4ba2904",
            fit=("y", height),
        )
        for asset_id, node, display_name, description, height in (
            (
                "nature-palm-tree-small",
                "PalmTree_5",
                "Palm tree, small",
                "A short, bushy palm (about 2.8 m). Quaternius Palm Trees, PalmTree_5.",
                2.8,
            ),
            (
                "nature-palm-tree-standard",
                "PalmTree_3",
                "Palm tree, standard",
                "A slender palm with a gentle bend (about 4.6 m). Quaternius Palm Trees, "
                "PalmTree_3.",
                4.6,
            ),
            (
                "nature-palm-tree-tall",
                "PalmTree_1",
                "Palm tree, tall",
                "A tall, thin palm with a wide crown (about 6.5 m). Quaternius Palm Trees, "
                "PalmTree_1.",
                6.5,
            ),
            (
                "nature-palm-tree-curved",
                "PalmTree_2",
                "Palm tree, curved",
                "A thick palm whose trunk sweeps to one side (about 5.3 m). Quaternius Palm "
                "Trees, PalmTree_2.",
                5.3,
            ),
        )
    ),
    not_imported=(
        SkippedModel(
            "PalmTree_4",
            "A short palm leaning low from the base; four shapes give enough variety, and every "
            "extra model is another download on a phone.",
        ),
    ),
    max_texture_size=512,
    fixes=gltf_prep.MaterialFixes(
        blend_to_mask=True,
        alpha_cutoff=0.5,
        double_sided_cutouts=True,
        metallic=0.0,
        roughness=1.0,
    ),
)

_UNCONFIRMED_EVIDENCE = (
    "Owner-provided poly.pizza downloads whose file names credit Quaternius. "
    + QUATERNIUS_LICENCE_EVIDENCE
    + " Not yet confirmed by the owner: the poly.pizza pages could not be reached to check."
)

QUATERNIUS_BARRELS = ModelPack(
    pack_id="quaternius-barrel",
    group="barrels",
    title="Barrel",
    author="Quaternius",
    licence="CC0 1.0 Universal (expected)",
    licence_url="https://creativecommons.org/publicdomain/zero/1.0/",
    licence_evidence=_UNCONFIRMED_EVIDENCE,
    licence_confirmed=False,
    kind="prop",
    category=AssetCategory.PROP,
    tags=("environment", "props", "wood", "pirate", "treasure-rush"),
    models=(
        PackModel(
            "prop-wooden-barrel",
            "Barrel",
            "Wooden barrel",
            "An upright banded wooden barrel, 1 m tall, origin at the middle of its base. "
            "Quaternius Barrel.",
            source_url="https://poly.pizza/m/zjCQP1TAci",
            known_source_sha256="acf56e7eb64e37ea4ab2a6b072dbbcfd315ba45a511bee141e5541421e2f2238",
            fit=("y", 1.0),
            center_footprint=True,
        ),
    ),
    not_imported=(
        SkippedModel(
            "Barrel.fbx",
            "The same barrel as Barrel.glb, in FBX, with no author recorded; the project has no "
            "FBX converter and the GLB needs none.",
        ),
    ),
    fixes=_FBX_PBR,
)

QUATERNIUS_LOGS = ModelPack(
    pack_id="quaternius-wood",
    group="logs",
    title="Wood Log, Wood Log with Moss, Wood",
    author="Quaternius",
    licence="CC0 1.0 Universal (expected)",
    licence_url="https://creativecommons.org/publicdomain/zero/1.0/",
    licence_evidence=_UNCONFIRMED_EVIDENCE,
    licence_confirmed=False,
    kind="kit-piece",
    category=AssetCategory.SCENERY,
    tags=("environment", "nature", "wood", "treasure-rush"),
    models=(
        PackModel(
            "nature-wood-log",
            "WoodLog",
            "Wood log",
            "A fallen log lying along X, 2.3 m long, resting on its origin. Quaternius Wood Log.",
            source_url="https://poly.pizza/m/L4E32Wee6C",
            known_source_sha256="7c3489a6d7f39025dc86278f17ba005a62466061067a385fec88a61f79d03844",
            fit=("x", 2.3),
            center_footprint=True,
        ),
        PackModel(
            "nature-wood-log-moss",
            "WoodLog_Moss",
            "Wood log with moss",
            "A fallen log with moss and mushrooms, lying along X, 2.6 m long. Quaternius Wood Log "
            "with Moss.",
            source_url="https://poly.pizza/m/nwsYvcI0bC",
            known_source_sha256="d148deb20a31a76b2afbc09b9f91af2433918f8ccbde2ecffce5783ad396e5b0",
            fit=("x", 2.6),
            yaw_degrees=90.0,
            center_footprint=True,
        ),
        PackModel(
            "prop-wood-pile",
            "UI_Wood",
            "Wood pile",
            "Three cut logs stacked two and one, lying along X, 1.4 m long. Quaternius Wood, "
            "re-posed from its icon angle.",
            source_url="https://poly.pizza/m/ajBNpMsQ8z",
            known_source_sha256="9ef528dc806a1ec65e4fc65f2cc581849b73cedfb82636bd1f6560d482c1f8d8",
            fit=("x", 1.4),
            # The source is posed for an inventory icon: its logs point up and away at an angle.
            align_axis=(0.679, -0.352, 0.644),
            roll_degrees=-19.0,
            center_footprint=True,
            kind="prop",
            category=AssetCategory.PROP,
            tags=("props", "pirate"),
        ),
    ),
    fixes=_FBX_PBR,
)

# --- ENV-2: natural vegetation (TR-NAT) ---------------------------------------------------------
# One owner-supplied stylised nature kit, delivered as three ZIPs: the .gltf files with their .bin
# buffers (MapleTree_5_2.zip) and two texture sets (png.zip, PalmTree_Leaves.zip). Only the
# bushes, flower clumps and grass suit a tropical island; the birch, maple and dead trees do not.
# The files name no author and carry no licence, so nothing here is published until the owner
# states both (licence_confirmed).

_NATURE_SOURCE = "Owner-supplied stylised nature kit: MapleTree_5_2.zip with png.zip (2026-11-14)"
_NATURE_EVIDENCE = (
    "The .gltf files (Blender glTF I/O 4.0.44) and textures carry no author, licence or readme. "
    "Author and licence are unknown until the owner states them."
)
_VEGETATION_FIXES = gltf_prep.MaterialFixes(
    blend_to_mask=True, alpha_cutoff=0.5, double_sided_cutouts=True, metallic=0.0, roughness=1.0
)


def _nature_pack(pack_id: str, group: str, title: str, tags: tuple, models) -> ModelPack:
    return ModelPack(
        pack_id=pack_id,
        group=group,
        title=title,
        author="Not stated in the supplied files",
        licence="Not stated in the supplied files",
        licence_url="",
        licence_evidence=_NATURE_EVIDENCE,
        licence_confirmed=False,
        kind="kit-piece",
        category=AssetCategory.SCENERY,
        tags=("nature", "environment", "vegetation", "tropical", "treasure-rush", *tags),
        models=tuple(
            PackModel(
                asset_id,
                node,
                display_name,
                description,
                source_url=_NATURE_SOURCE,
                known_source_sha256=digest,
                fit=("y", height),
                center_footprint=True,
            )
            for asset_id, node, display_name, description, height, digest in models
        ),
        # Small on screen: 256 px keeps the shared leaf, flower and grass sheets sharp enough
        # and every model under about 60 KB.
        max_texture_size=256,
        fixes=_VEGETATION_FIXES,
        tag_author=False,
    )


NATURE_BUSHES = _nature_pack(
    "nature-kit-bushes",
    "bushes",
    "Bushes",
    ("bushes",),
    (
        ("nature-bush-small", "Bush", "Bush, small", "A round leafy bush, 0.8 m tall.", 0.8,
         "1a1e2fc0a08ed1160f49cdf9227d1304a1344fc0b9ff8f3ada7df59d016634e9"),
        ("nature-bush-medium", "Bush_Flowers", "Bush, flowering", "A round bush with pink "
         "flowers, 1 m tall.", 1.0, "1ea57104dadd52c678b5eb097170adc964a1637ee16ff381d4c0d590eadbf7cf"),
        ("nature-bush-large", "Bush_Large_Flowers", "Bush, large flowering", "A long, tall "
         "flowering bush, 1.3 m tall, good for edging a clearing.", 1.3, "e9ddbe65ba2766829c0bf506e599870bfe13b12fff633484fca8942588a4e320"),
    ),
)
NATURE_FLOWERS = _nature_pack(
    "nature-kit-flowers",
    "flowers",
    "Flower clumps",
    ("flowers",),
    (
        ("nature-flower-tropical-yellow", "Flower_2_Clump", "Flowers, yellow", "A clump of "
         "yellow flowers, 0.55 m tall.", 0.55, "e15632d5e7bb83320c111223aba50a012d9f45c594bc2ae16c9dc42987f0e90d"),
        ("nature-flower-tropical-blue", "Flower_3_Clump", "Flowers, blue", "A clump of blue "
         "flowers, 0.55 m tall.", 0.55, "a551f245fce387decd368fe3017a583855517ef70ea67bfc7bab06b761239fe9"),
        ("nature-flower-tropical-pink", "Flower_4_Clump", "Flowers, pink", "A clump of large "
         "pink flowers, 0.6 m tall.", 0.6, "a6a0983a625ee0680408b91319ceca5bd0dfbca505729dafe11e34918eeab94b"),
        ("nature-flower-tropical-purple", "Flower_5_Clump", "Flowers, purple", "A clump of "
         "purple flowers, 0.55 m tall.", 0.55, "89e23f88bf6b9f00b9b75ff8dbfd0f29a5fbb642160bd4eb0dbd44f36733a2a4"),
    ),
)
NATURE_GRASS = _nature_pack(
    "nature-kit-grass",
    "grass",
    "Grass",
    ("grass",),
    (
        ("nature-grass-short", "Grass_Small", "Grass, short", "A low tuft of grass.", 0.35,
         "15a2407cf53220ca43d9adcf9bcf9d33b8a9ade47cbf3aac896e76718e1f95aa"),
        ("nature-grass-medium", "Grass_Large", "Grass, medium", "A tuft of grass, 0.5 m.", 0.5,
         "b85988199e3d3e3c325985642fadbe1ecfa7696c9deb7dbc6ac66bba8219faf7"),
        ("nature-grass-tall", "Grass_Large_Extruded", "Grass, tall", "A tall clump of grass "
         "blades, 0.9 m.", 0.9, "940069c9edbc6bab3f6789dde3bd0186a56f1ef9fa160f3cf18557641490ccd2"),
    ),
)

PACKS = {
    pack.pack_id: pack
    for pack in (
        QUATERNIUS_PALM_TREES,
        QUATERNIUS_BARRELS,
        QUATERNIUS_LOGS,
        NATURE_BUSHES,
        NATURE_FLOWERS,
        NATURE_GRASS,
    )
}
GROUPS = tuple(dict.fromkeys(pack.group for pack in PACKS.values()))
# Combined categories for the command.
GROUP_ALIASES = {"vegetation": ("bushes", "flowers", "grass")}
# Asked for in ENV-2 but in none of the supplied files: a clear refusal beats importing nothing.
ABSENT_GROUPS = {
    "rocks": "no rock models were supplied (only a Rocks.jpg texture)",
    "ferns": "no fern models were supplied",
    "coconuts": "no coconut models were supplied",
}
CATEGORIES = (*GROUPS, *GROUP_ALIASES, *ABSENT_GROUPS)


def packs_for(group: str | None) -> list[ModelPack]:
    if group is None or group == "all":
        return list(PACKS.values())
    if group in ABSENT_GROUPS:
        raise PackRefused(f"Nothing to import for {group!r}: {ABSENT_GROUPS[group]}.")
    if group in GROUP_ALIASES:
        return [pack for pack in PACKS.values() if pack.group in GROUP_ALIASES[group]]
    if group not in GROUPS:
        raise PackRefused(f"Unknown category {group!r}; choose one of: {', '.join(GROUPS)}.")
    return [pack for pack in PACKS.values() if pack.group == group]


class PackRefused(Exception):
    """The import cannot run as asked (wrong environment, unreadable source). Safe to show."""


@dataclass
class PackReport:
    pack: str
    dry_run: bool
    storage: str
    sources: list[dict] = field(default_factory=list)
    discovered: list[dict] = field(default_factory=list)
    imported: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    published: list[dict] = field(default_factory=list)
    unpublished: list[dict] = field(default_factory=list)
    unresolved: list[dict] = field(default_factory=list)
    created_definitions: list[str] = field(default_factory=list)
    ignored_files: list[dict] = field(default_factory=list)

    @property
    def source(self) -> dict:
        """The first source file found (palm imports have exactly one)."""
        return self.sources[0] if self.sources else {}

    def as_dict(self) -> dict:
        return {key: getattr(self, key) for key in self.__dataclass_fields__}


# --- environment ---------------------------------------------------------------------------------


def storage_backend() -> str:
    return str(getattr(settings, "LAI_ASSET_STORAGE", "local"))


def local_publication_problems() -> list[str]:
    """Why this environment may not publish from the command line; empty when it may."""
    problems = []
    if storage_backend() not in ("local", "memory"):
        problems.append(
            f"asset storage is {storage_backend()!r}: publish shared environments in Django Admin"
        )
    if not settings.DEBUG:
        problems.append("DEBUG is off: command-line publishing is for local development only")
    host = settings.DATABASES["default"].get("HOST", "")
    if host not in getattr(settings, "LOOPBACK_HOSTS", ("127.0.0.1", "localhost", "::1")):
        problems.append("the database is not on this machine: publishing is for local development")
    return problems


def check_environment(*, dry_run: bool, publish: bool, allow_shared_storage: bool) -> None:
    if publish:
        problems = local_publication_problems()
        if problems:
            raise PackRefused("Refusing to publish: " + "; ".join(problems) + ".")
    if storage_backend() == "s3" and not dry_run and not allow_shared_storage:
        raise PackRefused(
            "Asset storage is S3 (a shared environment). Run with --dry-run first, then again "
            "with --allow-shared-storage once uploading there is approved."
        )


# --- finding the sources -------------------------------------------------------------------------


@dataclass
class _File:
    """A file under the source, on disk or inside a ZIP, read only when needed."""

    label: str
    name: str
    size: int
    reader: object  # () -> bytes

    def read(self) -> bytes:
        data = self.reader()
        if len(data) > MAX_SOURCE_BYTES:
            raise gltf_prep.PrepError(f"{self.name!r} is too large.")
        return data


@dataclass
class _Source:
    """One model file (.glb, or .gltf with its sibling .bin and images), loaded on first use."""

    label: str
    model: _File
    resources: dict
    _loaded: tuple | None = None

    def load(self) -> tuple[dict, bytes, int, str, list[dict]]:
        """(document, binary, total bytes, digest, files) or PrepError."""
        if self._loaded is None:
            data = self.model.read()
            if self.model.name.lower().endswith(".glb"):
                document, binary = gltf_prep.read_glb(data)
                files = [{"file": self.model.name, "sizeBytes": len(data)}]
                digest = hashlib.sha256(data).hexdigest()
                total = len(data)
            else:
                used: dict[str, bytes] = {}

                def resolve(name: str):
                    entry = self.resources.get(name)
                    if entry is None:
                        return None
                    used[name] = used.get(name) or entry.read()
                    return used[name]

                document, binary = gltf_prep.read_gltf(data, resolve)
                # The digest covers the .gltf and every file it pulled in, in a fixed order.
                digest_input = hashlib.sha256(data)
                files = [{"file": self.model.name, "sizeBytes": len(data)}]
                for name in sorted(used):
                    digest_input.update(name.encode() + b"\0" + hashlib.sha256(used[name]).digest())
                    files.append({"file": name, "sizeBytes": len(used[name])})
                digest = digest_input.hexdigest()
                total = len(data) + sum(len(content) for content in used.values())
            self._loaded = (document, binary, total, digest, files)
        return self._loaded


def _files(source: Path, report: PackReport) -> list[_File]:
    """Every file under `source` (itself, a ZIP's members, a directory's files and ZIPs), sorted."""
    if not source.exists():
        raise PackRefused(f"The source {source.name!r} does not exist.")
    paths = sorted(p for p in source.rglob("*") if p.is_file()) if source.is_dir() else [source]
    found = []
    for path in paths:
        label = path.name if source.is_file() else str(path.relative_to(source))
        if path.suffix.lower() == ".zip":
            found += _zip_members(path, label, report)
        else:
            found.append(
                _File(label, path.name, path.stat().st_size, lambda path=path: path.read_bytes())
            )
    return found


def _zip_members(path: Path, label: str, report: PackReport) -> list[_File]:
    found = []
    try:
        with zipfile.ZipFile(path) as archive:
            for info in sorted(archive.infolist(), key=lambda i: i.filename):
                if info.is_dir():
                    continue

                # Read into memory only: nothing is extracted to disk, so no path traversal.
                def read(path=path, info=info) -> bytes:
                    with zipfile.ZipFile(path) as again:
                        return again.read(info)

                found.append(
                    _File(f"{label}:{info.filename}", Path(info.filename).name, info.file_size, read)
                )
    except (zipfile.BadZipFile, OSError):
        report.ignored_files.append({"file": label, "reason": "unreadable_archive"})
    return found


def _index_sources(source: Path, report: PackReport) -> dict[str, _Source]:
    """Node name to the first (sorted) model file that holds it; .gltf siblings found by name."""
    files = _files(source, report)
    resources: dict[str, _File] = {}
    for entry in files:
        if Path(entry.name).suffix.lower() in RESOURCE_SUFFIXES:
            resources.setdefault(entry.name, entry)
    by_node: dict[str, _Source] = {}
    for entry in files:
        suffix = Path(entry.name).suffix.lower()
        if suffix in RESOURCE_SUFFIXES:
            continue
        if suffix in UNSUPPORTED_SUFFIXES:
            report.ignored_files.append({"file": entry.label, "reason": "unsupported_format"})
            continue
        if suffix not in MODEL_SUFFIXES:
            if source.is_file():
                report.ignored_files.append({"file": entry.label, "reason": "not_a_model"})
            continue
        if entry.size > MAX_SOURCE_BYTES:
            report.ignored_files.append({"file": entry.label, "reason": "too_large"})
            continue
        try:
            names = _node_names_of(entry)
        except gltf_prep.PrepError:
            report.ignored_files.append({"file": entry.label, "reason": "not_a_model"})
            continue
        found = _Source(entry.label, entry, resources)
        for name in names:
            by_node.setdefault(name, found)
    return by_node


def _node_names_of(entry: _File) -> list[str]:
    """Node names without loading buffers or images (cheap for the many models never imported)."""
    data = entry.read()
    if entry.name.lower().endswith(".glb"):
        document, _binary = gltf_prep.read_glb(data)
    else:
        try:
            document = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise gltf_prep.PrepError("not JSON") from None
        if not isinstance(document, dict):
            raise gltf_prep.PrepError("not a glTF document")
    return gltf_prep.node_names(document)


def _describe(found: _Source, pack: ModelPack) -> dict:
    document, _binary, total, digest, files = found.load()
    known = {model.known_source_sha256 for model in pack.models}
    return {
        "file": found.label,
        "files": files,
        "sizeBytes": total,
        "sha256": digest,
        "matchesKnownDownload": digest in known,
        "generator": str(document.get("asset", {}).get("generator", "")),
        "nodes": gltf_prep.node_names(document),
        "cameras": len(document.get("cameras", [])),
        "lights": len(
            document.get("extensions", {}).get("KHR_lights_punctual", {}).get("lights", [])
        ),
        "animations": len(document.get("animations", [])),
    }


# --- the import ----------------------------------------------------------------------------------


def import_pack(
    pack: ModelPack,
    source: Path,
    *,
    dry_run: bool = False,
    publish: bool = False,
    allow_shared_storage: bool = False,
    licence_confirmed: bool = False,
    user=None,
) -> PackReport:
    check_environment(dry_run=dry_run, publish=publish, allow_shared_storage=allow_shared_storage)
    report = PackReport(pack=pack.pack_id, dry_run=dry_run, storage=storage_backend())
    by_node = _index_sources(Path(source), report)
    if not any(model.node in by_node for model in pack.models):
        raise PackRefused(
            f"No GLB under the source contains the {pack.title} models "
            f"({', '.join(sorted(model.node for model in pack.models))})."
        )
    confirmed = pack.licence_confirmed or licence_confirmed
    texture_cache: dict = {}
    described: set[str] = set()

    for skipped in pack.not_imported:
        report.discovered.append(
            {"node": skipped.source, "selected": False, "reason": skipped.reason}
        )

    for model in pack.models:
        entry = {"asset": model.asset_id, "node": model.node}
        found = by_node.get(model.node)
        if found is None:
            report.unresolved.append({**entry, "reason": "source_missing"})
            continue
        try:
            document, binary, source_size, source_sha256, _files_used = found.load()
            if found.label not in described:
                report.sources.append(_describe(found, pack))
                described.add(found.label)
            prepared = gltf_prep.extract_model(
                document,
                binary,
                model.node,
                max_texture_size=pack.max_texture_size,
                fixes=pack.fixes,
                asset_copyright=f"{pack.author}, {pack.licence}",
                texture_cache=texture_cache,
                **model.prep_options(),
            )
        except gltf_prep.PrepError as error:
            report.unresolved.append({**entry, "reason": "prep_failed", "detail": str(error)})
            continue
        stats = {
            "triangles": prepared.triangles,
            "vertices": prepared.vertices,
            "dimensions": prepared.dimensions,
            "sizeBytes": len(prepared.data),
            "sourceSizeBytes": source_size,
            "sha256": hashlib.sha256(prepared.data).hexdigest(),
            "sourceTriangles": _source_triangles(document, model.node),
        }
        report.discovered.append(
            {"node": model.node, "selected": True, "asset": model.asset_id, **stats}
        )
        provenance = pack.provenance(model, source_sha256, confirmed=confirmed)
        asset = _definition(pack, model, provenance, report, dry_run=dry_run)
        if asset is None:
            continue
        metadata = {
            "provenance": provenance,
            "preparation": {
                "sourceNode": model.node,
                "sourceFile": Path(found.label).name,
                "modifications": prepared.modifications,
                "textures": prepared.textures,
                "triangles": prepared.triangles,
                "vertices": prepared.vertices,
                "sourceTriangles": stats["sourceTriangles"],
                "sourceSizeBytes": source_size,
                "sourceFiles": _files_used,
            },
        }
        existing = _existing_version(asset, stats["sha256"], source_sha256, model.node)
        if existing is not None:
            report.skipped.append({**entry, "version": existing.number, "status": existing.status})
            version = existing
        else:
            stream = io.BytesIO(prepared.data)
            if dry_run:
                result = validate_upload(stream, size=len(prepared.data), definition=asset)
                if result.passed:
                    report.imported.append({**entry, **stats, "version": None})
                else:
                    codes = sorted({f.code for f in result.errors})
                    report.unresolved.append({**entry, "reason": "invalid_model", "codes": codes})
                continue
            try:
                version = services.upload_version(
                    asset,
                    stream,
                    original_filename=f"{model.asset_id}.glb",
                    user=user,
                    extra_metadata=metadata,
                    notes=f"Imported from {pack.author} {pack.title} ({model.node}), "
                    f"{pack.licence}, licence {provenance['licenceStatus']}; prepared by "
                    f"pipeline v{PIPELINE_VERSION}.",
                )
            except services.AssetActionRefused as refused:
                codes = sorted({f.code for f in refused.findings}) or [refused.code]
                report.unresolved.append({**entry, "reason": refused.code, "codes": codes})
                continue
            report.imported.append(
                {**entry, **stats, "version": version.number, "storageKey": version.storage_key}
            )
        if not publish or dry_run or version.status != VersionStatus.VALIDATED:
            continue
        if not confirmed:
            report.unpublished.append(
                {**entry, "version": version.number, "reason": "licence_unconfirmed"}
            )
            continue
        try:
            version = services.publish_version(version, user=user)
        except services.AssetActionRefused as refused:
            report.unresolved.append({**entry, "reason": f"publish_{refused.code}"})
            continue
        report.published.append({**entry, "version": version.number})
    return report


def _source_triangles(document: dict, node_name: str) -> int:
    node = next(n for n in document["nodes"] if n.get("name") == node_name)
    mesh = document["meshes"][node["mesh"]]
    triangles = 0
    for primitive in mesh.get("primitives", []):
        index = primitive.get("indices", primitive["attributes"]["POSITION"])
        triangles += int(document["accessors"][index]["count"]) // 3
    return triangles


def _definition(pack, model, provenance, report, *, dry_run) -> ContentAsset | None:
    kind = model.kind or pack.kind
    asset = ContentAsset.objects.filter(asset_id=model.asset_id).first()
    if asset is not None:
        if asset.status != AssetStatus.ACTIVE:
            report.unresolved.append(
                {"asset": model.asset_id, "node": model.node, "reason": "asset_retired"}
            )
            return None
        if asset.kind != kind:
            report.unresolved.append(
                {"asset": model.asset_id, "node": model.node, "reason": "asset_kind_conflict"}
            )
            return None
        return asset  # an existing definition keeps whatever an administrator set
    asset = ContentAsset(
        asset_id=model.asset_id,
        kind=kind,
        category=model.category or pack.category,
        origin=AssetOrigin.DJANGO,
        display_name=model.display_name,
        description=model.description,
        tags=list(
            dict.fromkeys(
                (*pack.tags, *model.tags, *((slugify(pack.author),) if pack.tag_author else ()))
            )
        ),
        source={"provenance": provenance, "sourceNode": model.node},
    )
    asset.full_clean()
    if not dry_run:
        asset.save()
    report.created_definitions.append(model.asset_id)
    return asset


def _existing_version(asset, sha256: str, source_sha256: str, node: str) -> AssetVersion | None:
    """A non-rejected version with these bytes, or made by this pipeline from this source."""
    if asset.pk is None:
        return None
    versions = asset.versions.exclude(status=VersionStatus.REJECTED).order_by("number")
    for version in versions:
        if version.sha256 == sha256:
            return version
        provenance = (version.metadata or {}).get("provenance", {})
        preparation = (version.metadata or {}).get("preparation", {})
        if (
            provenance.get("sourceSha256") == source_sha256
            and provenance.get("pipelineVersion") == PIPELINE_VERSION
            and preparation.get("sourceNode") == node
        ):
            return version
    return None
