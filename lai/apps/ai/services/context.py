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

from dataclasses import dataclass
from uuid import UUID

from apps.adventures import engine
from apps.catalog.models import AdventureStep
from apps.education.models import SkillProgress
from apps.game_sessions.models import AdventureSession, SessionKind
from apps.quests.models import QuestProgress, QuestStatus

from ..tutor_content import KNOWN_STATUSES, list_prerequisites


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
    return SessionStep(
        template_id=session.adventure.slug,
        session_id=str(session.pk),
        step_id=step.step_id,
        step_source=step.source if isinstance(step.source, dict) else {},
        objective_ids=tuple(step.objective_ids or ()),
        hint_level=int((session.hint_levels or {}).get(step.step_id, 0)),
    )


def prerequisite_mastery(child, skill_id: str) -> list[dict]:
    """`[{skillId, status}]` for this skill's prerequisites the child has reached; statuses only.

    `SkillProgress.recent_level` is the server's status column. Until LAI-0603 computes it on
    the server it is usually empty, which only means fewer "known" titles (never more).
    """
    prerequisite_ids = [skill.id for skill in list_prerequisites(skill_id)]
    if not prerequisite_ids:
        return []
    rows = SkillProgress.objects.for_child(child).filter(
        learning_objective_code__in=prerequisite_ids, recent_level__in=KNOWN_STATUSES
    )
    return [{"skillId": r.learning_objective_code, "status": r.recent_level} for r in rows]


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
