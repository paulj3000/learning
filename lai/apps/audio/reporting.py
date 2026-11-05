"""Sound library reporting (SM-P3): what is ready, what is missing, and exactly why.

Everything here is **read-only** and computed from the real tables on each call: no counters, no
caches, no writes, no publishing. The Django Admin report page and the `audio_library_report`
command are two views of the same functions.

A cue is READY for a game only when every dependency of runtime playback is present:

1. the sound cue exists and is enabled;
2. its audio asset exists, is audio, is active, and has a published version (the cue's pinned
   version, else the asset's default);
3. the cue is in the LIVE sound release (a working copy is not heard by anyone);
4. the live release still serves it in the game's manifest (a retired version is dropped there),
   by being shared, or by an assignment that reaches the game's 3D Area.

The existence of a `SoundCue` row proves none of that, so the report never treats it as ready.
"""

from dataclasses import dataclass, field

from django.core.exceptions import ValidationError

from apps.assets.models import VersionStatus
from apps.catalog.models import Adventure, AssetStatus, ContentAsset, Location, World
from apps.core.content_status import ContentStatus
from apps.regions.models import WorldRegion

from .manifest import build_manifest
from .models import ReleaseStatus, SoundAssignment, SoundCue, SoundRelease
from .services import live_release, version_for
from .treasure_rush_cues import TREASURE_RUSH_CUES, CueSpec
from .vocabulary import AUDIO_KIND, Scope

GLOBAL = (Scope.GLOBAL, None)
OK = "ok"
WARNING = "warning"
ERROR = "error"
SEVERITIES = (ERROR, WARNING)


# --- the games the report knows how to check ----------------------------------------------------


@dataclass(frozen=True)
class GameSpec:
    """A game's required sounds. `cues` is the contract with the game's React integration."""

    slug: str
    title: str
    #: The game's 3D Area (`WorldRegion.region_id`), whose manifest the game reads.
    region_id: str
    cues: tuple[CueSpec, ...]
    seed_command: str = ""

    @property
    def required(self) -> tuple[CueSpec, ...]:
        return tuple(spec for spec in self.cues if spec.wired)

    @property
    def optional(self) -> tuple[CueSpec, ...]:
        return tuple(spec for spec in self.cues if not spec.wired)


GAMES: dict[str, GameSpec] = {
    "treasure-rush": GameSpec(
        slug="treasure-rush",
        title="Treasure Rush",
        region_id="treasure-rush-cove",
        cues=TREASURE_RUSH_CUES,
        seed_command="python manage.py seed_treasure_rush_sound",
    ),
}


# --- rows ---------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Inventory:
    audio_assets: int
    published_assets: int
    draft_assets: int
    retired_assets: int
    cues: int
    enabled_cues: int
    cues_in_live_release: int
    unassigned_cues: int
    cues_with_blocked_audio: int
    releases: int
    live_release_number: int | None
    last_published_at: object | None


@dataclass(frozen=True)
class CueCheck:
    """One required cue of a game and every link in its chain."""

    cue_id: str
    purpose: str
    channel: str
    asset_id: str
    cue_status: str
    asset_status: str
    assignment_status: str
    release_status: str
    manifest_status: str
    ready: bool
    problems: tuple[str, ...] = ()
    remediation: tuple[str, ...] = ()


@dataclass(frozen=True)
class GameCoverage:
    game: GameSpec
    area_found: bool
    checks: tuple[CueCheck, ...]
    optional: tuple[CueCheck, ...]

    @property
    def ready_count(self) -> int:
        return sum(1 for check in self.checks if check.ready)

    @property
    def ready(self) -> bool:
        return self.area_found and all(check.ready for check in self.checks)


@dataclass(frozen=True)
class ScopeCoverage:
    kind: str
    key: str
    label: str
    assignments: int
    manifest_sounds: int
    problems: int


@dataclass(frozen=True)
class Issue:
    severity: str
    code: str
    subject: str
    message: str
    remediation: str


@dataclass
class Diagnostics:
    issues: list[Issue] = field(default_factory=list)

    def add(self, severity, code, subject, message, remediation) -> None:
        self.issues.append(Issue(severity, code, subject, message, remediation))

    @property
    def errors(self) -> list[Issue]:
        return [issue for issue in self.issues if issue.severity == ERROR]


# --- inventory ----------------------------------------------------------------------------------


def _audio_assets():
    return ContentAsset.objects.filter(kind=AUDIO_KIND).select_related("default_version")


