"""Release validation: persona. Owner: Workstream F (LAI-NPC-031): persona topics, age bands and
fallback lines.

Foundation stub (contract v1). Called by `apps.npcs.validation.release_problems` with the built
snapshot; returns problems in words staff can act on, never raises. Must not query child data.
"""


def problems(snapshot: dict) -> list[str]:
    return []
