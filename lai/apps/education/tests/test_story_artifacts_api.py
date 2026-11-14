"""Saved stories and derived skill progress (AMP-03). Real content export, two families."""

import uuid

import pytest

from apps.catalog.importer import import_content
from apps.catalog.models import Adventure
from apps.education.models import StoryArtifact
from apps.game_sessions import services as sessions

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

SLUG = "the-dark-lighthouse-counting"


@pytest.fixture
def content(families):
    import_content()
    return families


def url(child, rest: str) -> str:
    return f"/api/v1/children/{child.pk}/{rest}"


def session_for(child):
    session, _ = sessions.start_or_resume_session(child, Adventure.objects.get(slug=SLUG))
    return session


def save(client, child, session_id, scenes=None):
    return client.post(
        url(child, "story-artifacts/"),
        {
            "sessionId": str(session_id),
            "scenes": scenes
            or [{"stepId": "the-lamp-is-dark", "text": "The lamp went dark.", "source": "AI"}],
        },
        "application/json",
    )


def test_a_story_is_saved_once_per_session_with_the_catalog_title(content, api):
    client = api(content.a)
    session = session_for(content.a1)
    first = save(client, content.a1, session.pk)
    assert first.status_code == 201
    body = first.json()
    assert body["title"] == Adventure.objects.get(slug=SLUG).title
    assert body["templateSlug"] == SLUG
    assert body["scenes"] == [
        {"stepId": "the-lamp-is-dark", "text": "The lamp went dark.", "source": "AI"}
    ]
    again = save(client, content.a1, session.pk)
    assert again.status_code == 200
    assert again.json()["id"] == body["id"]
    assert StoryArtifact.objects.count() == 1
    listed = client.get(url(content.a1, "story-artifacts/")).json()["artifacts"]
    assert [a["id"] for a in listed] == [body["id"]]


@pytest.mark.parametrize(
    "scenes",
    [
        [{"stepId": "not-a-step", "text": "Hi", "source": "AI"}],
        [{"stepId": "the-lamp-is-dark", "text": "Hi", "source": "CHILD"}],
        [{"stepId": "the-lamp-is-dark", "text": "x" * 601, "source": "AI"}],
        [{"stepId": "the-lamp-is-dark", "text": "Hi", "source": "AI", "title": "Mine"}],
    ],
)
def test_malformed_scenes_are_refused(content, api, scenes):
    response = save(api(content.a), content.a1, session_for(content.a1).pk, scenes)
    assert response.status_code == 400
    assert not StoryArtifact.objects.exists()


def test_text_that_breaks_the_output_boundaries_is_refused(content, api):
    scenes = [
        {"stepId": "the-lamp-is-dark", "text": "Visit https://example.com now", "source": "AI"}
    ]
    response = save(api(content.a), content.a1, session_for(content.a1).pk, scenes)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "story_scene_rejected"


def test_a_story_cannot_be_saved_against_another_childs_session(content, api):
    theirs = session_for(content.b1)
    assert save(api(content.a), content.a1, theirs.pk).status_code == 404
    assert save(api(content.a), content.a1, uuid.uuid4()).status_code == 404
    assert save(api(content.a), content.b1, theirs.pk).status_code == 404
    sibling = session_for(content.a2)
    assert save(api(content.a), content.a1, sibling.pk).status_code == 404
    assert not StoryArtifact.objects.exists()


def test_a_parent_deletes_only_their_own_childs_story(content, api):
    mine = save(api(content.a), content.a1, session_for(content.a1).pk).json()["id"]
    theirs = save(api(content.b), content.b1, session_for(content.b1).pk).json()["id"]
    assert api(content.a).delete(url(content.a1, f"story-artifacts/{theirs}/")).status_code == 404
    assert api(content.a).delete(url(content.b1, f"story-artifacts/{theirs}/")).status_code == 404
    assert api(content.a).delete(url(content.a1, f"story-artifacts/{mine}/")).status_code == 204
    assert list(StoryArtifact.objects.values_list("pk", flat=True)) == [uuid.UUID(theirs)]


def test_skill_progress_is_derived_from_server_graded_answers(content, api):
    client = api(content.a)
    session = session_for(content.a1)
    for step, payload in [
        ("the-lamp-is-dark", {"kind": "narrative"}),
        ("count-the-slots", {"kind": "choice", "optionId": "three"}),
    ]:
        client.post(
            url(content.a1, f"sessions/{session.pk}/answers/"),
            {"stepId": step, "answer": payload, "requestId": str(uuid.uuid4())},
            "application/json",
        )
    skills = client.get(url(content.a1, "skill-progress/")).json()["skills"]
    assert [s["learningObjectiveCode"] for s in skills] == ["counting-sets"]
    assert skills[0]["independentSuccessCount"] == 1
    assert client.get(url(content.a2, "skill-progress/")).json() == {"skills": []}
    assert client.get(url(content.b1, "skill-progress/")).status_code == 404
    # There is no way to write mastery numbers.
    assert (
        client.post(url(content.a1, "skill-progress/"), {}, "application/json").status_code == 405
    )
