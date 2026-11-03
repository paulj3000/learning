"""Per-record field derivation shared by the importer and Django Admin publishing (ADR-047).

One function per record kind turns an export-shaped record into the catalog row's columns, so
an import and an administrator's publish compute exactly the same columns from the same body.
Pure: no database. Each appends human-readable problems to `problems` instead of raising, so a
caller can report every problem at once (the importer's contract).

Relationships that need other rows (a location's world, a quest's adventures) are returned as
keys; the caller resolves them.
"""

from typing import Any

Record = dict[str, Any]


def text(record: Record, key: str, where: str, problems: list[str], *, optional=False) -> str:
    value = record.get(key)
    if value is None and optional:
        return ""
    if not isinstance(value, str) or (not optional and not value):
        problems.append(f"{where}: `{key}` must be a non-empty string")
        return ""
    return value


def texts(record: Record, key: str, where: str, problems: list[str]) -> list[str]:
    value = record.get(key, [])
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        problems.append(f"{where}: `{key}` must be a list of strings")
        return []
    return value


def world_fields(world: Record, where: str, problems: list[str]) -> dict[str, Any]:
    return {
        "title": text(world, "title", where, problems),
        "tagline": text(world, "tagline", where, problems, optional=True),
        "description": text(world, "description", where, problems, optional=True),
        "is_home": bool(world.get("isHome", False)),
        "supported_age_bands": texts(world, "supportedAgeBands", where, problems),
        "pack_version": int(world.get("pack", {}).get("version", 0)),
        "source": world,
    }


def location_fields(location: Record, where: str, problems: list[str]) -> tuple[dict, str]:
    """Returns (fields, world slug)."""
    world_slug = text(location, "worldSlug", where, problems)
    return {
        "title": text(location, "title", where, problems),
        "tagline": text(location, "tagline", where, problems, optional=True),
        "description": text(location, "description", where, problems, optional=True),
        "skills": texts(location, "skills", where, problems),
        "source": location,
    }, world_slug


def adventure_fields(adventure: Record, step_ids: set, where: str, problems: list[str]) -> dict:
    """`adventure` may include `steps`; `source` never does (steps are their own rows)."""
    entry = text(adventure, "entryStepId", where, problems)
    if entry and entry not in step_ids:
        problems.append(f"{where}: entry step {entry!r} is not one of its steps")
    level = adventure.get("skillLevel")
    return {
        "title": text(adventure, "title", where, problems),
        "version": int(adventure.get("version", 0)),
        "location_slug": text(adventure, "locationSlug", where, problems),
        "age_bands": texts(adventure, "ageBands", where, problems),
        "entry_step_id": entry,
        "skill_domain": adventure.get("skillDomain") or "",
        "skill_level": level if isinstance(level, int) else None,
        "source": {key: value for key, value in adventure.items() if key != "steps"},
    }


def step_fields(step: Record, position: int, where: str, problems: list[str]) -> dict:
    return {
        "position": position,
        "step_type": text(step, "type", where, problems),
        "objective_ids": texts(step, "objectiveIds", where, problems),
        "source": step,
    }


def quest_solved_adventures(quest: Record) -> list[str]:
    return [
        objective.get("adventureSlug")
        for stage in quest.get("stages", [])
        for objective in stage.get("objectives", [])
        if objective.get("kind") == "SOLVE"
    ]


def quest_fields(quest: Record, adventure_slugs, where: str, problems: list[str]) -> tuple:
    """Returns (fields, the known adventures its SOLVE objectives name, in order)."""
    solved = quest_solved_adventures(quest)
    for slug in solved:
        if slug not in adventure_slugs:
            problems.append(f"{where}: SOLVE names unknown adventure {slug!r}")
    stage_ids = {stage.get("id") for stage in quest.get("stages", [])}
    if quest.get("entryStageId") not in stage_ids:
        problems.append(
            f"{where}: entry stage {quest.get('entryStageId')!r} is not one of its stages"
        )
    return {
        "title": text(quest, "title", where, problems),
        "summary": text(quest, "summary", where, problems, optional=True),
        "giver_npc_id": quest.get("giverNpcId") or "",
        "age_bands": texts(quest, "ageBands", where, problems),
        "source": quest,
    }, list(dict.fromkeys(slug for slug in solved if slug in adventure_slugs))


def story_scene_adventures(story: Record) -> list[str]:
    return [
        scene["templateSlug"]
        for chapter in story.get("chapters", [])
        for scene in chapter.get("scenes", [])
        if scene.get("kind") == "ADVENTURE" and scene.get("templateSlug")
    ]


