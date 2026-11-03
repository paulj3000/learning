"""The published audio manifest a game reads (SM-P2-06).

Built only from the LIVE `SoundRelease`: drafts, disabled cues and unpublished audio can never
appear, however the working copy is edited. A manifest holds no URL. A sound names its audio as
`asset-id@version`, which the child-scoped asset resolver turns into a fresh, signed, expiring URL
when the client is ready to load it. That keeps a cached manifest from ever holding a dead link.

Assignment resolution: for the same target, event and channel, the deepest scope wins
(3D Area over Place over Island over everywhere). A specific assignment replaces a general one on
that channel; it does not stack with it. Other channels are unaffected, so a Place can start an
ambient bed while its 3D Area starts music for the same event.
"""

from apps.assets.models import AssetVersion, VersionStatus
from apps.catalog.models import AssetStatus

from .services import live_release, revision_of
from .vocabulary import SCHEMA_VERSION, SCOPE_DEPTH, Scope

SCOPE_NAMES = {Scope.ISLAND: "island", Scope.PLACE: "place", Scope.AREA: "region"}

OPTIONAL_FIELDS = (
    ("priority", "priority"),
    ("maxConcurrent", "maxConcurrent"),
)


def _sound(cue: dict) -> dict:
    sound = {
        "id": cue["id"],
        "assetId": f"{cue['asset']}@{cue['version']}",
        "channel": cue["channel"],
        "volume": cue["volume"],
        "loop": cue["loop"],
    }
    if cue["stream"]:
        sound["stream"] = True
    for key, source in OPTIONAL_FIELDS:
        if cue[source] is not None:
            sound[key] = cue[source]
    for key in ("cooldownMs", "fadeInMs", "fadeOutMs"):
        if cue[key]:
            sound[key] = cue[key]
    # Added in SM-P7. Older releases have no key and older clients ignore it.
    if cue.get("spatial"):
        sound["spatial"] = cue["spatial"]
    return sound


def _available_versions(cues: list[dict]) -> set[str]:
    """The pinned versions that are still published (a retired one is dropped, not served)."""
    ids = [cue["versionId"] for cue in cues]
    rows = AssetVersion.objects.filter(
        version_id__in=ids, status=VersionStatus.PUBLISHED, asset__status=AssetStatus.ACTIVE
    ).values_list("version_id", flat=True)
    return {str(item) for item in rows}


def build_manifest(scope_kind: str, scope_id: str, chain: list[tuple[str, str | None]]) -> dict:
    """The manifest for one scope.

    `chain` is the scope's ancestry from general to specific, for example
    `[("global", None), ("island", "w"), ("place", "p"), ("area", "r")]`.
    """
    release = live_release()
    cues: list[dict] = []
    assignments: list[dict] = []
    if release is not None:
        snapshot = release.snapshot
        by_id = {cue["id"]: cue for cue in snapshot["cues"]}
        applicable = [
            item
            for item in snapshot["assignments"]
            if (item["scope"]["type"], item["scope"]["id"]) in chain
        ]
        chosen: dict[tuple[str, str, str, str], dict] = {}
        for item in applicable:
            # A slot holds one cue per channel: area music replaces place music, not place ambience.
            key = (item["targetType"], item["targetId"], item["event"], item["channel"])
            depth = SCOPE_DEPTH[item["scope"]["type"]]
            if key not in chosen or depth > SCOPE_DEPTH[chosen[key]["scope"]["type"]]:
                chosen[key] = item

        wanted = {item["cueId"] for item in chosen.values()}
        wanted |= {cue["id"] for cue in snapshot["cues"] if cue["shared"]}
        candidates = [by_id[cue_id] for cue_id in sorted(wanted) if cue_id in by_id]
        available = _available_versions(candidates)
        cues = [cue for cue in candidates if cue["versionId"] in available]
        served = {cue["id"] for cue in cues}
        assignments = [
            {
                "event": item["event"],
                "targetType": item["targetType"],
                "targetId": item["targetId"],
                "soundId": item["cueId"],
                **({"priority": item["priority"]} if item.get("priority") else {}),
            }
            for key, item in sorted(chosen.items())
            if item["cueId"] in served
        ]

    body = {
        "schemaVersion": SCHEMA_VERSION,
        "scope": {"type": scope_kind, "id": scope_id},
        "sounds": [_sound(cue) for cue in cues],
        "assignments": assignments,
    }
    return {**body, "revision": revision_of(body)}
