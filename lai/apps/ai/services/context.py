"""Server-side context sources for AI turns (LAI-0702, LAI-0703).

Two ways a turn's context is assembled, recorded on every audit row as `context_source`:

* `DJANGO_SESSION`: the turn names one of this child's Django adventure sessions. Django reads
  the step, its learning objective, the hint level the server gave and the authored hint text
  from its own rows, and ignores any client value for them. The session is looked up through
  the child (`for_child`), so another child's session is the same 404 as a missing one.
* `CLIENT_AUTHORED`: the session runs elsewhere (Amplify-era adventures, NPC dialogue, story
  scenes). The client's authored fields are bounded, screened and sent to the model as
  untrusted `guardContent`; `sessionId`/`stepId` are opaque correlation strings, never looked
  up. This is the compatibility path until those features run on Django.

The child's age band, AI switch and mastery always come from Django, never from a request.
Only authored copy and statuses reach a prompt: no nickname, no interests, no counts, no ids
beyond the adventure template id.
"""

from dataclasses import dataclass, field
from uuid import UUID

from django.conf import settings

from apps.adventures import engine
from apps.catalog.models import AdventureStep, NpcDefinition
from apps.game_sessions.models import AdventureSession, SessionKind
from apps.game_sessions.services import step_is_pinned
from apps.quests.models import QuestProgress, QuestStatus


class ContextNotFound(Exception):
    """The named session or step is not this child's (or does not exist): 404."""


@dataclass(frozen=True)
class SessionStep:
    template_id: str
    session_id: str
    step_id: str
    step_source: dict
    objective_ids: tuple[str, ...]
    hint_level: int

    @property
    def presentation(self) -> dict:
        value = self.step_source.get("presentation")
        return value if isinstance(value, dict) else {}

    @property
    def prompt(self) -> str | None:
        for key in ("prompt", "text"):
            value = self.presentation.get(key)
            if isinstance(value, str) and value.strip():
                return value
        return None

    @property
    def option_ids(self) -> list[str]:
        options = self.presentation.get("options")
        if not isinstance(options, list):
            return []
        return [o["id"] for o in options if isinstance(o, dict) and isinstance(o.get("id"), str)]

    def hint_text(self, level: int) -> str | None:
        text = engine.hint_text(self.step_source, level)
        return text if isinstance(text, str) else None


def load_session_step(child, session_id, step_id: str) -> SessionStep:
    """This child's ADVENTURE session and one of its adventure's steps, or ContextNotFound.

    Any step of the session's adventure is accepted, not only the current one: a celebration
    is requested for the step just answered, after the server already moved on.
    """
    try:
        session = (
            AdventureSession.objects.for_child(child)
            .select_related("adventure")
            .get(pk=UUID(str(session_id)), kind=SessionKind.ADVENTURE)
        )
        step = AdventureStep.objects.get(adventure=session.adventure, step_id=step_id)
    except (AdventureSession.DoesNotExist, AdventureStep.DoesNotExist, ValueError):
        raise ContextNotFound from None
    if not step_is_pinned(session, step):
        # The adventure was republished after this session started: never narrate or hint with
        # different content than the session is graded on. The client keeps its authored copy.
        raise ContextNotFound
    return SessionStep(
        template_id=session.adventure.slug,
        session_id=str(session.pk),
        step_id=step.step_id,
        step_source=step.source if isinstance(step.source, dict) else {},
        objective_ids=tuple(step.objective_ids or ()),
        hint_level=int((session.hint_levels or {}).get(step.step_id, 0)),
    )


def prerequisite_mastery(child, skill_id: str) -> list[dict]:
    """`[{skillId, status}]` for this skill's prerequisites the child currently knows.

    Statuses only, from `SkillProgress` (computed by `education.mastery` from server-graded
    evidence, with review decay applied at read time). A skill with no progress row is simply
    not listed: fewer "known" titles, never more.
    """
    from . import learner

    return learner.known_prerequisites(child, skill_id)


def active_quest_copy(child) -> tuple[str | None, str | None]:
    """Authored title and stage heading of this child's most recently active quest."""
    progress = (
        QuestProgress.objects.for_child(child)
        .filter(status=QuestStatus.ACTIVE)
        .select_related("quest")
        .order_by("-last_updated_at")
        .first()
    )
    if progress is None:
        return None, None
    stages = progress.quest.source.get("stages") if isinstance(progress.quest.source, dict) else []
    stage_title = next(
        (
            s.get("title")
            for s in stages or []
            if isinstance(s, dict) and s.get("id") == progress.current_stage_id
        ),
        None,
    )
    return progress.quest.title, stage_title if isinstance(stage_title, str) else None


@dataclass(frozen=True)
class NpcNarration:
    template_id: str
    allowed_topic: str
    fallback_text: str
    # Authored, published, child-scoped context (apps/ai/services/npc.py); closed labels and
    # titles only. `{}` entries are omitted from the prompt.
    extra: dict = field(default_factory=dict)


def load_npc_narration(npc_id: str, node_id: str, child=None) -> NpcNarration:
    """The authored narration hint of one dialogue node of an active NPC, or ContextNotFound.

    Published catalog content only (`NpcDefinition.active`); a node without a `narration` hint
    was never authored for AI re-voicing and is not found here (the opt-in default of
    `DialogueNode.narration` in react/src/features/npc/types.ts). With
    `LAI_AI_NPC_ENFORCE_ELIGIBILITY` a node whose conditions this child does not meet is not
    found either. Without a `child` (the speech route, which only voices the authored line)
    there is no child-specific context and no eligibility check. The prompt also gets the NPC's
    identity, its Island, Place and 3D Area, this child's own relationship level and active
    quest, all read here, never from the request.
    """
    from . import npc as npc_context

    npc = (
        NpcDefinition.objects.filter(npc_id=npc_id, active=True)
        .select_related("home_location__world")
        .first()
    )
    dialogue = npc.source.get("dialogue") if npc and isinstance(npc.source, dict) else None
    for node in dialogue or []:
        if not isinstance(node, dict) or node.get("id") != node_id:
            continue
        narration = node.get("narration")
        if not isinstance(narration, dict):
            continue
        topic, text = narration.get("allowedTopic"), narration.get("fallbackText")
        if not (
            isinstance(topic, str) and topic.strip() and isinstance(text, str) and text.strip()
        ):
            continue
        extra = {
            "characterName": npc.display_name,
            "characterRole": npc.role or None,
            **npc_context.place_context(npc),
        }
        if child is not None:
            state = npc_context.child_npc_state(child, npc.npc_id)
            if settings.LAI_AI_NPC_ENFORCE_ELIGIBILITY and not npc_context.node_is_eligible(
                node, state
            ):
                raise ContextNotFound
            quest_title, quest_stage_title = active_quest_copy(child)
            extra |= {
                "relationshipLevel": state.relationship_level,
                "hasMetBefore": state.has_met,
                "questTitle": quest_title,
                "questStageTitle": quest_stage_title,
            }
        return NpcNarration(f"npc:{npc.npc_id}", topic, text, extra)
    raise ContextNotFound
