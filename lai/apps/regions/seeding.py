"""Helpers for code seeds that create authored rows (ADR-043, LAI-0812).

A seed owns layout and identity (which 3D Area, which mechanic, which placements). Content a
seed supplies for an authorable row is checked with the same rules an administrator's publish
runs, then recorded as that row's first published revision (origin SEED). Like every seed,
nothing that already exists is changed: an administrator's later edits are never overwritten.
"""

from apps.catalog import authoring
from apps.catalog.models import RevisionOrigin

from .models import AreaPuzzle, WorldRegion


class SeedContentInvalid(ValueError):
    def __init__(self, label: str, problems: list[str]):
        super().__init__(f"{label}: {'; '.join(problems)}")
        self.problems = problems


def seed_puzzle(
    region: WorldRegion,
    *,
    puzzle_id: str,
    kind: str,
    entity_ids: list[str],
    body: dict,
    sort_order: int = 0,
) -> tuple[AreaPuzzle, bool]:
    """Create a DRAFT puzzle with `body` as its first published content, if it does not exist."""
    existing = AreaPuzzle.objects.filter(region=region, puzzle_id=puzzle_id).first()
    if existing is not None:
        return existing, False
    puzzle = AreaPuzzle(
        region=region,
        puzzle_id=puzzle_id,
        kind=kind,
        entity_ids=entity_ids,
        sort_order=sort_order,
        world_change_key=body.get("worldChangeKey", ""),
    )
    problems = authoring.validate(puzzle, body)
    if problems:
        raise SeedContentInvalid(f"puzzle {puzzle_id}", problems)
    puzzle.full_clean(exclude=["reward_rule"])
    authoring.kind_for(puzzle).apply(puzzle, body, problems)()
    authoring.record_published(puzzle, body, origin=RevisionOrigin.SEED)
    return puzzle, True


def record_seed_revision(row) -> None:
    """First published revision for a seed-created authorable row (a region, a challenge spec)."""
    if row.published_revision_id is None:
        authoring.record_published(row, authoring.current_body(row), origin=RevisionOrigin.SEED)
