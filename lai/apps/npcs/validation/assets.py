"""Release validation: assets. Owner: Workstream A (LAI-NPC-035): asset kinds, clip names in
animation maps against AssetVersion.clips, portrait and extra asset rules.

Foundation stub (contract v1). Called by `apps.npcs.validation.release_problems` with the built
snapshot; returns problems in words staff can act on, never raises. Must not query child data.
"""


def problems(snapshot: dict) -> list[str]:
    return []
