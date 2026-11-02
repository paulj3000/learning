"""Bulk regenerate (LAI-AQS-018): reject the chosen questions and queue a fresh batch with the
same specification. Needs both generation and approval permission, and every step is the normal
permission-checked operation."""

from . import contracts, generation, taxonomy, workflow
from .models import GenerationBatch, Question


def regenerate(questions: list[Question], user) -> tuple[GenerationBatch, int]:
    """Returns (new batch, number rejected). Questions that cannot be rejected (published, or
    already rejected) are left alone but still counted in the replacement size."""
    if not questions:
        raise generation.GenerationRefused("nothing_selected", "Select at least one question.")
    first = questions[0]
    same = {(q.subject, q.grade, q.topic, q.question_type) for q in questions}
    if len(same) != 1:
        raise generation.GenerationRefused(
            "mixed_specifications", "Select questions with the same subject, grade, topic and type."
        )
    difficulties = {q.difficulty for q in questions}
    params = contracts.GenerationParams(
        subject=first.subject,
        grade=first.grade,
        topic=first.topic,
        difficulty=difficulties.pop() if len(difficulties) == 1 else taxonomy.MIXED,
        question_type=first.question_type,
        count=len(questions),
        skill_code=first.skill_code,
        adventure_id=first.adventure_id,
    )
    batch = generation.create_batch(user, params)  # checks generation permission and limits first
    _, refused = workflow.bulk(workflow.reject, questions, user, note="regenerated")
    return batch, len(questions) - len(refused)
