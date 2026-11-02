"""Fixtures for the Question Studio tests. The model is always the fake client."""

import pytest
from django.contrib.auth.models import Permission
from django.core.cache import cache

from apps.ai.providers import override_model_client
from apps.ai.providers.fake import FakeModelClient
from apps.question_studio import contracts
from apps.question_studio.models import Question


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.clear()
    yield
    cache.clear()


def make_staff(username, *codenames, superuser=False):
    from apps.core.tests.test_django_admin import make_admin

    user, _password = make_admin(username, superuser=superuser)
    perms = Permission.objects.filter(
        content_type__app_label="question_studio", codename__in=codenames
    )
    assert perms.count() == len(codenames), codenames
    user.user_permissions.set(perms)
    return user


@pytest.fixture
def author(db):
    return make_staff(
        "author",
        "add_generationbatch",
        "view_generationbatch",
        "view_question",
        "change_question",
        "add_question",
    )


@pytest.fixture
def reviewer(db):
    return make_staff(
        "reviewer", "view_question", "change_question", "approve_question", "view_questionrevision"
    )


@pytest.fixture
def publisher(db):
    return make_staff(
        "publisher",
        "view_question",
        "publish_question",
        "retire_revision",
        "change_question",
        "approve_question",
        "view_questionrevision",
    )


@pytest.fixture
def nobody(db):
    return make_staff("nobody")


@pytest.fixture
def fake():
    client = FakeModelClient()
    with override_model_client(client):
        yield client


def params(**overrides):
    base = dict(
        subject="MATH",
        grade="3",
        topic="multiplication",
        difficulty="MIXED",
        question_type="MULTIPLE_CHOICE",
        count=5,
        skill_code="multiplication-facts",
    )
    base.update(overrides)
    return contracts.GenerationParams(**base)


def make_question(**overrides) -> Question:
    base = dict(
        subject="MATH",
        grade="3",
        topic="multiplication",
        skill_code="multiplication-facts",
        difficulty="EASY",
        question_type="MULTIPLE_CHOICE",
        stem="What is 6 x 7?",
        choices=[{"id": "A", "text": "42"}, {"id": "B", "text": "36"}, {"id": "C", "text": "48"}],
        correct_answer="A",
        operation="MULTIPLY",
        operands=[6, 7],
        hint="Count in sixes.",
        explanation="Six sevens make forty two.",
    )
    base.update(overrides)
    return Question.objects.create(**base)


@pytest.fixture
def release(db):
    from apps.catalog.models import ContentRelease

    return ContentRelease.objects.create(
        content_digest="d" * 64, schema_version=1, export_tool="test", files=[], report={}
    )


def publish_questions(
    reviewer,
    publisher,
    count,
    *,
    grade="3",
    topic="multiplication",
    operation="MULTIPLY",
    skill="multiplication-facts",
    adventure=None,
    start=2,
    question_type="MULTIPLE_CHOICE",
):
    """`count` distinct, valid, approved and published questions. Returns their revisions."""
    from apps.question_studio import validation, workflow

    symbols = {"MULTIPLY": "x", "ADD": "+", "SUBTRACT": "-"}
    revisions = []
    for index in range(count):
        a, b = start + index, 3 + index
        answer = {"MULTIPLY": a * b, "ADD": a + b, "SUBTRACT": a + b - a}[operation]
        if operation == "SUBTRACT":
            a, b, answer = a + b, b, a
        choices = [
            {"id": letter, "text": str(answer + delta)}
            for letter, delta in zip("ABC", (0, 1, -1), strict=True)
        ]
        q = make_question(
            grade=grade,
            topic=topic,
            operation=operation,
            operands=[a, b],
            skill_code=skill,
            stem=f"What is {a} {symbols[operation]} {b}?",
            question_type=question_type,
            choices=choices if question_type == "MULTIPLE_CHOICE" else [],
            correct_answer="A" if question_type == "MULTIPLE_CHOICE" else str(answer),
            adventure=adventure,
        )
        validation.run_validation(q)
        workflow.approve(q, reviewer)
        revisions.append(workflow.publish(q, publisher))
    return revisions


@pytest.fixture
def objective(release):
    from apps.catalog.models import LearningObjective

    return LearningObjective.objects.create(
        code="multiplication-facts",
        domain="math",
        title="Multiplication facts",
        source={},
        last_seen_release=release,
    )
