"""Release validation: voice. Owner: Workstream E (LAI-NPC-026/028): voice profile validity and
speech pre-generation readiness.

Foundation stub (contract v1). Called by `apps.npcs.validation.release_problems` with the built
snapshot; returns problems in words staff can act on, never raises. Must not query child data.
"""


def problems(snapshot: dict) -> list[str]:
    return []
