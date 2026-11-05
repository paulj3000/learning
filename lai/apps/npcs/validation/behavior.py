"""Release validation: behavior. Owner: Workstream D (LAI-NPC-019/025): behaviour parameters per
type and waypoint bounds against the placement's boundsRadius.

Foundation stub (contract v1). Called by `apps.npcs.validation.release_problems` with the built
snapshot; returns problems in words staff can act on, never raises. Must not query child data.
"""


def problems(snapshot: dict) -> list[str]:
    return []
