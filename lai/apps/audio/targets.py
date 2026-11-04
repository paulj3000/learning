"""Is this assignment's target real, and does it belong where it is placed? (SM-P2-04)

One function, used by model validation, the admin and the publish check, so all three refuse the
same things. Targets are named by the content ids the rest of the system already uses (an
Adventure's slug, an NPC's id, an object's entity id in a 3D Area). Nothing here evaluates
anything a user typed: the vocabulary is closed and every id is looked up as data.
"""

from apps.catalog.models import Adventure, NpcDefinition, Quest, RewardRule
from apps.regions.models import TreasureChest, WorldObjectPlacement

from .vocabulary import AREA_ONLY_TARGETS, EVENTS_BY_TARGET, TargetType


def _scope_world_slug(assignment) -> str | None:
    """The slug of the Island the assignment's scope sits in, if it has one."""
    if assignment.region_id:
        return assignment.region.location.world.slug
    if assignment.location_id:
        return assignment.location.world.slug
    if assignment.world_id:
        return assignment.world.slug
    return None


def _scope_place_id(assignment) -> int | None:
    if assignment.region_id:
        return assignment.region.location_id
    return assignment.location_id


def region_zone_ids(region) -> set[str]:
    """The ids of the zones a 3D Area's layout declares (`scene.layout.zones[].rect.id`)."""
    layout = (region.scene or {}).get("layout") if region else None
    zones = layout.get("zones", []) if isinstance(layout, dict) else []
    return {
        zone["rect"]["id"]
        for zone in zones
        if isinstance(zone, dict) and isinstance(zone.get("rect"), dict) and zone["rect"].get("id")
    }


def assignment_problems(assignment) -> list[str]:
    """Why this assignment is invalid (empty when it is fine)."""
    problems: list[str] = []
    target_type = assignment.target_type
    target_id = assignment.target_id or ""

    scopes = [bool(assignment.world_id), bool(assignment.location_id), bool(assignment.region_id)]
    if sum(scopes) > 1:
        return ["Choose at most one of Island, Place and 3D Area."]

    if target_type not in EVENTS_BY_TARGET:
        return [f"Unknown target type '{target_type}'."]
    if assignment.event not in EVENTS_BY_TARGET[target_type]:
        allowed = ", ".join(sorted(EVENTS_BY_TARGET[target_type]))
        problems.append(
            f"A {target_type} target cannot raise '{assignment.event}'. Use: {allowed}."
        )

    if target_type == TargetType.SCOPE:
        if target_id:
            problems.append("Leave the target id empty when the sound belongs to the scope itself.")
        if not any(scopes):
            problems.append(
                "A scope sound needs an Island, a Place or a 3D Area; "
                "use a shared cue for sounds that play everywhere."
            )
        return problems
    if not target_id:
        return [*problems, f"A {target_type} target needs its content id."]

    if target_type in AREA_ONLY_TARGETS:
        if not assignment.region_id:
            return [*problems, f"A {target_type} sound must be placed in a 3D Area."]
        if target_type == TargetType.ZONE:
            if target_id not in region_zone_ids(assignment.region):
                problems.append(f"This 3D Area has no audio zone '{target_id}'.")
            return problems
        model = TreasureChest if target_type == TargetType.CHEST else WorldObjectPlacement
        if not model.objects.filter(region_id=assignment.region_id, entity_id=target_id).exists():
            problems.append(f"This 3D Area has no {target_type} '{target_id}'.")
        return problems

    world_slug = _scope_world_slug(assignment)
    if target_type == TargetType.ADVENTURE:
        adventure = (
            Adventure.objects.select_related("location", "world").filter(slug=target_id).first()
        )
        if adventure is None:
            problems.append(f"Unknown adventure '{target_id}'.")
        else:
            place_id = _scope_place_id(assignment)
            if place_id is not None and adventure.location_id != place_id:
                problems.append(f"Adventure '{target_id}' does not belong to this Place.")
            elif assignment.world_id and (
                adventure.location_id is None or adventure.location.world.slug != world_slug
            ):
                problems.append(f"Adventure '{target_id}' does not belong to this Island.")
    elif target_type == TargetType.QUEST:
        quest = Quest.objects.select_related("world").filter(slug=target_id).first()
        if quest is None:
            problems.append(f"Unknown quest '{target_id}'.")
        elif world_slug is not None and quest.world is not None and quest.world.slug != world_slug:
            problems.append(f"Quest '{target_id}' does not belong to this Island.")
    elif target_type == TargetType.NPC:
        if not NpcDefinition.objects.filter(npc_id=target_id).exists():
            problems.append(f"Unknown NPC '{target_id}'.")
    elif target_type == TargetType.REWARD:
        if not RewardRule.objects.filter(rule_id=target_id).exists():
            problems.append(f"Unknown reward rule '{target_id}'.")
    return problems