def _asset_state(cue: SoundCue) -> tuple[str, str | None]:
    """('published'|'unpublished'|'retired'|'not-audio', why-not) for the audio a cue would play."""
    asset = cue.asset
    if asset.kind != AUDIO_KIND:
        return "not-audio", f"'{asset.asset_id}' is not an audio asset"
    if asset.status == AssetStatus.RETIRED:
        return "retired", f"the asset '{asset.asset_id}' is retired"
    version = version_for(cue)
    if version is None:
        return "unpublished", f"the asset '{asset.asset_id}' has no published default version"
    if version.status != VersionStatus.PUBLISHED:
        return (
            "unpublished",
            f"version {version.number} of '{asset.asset_id}' is "
            f"{version.get_status_display().lower()}, not published",
        )
    return "published", None


def _live_cue_ids() -> set[str]:
    release = live_release()
    return {cue["id"] for cue in release.snapshot["cues"]} if release else set()


def _cues():
    return list(
        SoundCue.objects.select_related("asset", "asset__default_version", "pinned_version")
    )


def _used_cue_ids() -> set[int]:
    """Cues that something can play: shared, or with an enabled assignment."""
    assigned = set(
        SoundAssignment.objects.filter(enabled=True).values_list("cue_id", flat=True).distinct()
    )
    return assigned | set(SoundCue.objects.filter(shared=True).values_list("pk", flat=True))


def inventory() -> Inventory:
    assets = list(_audio_assets())
    retired = [a for a in assets if a.status == AssetStatus.RETIRED]
    published = [
        a
        for a in assets
        if a.status == AssetStatus.ACTIVE
        and a.default_version is not None
        and a.default_version.status == VersionStatus.PUBLISHED
    ]
    cues = _cues()
    live = _live_cue_ids()
    used = _used_cue_ids()
    latest = SoundRelease.objects.filter(status=ReleaseStatus.LIVE).first()
    last = SoundRelease.objects.order_by("-number").first()
    return Inventory(
        audio_assets=len(assets),
        published_assets=len(published),
        draft_assets=len(assets) - len(published) - len(retired),
        retired_assets=len(retired),
        cues=len(cues),
        enabled_cues=sum(1 for c in cues if c.enabled),
        cues_in_live_release=sum(1 for c in cues if c.cue_id in live),
        unassigned_cues=sum(1 for c in cues if c.enabled and c.pk not in used),
        cues_with_blocked_audio=sum(1 for c in cues if _asset_state(c)[0] != "published"),
        releases=SoundRelease.objects.count(),
        live_release_number=latest.number if latest else None,
        last_published_at=last.published_at if last else None,
    )


# --- game coverage ------------------------------------------------------------------------------


def _chain_for_region(region: WorldRegion) -> list[tuple[str, str | None]]:
    place = region.location
    return [
        GLOBAL,
        (Scope.ISLAND, place.world.slug),
        (Scope.PLACE, place.slug),
        (Scope.AREA, region.region_id),
    ]


def _manifest_ids(region: WorldRegion | None) -> set[str] | None:
    if region is None:
        return None
    manifest = build_manifest("region", region.region_id, _chain_for_region(region))
    return {sound["id"] for sound in manifest["sounds"]}


