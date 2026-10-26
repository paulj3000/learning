"""Step-adventure availability and the playable session state (LAI-0608).

Read models for the session lifecycle routes. Nothing here decides an answer or moves a session:
`services.py` and `apps.adventures.engine` do that. This module answers two questions:

- *Can this child play this adventure now?* (`availability`). Visibility follows the existing
  rule (`discovery.adventure_entries`, docs/android/ANDROID_API_CONTRACT.md): an adventure that is
  unknown, inactive, under an inactive location or world, missing from the latest content
  release, or not for the child's age band does not exist for this child (`AdventureNotVisible`,
  a 404). A visible adventure can still be unplayable, and then every reason is reported with a
  stable code. A rule that cannot be evaluated counts as failing, never as satisfied.
- *What may the client show?* (`session_view`). The current step goes out through a per-kind
  allow-list of presentation fields, so correct answers, the hint ladder, authored fallbacks
  (which can state the answer) and transitions (which reveal the path) never leave the server.
"""

from dataclasses import dataclass, field

from apps.adventures import engine
from apps.catalog.models import Adventure, AdventureStep, ContentRelease
from apps.game_sessions import services
from apps.game_sessions.models import AdventureSession, SessionKind, SessionStatus

# Reasons a visible adventure cannot be started. Stable: clients branch on them.
CHILD_INACTIVE = "CHILD_INACTIVE"
CONTENT_INCOMPLETE = "CONTENT_INCOMPLETE"
UNSUPPORTED_STEP_KIND = "UNSUPPORTED_STEP_KIND"
PREREQUISITES_NOT_SUPPORTED = "PREREQUISITES_NOT_SUPPORTED"
ACTIVE_SESSION_CONTENT_CHANGED = "ACTIVE_SESSION_CONTENT_CHANGED"

# Presentation fields a client may see, per kind. Anything not listed is withheld. `matching`
# and `short-response` are engine kinds with no exported step yet, so no safe field list has
# been reviewed for them: an adventure using one is UNSUPPORTED_STEP_KIND.
PRESENTATION_FIELDS: dict[str, tuple[str, ...]] = {
    "narrative": ("kind", "speaker", "text", "aiNarrated"),
    "choice": ("kind", "prompt", "options"),
    "creative-choice": ("kind", "prompt", "options"),
    "number-input": ("kind", "prompt"),
    "ordering": ("kind", "prompt", "items"),
    "reflection": ("kind", "prompt"),
    "world-change": ("kind", "text"),
    "complete": ("kind", "text"),
}
OPTION_FIELDS = ("id", "label", "groups")


class AdventureNotVisible(Exception):
    """Unknown, inactive, retired, or not for this child's age band: a 404, like a missing one."""


@dataclass(frozen=True)
class Availability:
    adventure: Adventure
    available: bool
    reasons: list[str] = field(default_factory=list)
    status: str = "AVAILABLE"  # AVAILABLE, IN_PROGRESS, COMPLETED
    active_session: AdventureSession | None = None


def latest_release() -> ContentRelease | None:
    return ContentRelease.objects.order_by("-imported_at", "-id").first()


def visible_adventure(child, adventure_id: str) -> Adventure:
    """The adventure as this child may see it, or `AdventureNotVisible`."""
    adventure = (
        Adventure.objects.select_related("location__world", "world")
        .filter(slug=adventure_id)
        .first()
    )
    release = latest_release()
    if (
        adventure is None
        or release is None
        or not services.is_playable(adventure)
        or (adventure.location is not None and not adventure.location.world.active)
        or adventure.last_seen_release_id != release.pk
        or child.age_band not in adventure.age_bands
    ):
        raise AdventureNotVisible
    return adventure


def current_steps(adventure: Adventure) -> dict[str, AdventureStep]:
    """The adventure's steps from its latest import, by id."""
    steps = AdventureStep.objects.filter(
        adventure=adventure, last_seen_release_id=adventure.last_seen_release_id
    )
    return {step.step_id: step for step in steps}


def content_reasons(adventure: Adventure) -> list[str]:
    steps = current_steps(adventure)
    reasons = []
    if adventure.entry_step_id not in steps:
        reasons.append(CONTENT_INCOMPLETE)
    kinds = {_kind(step) for step in steps.values()}
    if any(kind not in PRESENTATION_FIELDS for kind in kinds):
        reasons.append(UNSUPPORTED_STEP_KIND)
    if adventure.source.get("prerequisites"):
        # Step adventures have no prerequisites in the export today; if one ever does, it is
        # refused until a rule for it exists rather than treated as met.
        reasons.append(PREREQUISITES_NOT_SUPPORTED)
    return reasons


