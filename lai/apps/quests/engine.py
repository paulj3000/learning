"""Server-side quest advancement: a port of `react/src/features/quests/{quest,objectives}.ts`.

TR-4 ported the objectives the server could prove then. LAI-0605 completes the port, pinned by
every case in `tests/golden/quests.json` (`tests/golden/test_quests_python.py`):

- objectives: TALK_TO and HELP_NPC (an NPC memory flag), DELIVER (item owned and memory flag),
  FIND and CRAFT (item owned), COLLECT (items owned), SOLVE (a completed adventure session),
  BUILD (a world change), EXPLORE (a visited location), LEARN (a skill status at least a level),
  DISCOVER (a discovery found);
- conditions: ALWAYS, QUEST_COMPLETED, WORLD_CHANGE, ITEM_OWNED, RELATIONSHIP_AT_LEAST,
  OBJECTIVE_COMPLETED.

The rules are the TypeScript ones: a stage completes when its non-optional objectives are
complete; the first matching branch wins, then `nextStageId`; no next stage completes the quest;
a revisited stage stops an authored cycle; a completed quest never changes. What the context
holds is decided by `apps.quests.services.build_context`, from server records only, so the
server never credits progress it cannot prove. A context field nothing fills yet (EXPLORE's
visited locations) simply never completes its objective.
"""

from dataclasses import dataclass, field

RELATIONSHIP_LEVEL_ORDER = ("STRANGER", "ACQUAINTANCE", "FRIEND", "TRUSTED_FRIEND")
SKILL_STATUS_ORDER = ("LOCKED", "INTRODUCED", "DEVELOPING", "PROFICIENT", "MASTERED")


@dataclass(frozen=True)
class QuestContext:
    world_change_keys: frozenset[str] = frozenset()
    owned_item_ids: frozenset[str] = frozenset()
    completed_adventure_slugs: frozenset[str] = frozenset()
    completed_quest_ids: frozenset[str] = frozenset()
    visited_location_slugs: frozenset[str] = frozenset()
    # npc id -> {flag: bool}
    npc_memory_flags: dict = field(default_factory=dict)
    # npc id -> relationship level
    relationship_levels: dict = field(default_factory=dict)
    # learning objective code -> skill status
    skill_statuses: dict = field(default_factory=dict)
    discovery_keys: frozenset[str] = frozenset()


@dataclass(frozen=True)
class QuestState:
    status: str
    current_stage_id: str
    completed_stage_ids: tuple[str, ...] = ()
    completed_objective_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class AdvanceResult:
    state: QuestState
    changed: bool
    newly_completed_stage_ids: tuple[str, ...] = ()
    newly_completed_objective_ids: tuple[str, ...] = ()
    world_changes: tuple[dict, ...] = field(default=())
    just_completed: bool = False


def _rank(order: tuple[str, ...], value) -> int:
    """`ORDER.indexOf(value)`: -1 for an unknown value, exactly as in TypeScript."""
    return order.index(value) if value in order else -1


def _npc_remembers(context: QuestContext, npc_id, flag) -> bool:
    flags = context.npc_memory_flags.get(npc_id)
    return isinstance(flags, dict) and flags.get(flag) is True


def objective_complete(objective: dict, context: QuestContext) -> bool:
    kind = objective.get("kind")
    if kind in ("TALK_TO", "HELP_NPC"):
        return _npc_remembers(context, objective.get("npcId"), objective.get("memoryFlag"))
    if kind == "DELIVER":
        return objective.get("itemId") in context.owned_item_ids and _npc_remembers(
            context, objective.get("npcId"), objective.get("memoryFlag")
        )
    if kind in ("FIND", "CRAFT"):
        return objective.get("itemId") in context.owned_item_ids
    if kind == "COLLECT":
        item_ids = objective.get("itemIds", [])
        required = objective.get("requiredCount")
        if required is None:
            required = len(item_ids)
        return sum(item in context.owned_item_ids for item in item_ids) >= required
    if kind == "SOLVE":
        return objective.get("adventureSlug") in context.completed_adventure_slugs
    if kind == "BUILD":
        return objective.get("changeKey") in context.world_change_keys
    if kind == "EXPLORE":
        return objective.get("locationSlug") in context.visited_location_slugs
    if kind == "LEARN":
        status = context.skill_statuses.get(objective.get("learningObjectiveCode"))
        if not status:
            return False
        return _rank(SKILL_STATUS_ORDER, status) >= _rank(SKILL_STATUS_ORDER, objective.get("atLeast"))
    if kind == "DISCOVER":
        return objective.get("discoveryKey") in context.discovery_keys
    return False


