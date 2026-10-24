import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.education.models import SkillEvidence, SkillProgress, StoryArtifact
from apps.game_sessions import services
from apps.progression.models import StoryProgress

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def evidence(child, **source):
    return SkillEvidence.objects.create(
        child=child, learning_objective_code="count-10", evidence_type="ANSWER", result="CORRECT",
        support_level=0, observed_at=timezone.now(), **source,
    )


def test_evidence_comes_from_exactly_one_adventure_session_or_story(families, content_catalog):
    session, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
    now = timezone.now()
    story = StoryProgress.objects.create(child=families.a1, story_slug="ember", current_chapter_id="c1",
                                         started_at=now, last_played_at=now)
    evidence(families.a1, adventure_session=session)
    evidence(families.a1, story_progress=story)
    for bad in ({}, {"adventure_session": session, "story_progress": story}):
        with pytest.raises(IntegrityError), transaction.atomic():
            evidence(families.a1, **bad)


@pytest.mark.parametrize("counts", [
    {"exposure_count": 1, "independent_success_count": 1, "supported_success_count": 1},
    {"exposure_count": 3, "independent_success_count": 1, "consecutive_independent_correct": 2},
])
def test_impossible_skill_counters_are_rejected(families, counts):
    with pytest.raises(IntegrityError), transaction.atomic():
        SkillProgress.objects.create(child=families.a1, learning_objective_code="count-10", **counts)


def test_one_skill_progress_row_per_child_and_objective(families):
    SkillProgress.objects.create(child=families.a1, learning_objective_code="count-10")
    SkillProgress.objects.create(child=families.a2, learning_objective_code="count-10")
    with pytest.raises(IntegrityError), transaction.atomic():
        SkillProgress.objects.create(child=families.a1, learning_objective_code="count-10")


def test_an_artifact_belongs_to_its_session_and_goes_with_the_child(families, content_catalog):
    session, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
    StoryArtifact.objects.create(child=families.a1, adventure_session=session, title="My tale",
                                 scenes=[], created_at=timezone.now())
    families.a1.delete()
    assert StoryArtifact.objects.count() == 0 and SkillEvidence.objects.count() == 0