def _check(
    spec: CueSpec,
    cues: dict[str, SoundCue],
    live: set[str],
    in_manifest: set[str] | None,
    seed_command: str,
) -> CueCheck:
    problems: list[str] = []
    fixes: list[str] = []
    cue = cues.get(spec.cue_id)
    cue_status = asset_status = assignment_status = release_status = manifest_status = "n/a"

    if cue is None:
        cue_status = "missing"
        problems.append("There is no sound cue with this id.")
        fixes.append(
            f"Upload an audio asset with id '{spec.asset_id}' in the Asset library and publish it, "
            f"then run '{seed_command}' (or add the cue in Sound library, Sound cues)."
            if seed_command
            else "Add the cue in Sound library, Sound cues."
        )
        asset_state = None
    else:
        cue_status = "enabled" if cue.enabled else "disabled"
        if not cue.enabled:
            problems.append("The cue is disabled.")
            fixes.append("Enable the cue in Sound library, Sound cues.")
        asset_state, why = _asset_state(cue)
        asset_status = asset_state
        if why:
            problems.append(f"Audio: {why}.")
            fixes.append(
                {
                    "unpublished": f"Validate and publish a version of '{cue.asset.asset_id}' "
                    "in the Asset library.",
                    "retired": f"Reactivate '{cue.asset.asset_id}' or choose another asset.",
                    "not-audio": "Choose an audio asset for the cue.",
                }.get(asset_state, "Fix the cue's audio asset.")
            )
        if cue.shared:
            assignment_status = "shared (in every manifest)"
        else:
            n = cue.assignments.filter(enabled=True).count()
            assignment_status = f"{n} assignment(s)" if n else "none"
            if not n:
                problems.append("The cue is not shared and nothing is assigned to it.")
                fixes.append(
                    "Mark the cue Shared (the game plays it by id) or assign it to the game's "
                    "3D Area."
                )
        if cue.enabled:
            if cue.cue_id in live:
                release_status = "in the live release"
            else:
                release_status = "not in the live release"
                problems.append("The live sound release does not include this cue.")
                fixes.append("Sound library, Sound releases, Publish the sound library.")
        else:
            release_status = "n/a (disabled)"
        if in_manifest is None:
            manifest_status = "unknown (no 3D Area)"
        elif cue.cue_id in in_manifest:
            manifest_status = "served"
        else:
            manifest_status = "not served"
            if cue.enabled and cue.cue_id in live and asset_state == "published":
                problems.append(
                    "The live release has it, but the game's manifest does not serve it."
                )
                fixes.append(
                    "Mark the cue Shared or assign it to the game's 3D Area, then publish again."
                )
            elif cue.enabled and cue.cue_id in live:
                problems.append("The manifest dropped it because its audio is no longer published.")
    ready = cue is not None and not problems and manifest_status == "served"
    return CueCheck(
        cue_id=spec.cue_id,
        purpose=spec.description,
        channel=spec.channel,
        asset_id=spec.asset_id,
        cue_status=cue_status,
        asset_status=asset_status,
        assignment_status=assignment_status,
        release_status=release_status,
        manifest_status=manifest_status,
        ready=ready,
        problems=tuple(problems),
        remediation=tuple(fixes),
    )


def game_coverage(slug: str) -> GameCoverage:
    game = GAMES[slug]
    region = (
        WorldRegion.objects.select_related("location", "location__world")
        .filter(region_id=game.region_id)
        .first()
    )
    cues = {cue.cue_id: cue for cue in _cues()}
    live = _live_cue_ids()
    served = _manifest_ids(region)

    def run(specs):
        return tuple(_check(spec, cues, live, served, game.seed_command) for spec in specs)

    return GameCoverage(game, region is not None, run(game.required), run(game.optional))


# --- coverage by scope --------------------------------------------------------------------------


def _problem_count_for(assignment: SoundAssignment) -> int:
    from .targets import assignment_problems

    return len(assignment_problems(assignment))


def scope_coverage(island: str | None = None, place: str | None = None) -> list[ScopeCoverage]:
    """One row per Island, Place and published 3D Area (optionally narrowed), plus Adventures
    that have sound assigned."""
    rows: list[ScopeCoverage] = []
    assignments = list(
        SoundAssignment.objects.select_related("world", "location", "region", "cue").filter(
            enabled=True
        )
    )

    def count(**match) -> tuple[int, int]:
        picked = [
            a for a in assignments if all(getattr(a, k + "_id") == v for k, v in match.items())
        ]
        return len(picked), sum(1 for a in picked if _problem_count_for(a))

    worlds = World.objects.filter(active=True)
    if island:
        worlds = worlds.filter(slug=island)
    for world in worlds:
        n, bad = count(world=world.pk)
        sounds = len(
            build_manifest("island", world.slug, [GLOBAL, (Scope.ISLAND, world.slug)])["sounds"]
        )
        rows.append(ScopeCoverage("Island", world.slug, world.slug, n, sounds, bad))
        for loc in Location.objects.select_related("world").filter(world=world, active=True):
            if place and loc.slug != place:
                continue
            n, bad = count(location=loc.pk)
            chain = [GLOBAL, (Scope.ISLAND, world.slug), (Scope.PLACE, loc.slug)]
            sounds = len(build_manifest("place", loc.slug, chain)["sounds"])
            rows.append(
                ScopeCoverage("Place", loc.slug, f"{world.slug} / {loc.slug}", n, sounds, bad)
            )
            area = WorldRegion.objects.filter(location=loc, status=ContentStatus.PUBLISHED).first()
            if area:
                n, bad = count(region=area.pk)
                sounds = len(
                    build_manifest("region", area.region_id, _chain_for_region(area))["sounds"]
                )
                rows.append(
                    ScopeCoverage(
                        "3D Area", area.region_id, f"{loc.slug} / {area.region_id}", n, sounds, bad
                    )
                )
    if not island and not place:
        adventure_ids = {
            a.target_id for a in assignments if a.target_type == "adventure" and a.target_id
        }
        for adventure in Adventure.objects.filter(slug__in=adventure_ids).order_by("slug"):
            matching = [
                a
                for a in assignments
                if a.target_type == "adventure" and a.target_id == adventure.slug
            ]
            rows.append(
                ScopeCoverage(
                    "Adventure",
                    adventure.slug,
                    adventure.slug,
                    len(matching),
                    len({a.cue.cue_id for a in matching}),
                    sum(1 for a in matching if _problem_count_for(a)),
                )
            )
    return rows


