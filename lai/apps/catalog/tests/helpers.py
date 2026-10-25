"""Small content exports for catalog tests, written the way the TypeScript exporter writes them."""

import copy
import hashlib
import json
from pathlib import Path
from typing import Any


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def base_collections() -> dict[str, dict[str, list[dict[str, Any]]]]:
    """One world, one location, one adventure with two steps, one quest, three assets."""
    return {
        "islands.json": {
            "islands": [
                {
                    "slug": "home-island",
                    "title": "Home Island",
                    "tagline": "Where it starts",
                    "description": "The first world.",
                    "isHome": True,
                    "supportedAgeBands": ["SPROUT", "PATHFINDER"],
                    "pack": {
                        "version": 1,
                        "locationSlugs": ["bay"],
                        "adventureSlugs": ["fix-bridge", "tale"],
                        "questIds": ["repair"],
                    },
                }
            ]
        },
        "locations.json": {
            "locations": [
                {
                    "slug": "bay",
                    "worldSlug": "home-island",
                    "title": "The Bay",
                    "tagline": "Build",
                    "description": "A busy bay.",
                    "skills": ["Counting"],
                    "decoration": "",
                }
            ]
        },
        "adventures.json": {
            "adventures": [
                {
                    "slug": "fix-bridge",
                    "title": "Fix the Bridge",
                    "version": 1,
                    "locationSlug": "bay",
                    "ageBands": ["PATHFINDER"],
                    "entryStepId": "count",
                    "steps": [
                        {
                            "id": "count",
                            "type": "NUMBER_INPUT",
                            "objectiveIds": ["count-10"],
                            "presentation": {
                                "kind": "number-input",
                                "prompt": "How many?",
                                "correctValue": 3,
                            },
                            "transitions": [{"when": "always", "nextStepId": "done"}],
                            "fallback": {"text": "Hi"},
                        },
                        {
                            "id": "done",
                            "type": "COMPLETE",
                            "objectiveIds": [],
                            "presentation": {"kind": "complete", "text": "Done"},
                            "transitions": [],
                            "fallback": {"text": "Done"},
                        },
                    ],
                },
                {
                    "slug": "tale",
                    "title": "A Tale",
                    "version": 1,
                    "locationSlug": "story-only-place",
                    "ageBands": ["SPROUT"],
                    "entryStepId": "done",
                    "steps": [
                        {
                            "id": "done",
                            "type": "COMPLETE",
                            "objectiveIds": [],
                            "presentation": {"kind": "complete", "text": "The end"},
                            "transitions": [],
                            "fallback": {"text": "The end"},
                        }
                    ],
                },
            ]
        },
        "quests.json": {
            "quests": [
                {
                    "id": "repair",
                    "title": "Repair it",
                    "summary": "Fix the bridge",
                    "giverNpcId": "pip",
                    "ageBands": ["PATHFINDER"],
                    "prerequisites": [],
                    "entryStageId": "s1",
                    "stages": [
                        {
                            "id": "s1",
                            "title": "Solve",
                            "objectives": [
                                {
                                    "id": "o1",
                                    "label": "Solve",
                                    "kind": "SOLVE",
                                    "adventureSlug": "fix-bridge",
                                }
                            ],
                        }
                    ],
                    "completion": {"journalNote": "Done"},
                }
            ]
        },
        "assets.json": {
            "assets": [
                {"id": "rock", "url": "/models/rock.glb", "kind": "kit-piece", "clips": []},
                {
                    "id": "tree",
                    "url": "/models/tree.glb",
                    "kind": "kit-piece",
                    "clips": [],
                    "lod": {"lowDetailId": "tree-lod1", "distanceMeters": 14},
                },
                {
                    "id": "tree-lod1",
                    "url": "/models/tree-lod1.glb",
                    "kind": "kit-piece",
                    "clips": [],
                },
            ],
            "locationAssets": [
                {"regionSlug": "bay", "assetIds": ["tree", "rock"]},
                {"regionSlug": "welcome-harbor", "assetIds": ["rock"]},
            ],
        },
    }


def write_export(directory: Path, collections=None, *, schema_version: int = 3) -> Path:
    """Writes files, a manifest with per-file sha256, and the content digest."""
    collections = copy.deepcopy(collections if collections is not None else base_collections())
    directory.mkdir(parents=True, exist_ok=True)
    entries = []
    for path, body in collections.items():
        text = json.dumps({"schemaVersion": schema_version, **body}, indent=2) + "\n"
        (directory / path).write_text(text, encoding="utf-8")
        entries.append(
            {
                "path": path,
                "sha256": _sha256(text.encode()),
                "counts": {key: len(value) for key, value in body.items()},
            }
        )
    digest = _sha256("\n".join(f"{e['path']}:{e['sha256']}" for e in entries).encode())
    manifest = {
        "schemaVersion": schema_version,
        "contentDigest": digest,
        "exportTool": {"name": "lai-content-export", "version": "1.0.0"},
        "files": entries,
        "knownAmbiguities": [],
    }
    (directory / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    return directory