def condition_holds(condition: dict, context: QuestContext, completed_objectives=()) -> bool:
    kind = condition.get("type")
    if kind == "ALWAYS":
        return True
    if kind == "QUEST_COMPLETED":
        return condition.get("questId") in context.completed_quest_ids
    if kind == "WORLD_CHANGE":
        return condition.get("changeKey") in context.world_change_keys
    if kind == "ITEM_OWNED":
        return condition.get("itemId") in context.owned_item_ids
    if kind == "RELATIONSHIP_AT_LEAST":
        level = context.relationship_levels.get(condition.get("npcId"), "STRANGER")
        return _rank(RELATIONSHIP_LEVEL_ORDER, level) >= _rank(
            RELATIONSHIP_LEVEL_ORDER, condition.get("level")
        )
    if kind == "OBJECTIVE_COMPLETED":
        return condition.get("objectiveId") in completed_objectives
    return False


def conditions_hold(conditions, context: QuestContext, completed_objectives=()) -> bool:
    return all(condition_holds(c, context, completed_objectives) for c in conditions or [])


def start_state(entry_stage_id: str) -> QuestState:
    return QuestState(status="ACTIVE", current_stage_id=entry_stage_id)


def advance_quest(stages: list[dict], completion: dict, state: QuestState, context: QuestContext):
    if state.status == "COMPLETED":
        return AdvanceResult(state=state, changed=False)

    by_id = {stage.get("id"): stage for stage in stages}
    completed_objectives = list(state.completed_objective_ids)
    completed_stages = list(state.completed_stage_ids)
    new_stages: list[str] = []
    world_changes: list[dict] = []
    visited: set[str] = set()
    current = state.current_stage_id
    status = state.status
    just_completed = False

    while True:
        stage = by_id.get(current)
        if stage is None:
            break  # an unresolved authored id: stuck but intact, as on the client
        objectives = stage.get("objectives", [])
        for objective in objectives:
            if (
                objective_complete(objective, context)
                and objective["id"] not in completed_objectives
            ):
                completed_objectives.append(objective["id"])
        required = [o for o in objectives if not o.get("optional")]
        if not all(objective_complete(o, context) for o in required):
            break
        if current in visited:
            break
        visited.add(current)
        if current not in completed_stages:
            completed_stages.append(current)
            new_stages.append(current)
            world_changes.extend(stage.get("worldChanges") or [])
        branch = next(
            (
                b
                for b in stage.get("branches") or []
                if conditions_hold(b.get("conditions", []), context, completed_objectives)
            ),
            None,
        )
        following = branch["nextStageId"] if branch else stage.get("nextStageId")
        if not following:
            status = "COMPLETED"
            just_completed = True
            world_changes.extend((completion or {}).get("worldChanges") or [])
            break
        current = following

    new_objectives = tuple(
        o for o in completed_objectives if o not in state.completed_objective_ids
    )
    new_state = QuestState(
        status=status,
        current_stage_id=current,
        completed_stage_ids=tuple(completed_stages),
        completed_objective_ids=tuple(completed_objectives),
    )
    return AdvanceResult(
        state=new_state,
        changed=bool(
            just_completed or new_stages or new_objectives or current != state.current_stage_id
        ),
        newly_completed_stage_ids=tuple(new_stages),
        newly_completed_objective_ids=new_objectives,
        world_changes=tuple(world_changes),
        just_completed=just_completed,
    )
