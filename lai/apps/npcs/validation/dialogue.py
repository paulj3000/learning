"""Release validation: dialogue. Owner: Workstream C (LAI-NPC-011/012): dialogue graph validity:
start node, reachable nodes, dangling next keys, choice actions, quest slugs in OFFER_QUEST,
age-band coverage.

Foundation stub (contract v1). Called by `apps.npcs.validation.release_problems` with the built
snapshot; returns problems in words staff can act on, never raises. Must not query child data.
"""


def problems(snapshot: dict) -> list[str]:
    return []