def story_fields(story: Record, adventure_slugs, where: str, problems: list[str]) -> tuple:
    """Returns (fields, the known adventures its ADVENTURE scenes name, in order)."""
    chapters = [c for c in story.get("chapters", []) if isinstance(c, dict)]
    chapter_ids = [c.get("id") for c in chapters]
    if len(set(chapter_ids)) != len(chapter_ids):
        problems.append(f"{where}: chapter ids must be unique")
    entry = text(story, "entryChapterId", where, problems)
    if entry and entry not in chapter_ids:
        problems.append(f"{where}: entry chapter {entry!r} is not one of its chapters")
    for chapter in chapters:
        following = chapter.get("nextChapterId")
        if following and following not in chapter_ids:
            problems.append(
                f"{where}: chapter {chapter.get('id')!r} leads to unknown {following!r}"
            )
    scene_ids = [scene.get("id") for chapter in chapters for scene in chapter.get("scenes", [])]
    if len(set(scene_ids)) != len(scene_ids):
        problems.append(f"{where}: scene ids must be unique")
    solved = story_scene_adventures(story)
    for slug in solved:
        if slug not in adventure_slugs:
            problems.append(f"{where}: ADVENTURE scene names unknown adventure {slug!r}")
    return {
        "title": text(story, "title", where, problems),
        "description": text(story, "description", where, problems, optional=True),
        "supported_age_bands": texts(story, "supportedAgeBands", where, problems),
        "entry_chapter_id": entry,
        "source": story,
    }, list(dict.fromkeys(slug for slug in solved if slug in adventure_slugs))


def objective_fields(objective: Record, where: str, problems: list[str]) -> dict:
    return {
        "domain": text(objective, "domain", where, problems),
        "title": text(objective, "title", where, problems),
        "source": objective,
    }


def npc_fields(npc: Record, where: str, problems: list[str]) -> tuple[dict, str]:
    """Returns (fields, home location slug)."""
    home = text(npc, "homeLocationSlug", where, problems)
    return {
        "display_name": text(npc, "displayName", where, problems),
        "role": text(npc, "role", where, problems, optional=True),
        "home_location_slug": home,
        "interaction_id": text(npc, "interactionId", where, problems, optional=True),
        "source": npc,
    }, home


def collectible_set_fields(collectible_set: Record, where: str, problems: list[str]) -> tuple:
    """Returns (fields, completion item id or None)."""
    return {
        "display_name": text(collectible_set, "displayName", where, problems),
        "completion_message": text(
            collectible_set, "completionMessage", where, problems, optional=True
        ),
        "source": collectible_set,
    }, collectible_set.get("completionItemId")


def item_fields(item: Record, where: str, problems: list[str]) -> tuple[dict, str | None]:
    """Returns (fields, collectible set id or None)."""
    return {
        "display_name": text(item, "displayName", where, problems),
        "description": text(item, "description", where, problems, optional=True),
        "category": text(item, "category", where, problems),
        "rarity": text(item, "rarity", where, problems),
        "cosmetic_slot": item.get("cosmeticSlot") or "",
        "hidden": bool(item.get("hidden", False)),
        "source": item,
    }, item.get("setId")


def reward_rule_fields(rule: Record, where: str, problems: list[str]) -> tuple[dict, list[str]]:
    """Returns (fields, granted item ids)."""
    granted = texts(rule, "itemIds", where, problems)
    if not isinstance(rule.get("trigger"), dict):
        problems.append(f"{where}: `trigger` must be an object")
    return {
        "trigger": rule.get("trigger"),
        "message": text(rule, "message", where, problems, optional=True),
        "source": rule,
    }, granted


ALL_AGE_BANDS = ("SPROUT", "PATHFINDER", "EXPLORER")


def npc_dialogue_problems(
    npc: Record, covered_bands: tuple[str, ...], where: str, problems: list[str]
) -> None:
    """Age-band dialogue rules (LAI-0817), checked when an administrator publishes an NPC.

    - node ids are unique and every choice leads to a node of this NPC;
    - when any node targets age bands, each band in `covered_bands` must hear a conversation
      opener that has no conditions (the safe fallback: no child meets silence);
    - no node leaves a band with choices that all lead to lines that band never hears.
    """
    nodes = [n for n in npc.get("dialogue", []) if isinstance(n, dict)]
    ids = [n.get("id") for n in nodes]
    for node_id in sorted({i for i in ids if ids.count(i) > 1}, key=str):
        problems.append(f"{where}: dialogue node id {node_id!r} is used more than once")
    known = set(ids)
    for node in nodes:
        for choice in node.get("choices", []):
            target = choice.get("nextNodeId")
            if target and target not in known:
                problems.append(
                    f"{where}: choice {choice.get('id')!r} in node {node.get('id')!r} "
                    f"leads to unknown node {target!r}"
                )
    if not any("ageBands" in n for n in nodes):
        return

    def hears(node: Record, band: str) -> bool:
        return band in node.get("ageBands", ALL_AGE_BANDS)

    for band in covered_bands:
        openers = [
            n
            for n in nodes
            if hears(n, band) and not n.get("followUpOnly") and not n.get("conditions")
        ]
        if not openers:
            problems.append(
                f"{where}: age band {band} has no conversation opener without conditions "
                "(add a line for every band, or one with no age band)"
            )
        by_id = {n.get("id"): n for n in nodes}
        for node in nodes:
            choices = [c for c in node.get("choices", []) if c.get("nextNodeId") in by_id]
            if (
                hears(node, band)
                and choices
                and not any(hears(by_id[c["nextNodeId"]], band) for c in choices)
            ):
                problems.append(
                    f"{where}: every choice in node {node.get('id')!r} leads to lines that "
                    f"age band {band} never hears"
                )