def session_is_current(session: AdventureSession) -> bool:
    """Whether the session can still be played against the catalog's content (no snapshots)."""
    adventure = session.adventure
    if adventure.version != session.template_version:
        return False
    if session.status == SessionStatus.COMPLETED:
        return True
    return AdventureStep.objects.filter(
        adventure=adventure,
        step_id=session.current_step_id,
        last_seen_release_id=adventure.last_seen_release_id,
    ).exists() or session.current_step_id == "complete"


def availability(child, adventure: Adventure) -> Availability:
    sessions = AdventureSession.objects.for_child(child).filter(
        kind=SessionKind.ADVENTURE, adventure=adventure
    )
    active = sessions.filter(status=SessionStatus.ACTIVE).select_related("adventure").first()
    status = (
        "IN_PROGRESS"
        if active
        else "COMPLETED"
        if sessions.filter(status=SessionStatus.COMPLETED).exists()
        else "AVAILABLE"
    )
    reasons = content_reasons(adventure)
    if not child.active:
        reasons.insert(0, CHILD_INACTIVE)
    if active is not None and not session_is_current(active):
        reasons.append(ACTIVE_SESSION_CONTENT_CHANGED)
    return Availability(adventure, not reasons, reasons, status, active)


# --- What the client may see ----------------------------------------------------------------


def _kind(step: AdventureStep) -> str:
    presentation = step.source.get("presentation")
    return presentation.get("kind", "") if isinstance(presentation, dict) else ""


def public_step(step: AdventureStep, hint_level: int) -> dict:
    """One step as a client may render it: allow-listed fields, and only the hint earned so far."""
    presentation = step.source["presentation"]
    allowed = PRESENTATION_FIELDS[presentation["kind"]]
    shown = {key: presentation[key] for key in allowed if key in presentation}
    for list_key in ("options", "items"):
        if list_key in shown:
            shown[list_key] = [
                {key: option[key] for key in OPTION_FIELDS if key in option}
                for option in shown[list_key]
                if isinstance(option, dict)
            ]
    hint = engine.hint_text(step.source, hint_level) if hint_level > 0 else None
    return {
        "stepId": step.step_id,
        "type": step.step_type,
        "objectiveIds": list(step.objective_ids),
        "presentation": shown,
        "hintText": hint,
    }


def session_state(session: AdventureSession) -> dict:
    """The session object every adventure route returns, the LAI-0601 answer and hint routes
    included. `childId` was added in LAI-0608 (additive)."""
    return {
        "id": str(session.pk),
        "childId": str(session.child_id),
        "adventureSlug": session.adventure.slug,
        "templateVersion": session.template_version,
        "status": session.status,
        "currentStepId": session.current_step_id,
        "hintLevel": int(session.hint_levels.get(session.current_step_id, 0)),
        "startedAt": session.started_at.isoformat(),
        "lastActivityAt": session.last_activity_at.isoformat(),
        "completedAt": session.completed_at.isoformat() if session.completed_at else None,
    }


def session_view(session: AdventureSession) -> dict:
    """The lifecycle response: the session, the step to render, progress, and what is allowed."""
    playable = session_is_current(session)
    step = None
    if session.status == SessionStatus.ACTIVE and playable:
        record = AdventureStep.objects.filter(
            adventure=session.adventure,
            step_id=session.current_step_id,
            last_seen_release_id=session.adventure.last_seen_release_id,
        ).first()
        if record is not None and _kind(record) in PRESENTATION_FIELDS:
            step = public_step(record, int(session.hint_levels.get(session.current_step_id, 0)))
    can_complete = session.status == SessionStatus.ACTIVE and services.ends_adventure(
        session, session.current_step_id
    )
    if session.status != SessionStatus.ACTIVE or not playable:
        allowed = []
    elif can_complete:
        allowed = ["COMPLETE"]  # a COMPLETE step takes no answer
    elif step is not None:
        allowed = ["ANSWER", "HINT"]
    else:
        allowed = []
    return {
        "session": session_state(session),
        "step": step,
        "progress": {
            "completedStepIds": services.completed_step_ids(session.child, session.pk),
        },
        "contentCurrent": playable,
        "allowedActions": allowed,
        "canComplete": can_complete,
    }
