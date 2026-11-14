"""Story progress on the server (AMP-03): the Django form of `react/src/features/story/api.ts`.

**No new model.** The record is `StoryProgress`; the definitions are the verified content
export's `stories` collection, read with `catalog.importer.read_export` (the same digest-checked
bundle `load_content` and `discoveries.py` use), so there is no second source of story content.

The client names what the child did (start this story, chose this option, finished this
chapter, reflected on this scene); the server decides what that changes:

- a story starts at its authored entry chapter, once, for a child in a supported age band;
- a flag is set only to a value an authored CHOICE scene offers for that key;
- only the current chapter can be finished, and only once every adventure it embeds has a
  COMPLETED session; the next chapter is the authored one, and finishing the last chapter
  completes the story and records its authored completion world change;
- a reflection records not-applicable evidence for the scene's authored objectives, once per
  story and objective, so a replayed request counts nothing twice.

Each write locks the child's progress row, so concurrent requests serialise.
"""

from functools import lru_cache

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.catalog.importer import read_export
from apps.catalog.models import LearningObjective
from apps.game_sessions.models import AdventureSession, Correctness, SessionKind, SessionStatus

from .models import StoryProgress
from .services import record_world_change

SOURCE_PREFIX = "story:"
REFLECTION_EVIDENCE_TYPE = "REFLECTION"


class UnknownStory(LookupError):
    """Not a story in the content export."""


class StoryNotStarted(LookupError):
    """The child has no progress row for this story yet."""


class StoryUnavailable(Exception):
    """The story is not for this child's age band."""


class StoryRejected(ValueError):
    """The request names something the story does not have, or a step not open yet."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@lru_cache(maxsize=1)
def definitions() -> dict[str, dict]:
    """Story slug -> definition, from the digest-verified content export (read once)."""
    return {story["slug"]: story for story in read_export().collections["stories"]}


def definition(slug: str) -> dict:
    story = definitions().get(slug)
    if story is None:
        raise UnknownStory(slug)
    return story


def _chapter(story: dict, chapter_id: str) -> dict | None:
    return next((c for c in story.get("chapters", []) if c.get("id") == chapter_id), None)


def _scenes(story: dict):
    for chapter in story.get("chapters", []):
        yield from chapter.get("scenes", [])


def _locked(child, slug: str) -> StoryProgress:
    progress = StoryProgress.objects.for_child(child).select_for_update().filter(story_slug=slug)
    row = progress.first()
    if row is None:
        raise StoryNotStarted(slug)
    return row


def start_story(child, slug: str, *, now=None) -> tuple[StoryProgress, bool]:
    """The child's progress for this story, started at its entry chapter if new."""
    story = definition(slug)
    existing = StoryProgress.objects.for_child(child).filter(story_slug=slug).first()
    if existing is not None:
        return existing, False
    if child.age_band not in story.get("supportedAgeBands", []):
        raise StoryUnavailable(slug)
    at = now or timezone.now()
    try:
        with transaction.atomic():
            return StoryProgress.objects.create(
                child=child,
                story_slug=slug,
                current_chapter_id=story["entryChapterId"],
                completed_chapter_ids=[],
                story_flags={},
                started_at=at,
                last_played_at=at,
            ), True
    except IntegrityError:  # a concurrent start won the one-row-per-story constraint
        return StoryProgress.objects.for_child(child).get(story_slug=slug), False


@transaction.atomic
def set_flag(child, slug: str, flag_key: str, flag_value: str, *, now=None) -> StoryProgress:
    story = definition(slug)
    offered = any(
        scene.get("kind") == "CHOICE"
        and scene.get("flagKey") == flag_key
        and any(option.get("flagValue") == flag_value for option in scene.get("options", []))
        for scene in _scenes(story)
    )
    if not offered:
        raise StoryRejected("unknown_choice")
    progress = _locked(child, slug)
    flags = dict(progress.story_flags or {})
    if flags.get(flag_key) != flag_value:
        flags[flag_key] = flag_value
        progress.story_flags = flags
        progress.last_played_at = now or timezone.now()
        progress.save(update_fields=["story_flags", "last_played_at"])
    return progress


@transaction.atomic
def complete_chapter(child, slug: str, chapter_id: str, *, now=None) -> StoryProgress:
    """Finish the current chapter: move to the next one, or complete the story."""
    story = definition(slug)
    chapter = _chapter(story, chapter_id)
    if chapter is None:
        raise StoryRejected("unknown_chapter")
    progress = _locked(child, slug)
    if chapter_id in progress.completed_chapter_ids and (
        progress.completed_at is not None or progress.current_chapter_id != chapter_id
    ):
        return progress  # a replay: already finished, nothing changes
    if progress.completed_at is not None or progress.current_chapter_id != chapter_id:
        raise StoryRejected("chapter_not_current")
    needed = {
        scene["templateSlug"]
        for scene in chapter.get("scenes", [])
        if scene.get("kind") == "ADVENTURE" and scene.get("templateSlug")
    }
    if needed:
        done = set(
            AdventureSession.objects.for_child(child)
            .filter(
                kind=SessionKind.ADVENTURE,
                status=SessionStatus.COMPLETED,
                adventure__slug__in=needed,
            )
            .values_list("adventure__slug", flat=True)
        )
        if needed - done:
            raise StoryRejected("chapter_not_finished")
    at = now or timezone.now()
    progress.completed_chapter_ids = [*progress.completed_chapter_ids, chapter_id]
    progress.last_played_at = at
    following = chapter.get("nextChapterId")
    if following:
        progress.current_chapter_id = following
    else:
        progress.completed_at = at
        change = story.get("completionWorldChange")
        if isinstance(change, dict):
            record_world_change(
                child,
                location_slug=change["locationSlug"],
                change_type=change["changeType"],
                change_key=change["changeKey"],
                source_session_id=f"{SOURCE_PREFIX}{progress.pk}",
                now=at,
            )
    progress.save()
    return progress


@transaction.atomic
def record_reflection(child, slug: str, scene_id: str, *, now=None) -> int:
    """Not-applicable evidence for a REFLECTION scene's objectives. Returns rows written."""
    from apps.education.mastery import apply_evidence
    from apps.education.models import SkillEvidence

    story = definition(slug)
    scene = next(
        (s for s in _scenes(story) if s.get("id") == scene_id and s.get("kind") == "REFLECTION"),
        None,
    )
    if scene is None:
        raise StoryRejected("unknown_scene")
    progress = _locked(child, slug)
    codes = [code for code in dict.fromkeys(scene.get("objectiveIds", [])) if isinstance(code, str)]
    known = set(LearningObjective.objects.filter(code__in=codes).values_list("code", flat=True))
    recorded = set(
        SkillEvidence.objects.for_child(child)
        .filter(story_progress=progress, evidence_type=REFLECTION_EVIDENCE_TYPE)
        .values_list("learning_objective_code", flat=True)
    )
    at = now or timezone.now()
    written = 0
    for code in codes:
        if code not in known or code in recorded:
            continue
        evidence = SkillEvidence.objects.create(
            child=child,
            story_progress=progress,
            learning_objective_code=code,
            evidence_type=REFLECTION_EVIDENCE_TYPE,
            result=Correctness.NOT_APPLICABLE,
            support_level=0,
            observed_at=at,
        )
        apply_evidence(evidence)
        written += 1
    progress.last_played_at = at
    progress.save(update_fields=["last_played_at"])
    return written
