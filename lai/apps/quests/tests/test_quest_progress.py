import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.game_sessions.services import InvalidTransition, ProgressNotFound
from apps.quests import services
from apps.quests.models import QuestProgress, QuestStatus

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def save(child, progress, **state):
    defaults = dict(status=QuestStatus.ACTIVE, current_stage_id="s1", completed_stage_ids=[],
                    completed_objective_ids=[])
    return services.save_quest_state(child, progress.pk, **{**defaults, **state})


def test_one_quest_progress_spans_every_adventure_the_quest_names(families, content_catalog):
    quest = content_catalog.quest
    assert {a.slug for a in quest.adventures.all()} == {"fix-bridge", "stack-planks"}

    progress, created = services.start_quest(families.a1, quest)
    assert created and progress.current_stage_id == "s1"
    save(families.a1, progress, current_stage_id="s2", completed_stage_ids=["s1"],
         completed_objective_ids=["o1"])
    done = save(families.a1, progress, status=QuestStatus.COMPLETED, current_stage_id="s2",
                completed_stage_ids=["s1", "s2"], completed_objective_ids=["o1", "o2"])

    assert done.status == QuestStatus.COMPLETED and done.completed_at is not None
    assert QuestProgress.objects.for_child(families.a1).count() == 1


def test_starting_a_quest_twice_returns_the_same_progress(families, content_catalog):
    first, _ = services.start_quest(families.a1, content_catalog.quest)
    again, created = services.start_quest(families.a1, content_catalog.quest)
    assert again == first and not created
    with pytest.raises(IntegrityError), transaction.atomic():
        QuestProgress.objects.create(
            child=families.a1, quest=content_catalog.quest, status=QuestStatus.ACTIVE,
            current_stage_id="s1", started_at=timezone.now(), last_updated_at=timezone.now(),
        )


@pytest.mark.parametrize("state", [
    {"current_stage_id": "nowhere"},
    {"completed_stage_ids": ["s9"]},
    {"completed_objective_ids": ["not-an-objective"]},
])
def test_ids_that_are_not_the_quests_own_are_refused(families, content_catalog, state):
    progress, _ = services.start_quest(families.a1, content_catalog.quest)
    with pytest.raises(InvalidTransition):
        save(families.a1, progress, **state)


def test_progress_only_grows_and_a_completed_quest_never_changes(families, content_catalog):
    progress, _ = services.start_quest(families.a1, content_catalog.quest)
    save(families.a1, progress, current_stage_id="s2", completed_stage_ids=["s1"],
         completed_objective_ids=["o1"])
    with pytest.raises(InvalidTransition):
        save(families.a1, progress, current_stage_id="s1")  # drops the completed stage

    save(families.a1, progress, status=QuestStatus.COMPLETED, current_stage_id="s2",
         completed_stage_ids=["s1", "s2"], completed_objective_ids=["o1", "o2"])
    with pytest.raises(InvalidTransition):
        save(families.a1, progress, current_stage_id="s2", completed_stage_ids=["s1", "s2"],
             completed_objective_ids=["o1", "o2"])


def test_another_childs_quest_progress_is_not_found(families, content_catalog):
    progress, _ = services.start_quest(families.a1, content_catalog.quest)
    for intruder in (families.a2, families.b1):
        with pytest.raises(ProgressNotFound):
            save(intruder, progress)
    progress.refresh_from_db()
    assert progress.completed_stage_ids == []


def test_the_database_ties_completion_time_to_status(families, content_catalog):
    progress, _ = services.start_quest(families.a1, content_catalog.quest)
    with pytest.raises(IntegrityError), transaction.atomic():
        QuestProgress.objects.filter(pk=progress.pk).update(status=QuestStatus.COMPLETED)
