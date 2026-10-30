"""Server-side quest advancement (TR-4): a pure port of `react/src/features/quests/quest.ts`.

`advance_quest` walks a quest forward as far as the child's real state allows, with the same
rules as the client: a stage completes when its non-optional objectives are complete; the first
matching branch wins, then `nextStageId`, and neither completes the quest; `visited` stops an
authored cycle.

Only objectives and conditions the server can prove are evaluated here: BUILD (world change),
FIND and CRAFT (item owned), COLLECT (items owned), SOLVE (a completed adventure session), and the
conditions ALWAYS, QUEST_COMPLETED, WORLD_CHANGE, ITEM_OWNED, OBJECTIVE_COMPLETED. The rest
(NPC memory flags, relationships, skill status, discoveries, location unlocks) live in engines
not yet ported to Django and evaluate as not yet complete, so the server never credits progress
it cannot prove. Each arrives with its engine's own port.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class QuestContext:
    world_change_keys: frozenset[str] = frozenset()
    owned_item_ids: frozenset[str] = frozenset()
    completed_adventure_slugs: frozenset[str] = frozenset()
    completed_quest_ids: frozenset[str] = frozenset()


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


def objective_complete(objective: dict, context: QuestContext) -> bool:
    kind = objective.get("kind")
    if kind == "BUILD":
        return objective.get("changeKey") in context.world_change_keys
    if kind in ("FIND", "CRAFT"):
        return objective.get("itemId") in context.owned_item_ids
    if kind == "COLLECT":
        item_ids = objective.get("itemIds", [])
        required = objective.get("requiredCount", len(item_ids))
        return sum(item in context.owned_item_ids for item in item_ids) >= required
    if kind == "SOLVE":
        return objective.get("adventureSlug") in context.completed_adventure_slugs
    return False


def condition_holds(condition: dict, context: QuestContext, completed_objectives) -> bool:
    kind = condition.get("type")
    if kind == "ALWAYS":
        return True
    if kind == "QUEST_COMPLETED":
        return condition.get("questId") in context.completed_quest_ids
    if kind == "WORLD_CHANGE":
        return condition.get("changeKey") in context.world_change_keys
    if kind == "ITEM_OWNED":
        return condition.get("itemId") in context.owned_item_ids
    if kind == "OBJECTIVE_COMPLETED":
        return condition.get("objectiveId") in completed_objectives
    return False


def conditions_hold(conditions, context: QuestContext, completed_objectives=()) -> bool:
    return all(condition_holds(c, context, completed_objectives) for c in conditions)


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
            world_changes.extend(stage.get("worldChanges", []))
        branch = next(
            (
                b
                for b in stage.get("branches", [])
                if conditions_hold(b.get("conditions", []), context, completed_objectives)
            ),
            None,
        )
        following = branch["nextStageId"] if branch else stage.get("nextStageId")
        if not following:
            status = "COMPLETED"
            just_completed = True
            world_changes.extend(completion.get("worldChanges", []))
            break
        current = following

    new_state = QuestState(
        status=status,
        current_stage_id=current,
        completed_stage_ids=tuple(completed_stages),
        completed_objective_ids=tuple(completed_objectives),
    )
    new_objectives = tuple(
        o for o in completed_objectives if o not in state.completed_objective_ids
    )
    return AdvanceResult(
        state=new_state,
        changed=new_state != state,
        newly_completed_stage_ids=tuple(new_stages),
        newly_completed_objective_ids=new_objectives,
        world_changes=tuple(world_changes),
        just_completed=just_completed,
    )