# --- diagnostics --------------------------------------------------------------------------------


def diagnostics(game: str | None = None) -> Diagnostics:
    """Every problem found, with what to do about it. Deterministic order."""
    found = Diagnostics()
    cues = _cues()
    by_id = {cue.cue_id: cue for cue in cues}
    live = live_release()
    live_ids = _live_cue_ids()

    if not cues:
        found.add(
            ERROR,
            "empty-library",
            "Sound library",
            "There are no sound cues.",
            "Upload audio in the Asset library, then add cues (or run a seed command).",
        )
    if live is None:
        found.add(
            ERROR,
            "no-live-release",
            "Sound releases",
            "No sound release has been published.",
            "Sound library, Sound releases, Publish the sound library. "
            "Until then every game is silent.",
        )

    used = _used_cue_ids()
    for cue in cues:
        state, why = _asset_state(cue)
        if state != "published" and cue.enabled:
            code = {"retired": "retired-asset", "unpublished": "unpublished-asset"}.get(
                state, "bad-asset"
            )
            found.add(
                ERROR,
                code,
                cue.cue_id,
                f"{why}.",
                "Publish or reactivate the audio in the Asset library, or change the cue's asset.",
            )
        if cue.enabled and cue.pk not in used:
            found.add(
                WARNING,
                "unassigned-cue",
                cue.cue_id,
                "The cue is not shared and no enabled assignment uses it, so no game plays it.",
                "Mark it Shared or add an assignment, or disable it.",
            )
        if cue.enabled and live is not None and cue.cue_id not in live_ids and state == "published":
            found.add(
                WARNING,
                "not-in-release",
                cue.cue_id,
                "The cue is enabled and ready but not in the live release.",
                "Publish the sound library.",
            )

    for cue_id in sorted(live_ids):
        cue = by_id.get(cue_id)
        if cue is None:
            found.add(
                WARNING,
                "orphaned-release-cue",
                cue_id,
                "The live release serves a cue that no longer exists in the working copy.",
                "Recreate the cue, or publish a new release without it.",
            )
        elif not cue.enabled:
            found.add(
                WARNING,
                "orphaned-release-cue",
                cue_id,
                "The live release serves a cue that is now disabled.",
                "Enable it again, or publish a new release to remove it.",
            )

    for assignment in SoundAssignment.objects.select_related(
        "cue", "world", "location", "region", "region__location__world", "location__world"
    ).order_by("pk"):
        try:
            assignment.full_clean(validate_unique=False)
        except ValidationError as error:
            found.add(
                ERROR,
                "invalid-assignment",
                str(assignment),
                "; ".join(m for ms in error.message_dict.values() for m in ms),
                "Fix or delete the assignment in Sound library, Sound assignments.",
            )
        if assignment.enabled and not assignment.cue.enabled:
            found.add(
                WARNING,
                "assignment-of-disabled-cue",
                str(assignment),
                f"Its cue '{assignment.cue.cue_id}' is disabled, so it is skipped.",
                "Enable the cue or disable the assignment.",
            )

    for slug in [game] if game else sorted(GAMES):
        coverage = game_coverage(slug)
        title = coverage.game.title
        if not coverage.area_found:
            found.add(
                ERROR,
                "game-area-missing",
                title,
                f"The 3D Area '{coverage.game.region_id}' does not exist, "
                "so its manifest cannot be checked.",
                "Seed and publish the game's content first.",
            )
        for check in coverage.checks:
            if check.ready:
                continue
            kind = {"missing": "missing-cue"}.get(check.cue_status, "game-cue-not-ready")
            found.add(
                ERROR,
                kind,
                f"{title}: {check.cue_id}",
                " ".join(check.problems) or "The cue is not served.",
                " ".join(check.remediation) or "See the cue's status.",
            )
    found.issues.sort(key=lambda i: (SEVERITIES.index(i.severity), i.code, i.subject))
    return found
