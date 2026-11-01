"""The regions app's authorable kinds (ADR-043): a 3D Area's copy and its puzzles.

Registered from `RegionsConfig.ready`. Positions, spawn points and placements are not here:
they stay seed-authored (ADR-043 H, LAI-0805).
"""

from apps.catalog.authoring import Kind, register
from apps.catalog.models import RewardRule

from . import puzzles
from .models import AreaPuzzle, TreasureChest, WorldRegion

COPY_KEYS = {"loading", "instructions", "calmStop", "altNavLabel"}


def _region_body(region: WorldRegion) -> dict:
    scene = region.scene if isinstance(region.scene, dict) else {}
    return {
        "regionId": region.region_id,
        "title": region.title,
        "copy": dict(scene.get("copy", {})),
        "environment": dict(scene.get("environment", {})),
    }


def _apply_region(region: WorldRegion, body: dict, problems: list[str]):
    unknown = set(body) - {"regionId", "title", "copy", "environment"}
    if unknown:
        problems.append(f"$: unknown keys {', '.join(sorted(unknown))}")
    title = body.get("title")
    if not isinstance(title, str) or not title.strip() or len(title) > 120:
        problems.append("$.title: must be text of 1 to 120 characters")
    copy = body.get("copy")
    if not isinstance(copy, dict) or set(copy) - COPY_KEYS:
        problems.append(f"$.copy: must be an object with only {', '.join(sorted(COPY_KEYS))}")
    elif not all(isinstance(value, str) and value.strip() for value in copy.values()):
        problems.append("$.copy: every entry must be non-empty text")
    environment = body.get("environment")
    if not isinstance(environment, dict) or set(environment) - {"backgroundColor"}:
        problems.append("$.environment: must be an object with only backgroundColor")
    elif "backgroundColor" in environment and not (
        isinstance(environment["backgroundColor"], int)
        and 0 <= environment["backgroundColor"] <= 0xFFFFFF
    ):
        problems.append("$.environment.backgroundColor: must be a colour from 0 to 16777215")

    def finish() -> None:
        scene = dict(region.scene) if isinstance(region.scene, dict) else {}
        scene["copy"] = body["copy"]
        scene["environment"] = body["environment"]
        region.title = body["title"]
        region.scene = scene
        region.save(update_fields=["title", "scene", "updated_at"])

    return finish


def _puzzle_body(puzzle: AreaPuzzle) -> dict:
    return {
        "puzzleId": puzzle.puzzle_id,
        "kind": puzzle.kind,
        "title": puzzle.title,
        "requiresChangeKeys": list(puzzle.requires_change_keys),
        "worldChangeKey": puzzle.world_change_key,
        "rewardRuleId": puzzle.reward_rule.rule_id if puzzle.reward_rule_id else None,
        "ageBands": puzzle.parameters,
    }


def _apply_puzzle(puzzle: AreaPuzzle, body: dict, problems: list[str]):
    problems.extend(puzzles.body_problems(puzzle.kind, body))
    rule = None
    if not problems:
        if body["rewardRuleId"]:
            rule = RewardRule.objects.filter(rule_id=body["rewardRuleId"]).first()
            if rule is None:
                problems.append(f"$.rewardRuleId: unknown reward rule {body['rewardRuleId']!r}")
        key = body["worldChangeKey"]
        if (
            AreaPuzzle.objects.filter(world_change_key=key).exclude(pk=puzzle.pk).exists()
            or TreasureChest.objects.filter(world_change_key=key).exists()
        ):
            problems.append(f"$.worldChangeKey: {key} is already recorded by something else")
        # Objects a child moves or turns are this puzzle's own placements (seed-authored).
        for band, params in body["ageBands"].items():
            for key in ("stones", "slots", "valves"):
                for item in params.get(key, []):
                    if item.get("id") not in puzzle.entity_ids:
                        problems.append(
                            f"$.ageBands.{band}.{key}: {item.get('id')!r} is not one of this "
                            "puzzle's objects"
                        )
        npc_entity = None
        for band, params in body["ageBands"].items():
            npc_entity = params.get("npcEntityId")
            if npc_entity and npc_entity not in puzzle.entity_ids:
                problems.append(f"$.ageBands.{band}.npcEntityId: not one of this puzzle's objects")

    def finish() -> None:
        puzzle.title = body["title"]
        puzzle.parameters = body["ageBands"]
        puzzle.requires_change_keys = list(body["requiresChangeKeys"])
        puzzle.world_change_key = body["worldChangeKey"]
        puzzle.reward_rule = rule
        puzzle.save()

    return finish


def register_kinds() -> None:
    register(
        Kind(
            "area-copy",
            WorldRegion,
            "region_id",
            "regionId",
            None,
            _region_body,
            _apply_region,
            child_facing_paths=("title", "copy"),
        )
    )
    register(
        Kind(
            "area-puzzle",
            AreaPuzzle,
            "puzzle_id",
            "puzzleId",
            None,
            _puzzle_body,
            _apply_puzzle,
            child_facing_paths=("title", "ageBands"),
        )
    )


__all__ = ["register_kinds"]
