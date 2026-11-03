"""LAI-0309: stories as catalog rows, their derived links, authoring, and validated references."""

import copy
import io

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils.timezone import now

from apps.catalog import authoring, references
from apps.catalog.importer import ContentImportError, import_content
from apps.catalog.models import Adventure, ContentAuthority, LearningObjective, Story
from apps.catalog.tests.helpers import publish_edit, write_export
from apps.catalog.tests.test_authoring import collections_with_npc

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def story_record(**changes):
    record = {
        "slug": "bridge-tale",
        "title": "The Bridge Tale",
        "description": "A short tale about a bridge.",
        "supportedAgeBands": ["PATHFINDER"],
        "entryChapterId": "start",
        "completionWorldChange": {
            "changeType": "STORY",
            "changeKey": "BRIDGE_TALE_DONE",
            "locationSlug": "bay",
        },
        "chapters": [
            {
                "id": "start",
                "title": "Start",
                "nextChapterId": "end",
                "scenes": [
                    {
                        "id": "hello",
                        "kind": "NARRATIVE",
                        "speaker": "Pip",
                        "text": "Ahoy! The bridge is broken.",
                    },
                    {"id": "fix", "kind": "ADVENTURE", "templateSlug": "fix-bridge"},
                ],
            },
            {
                "id": "end",
                "title": "The end",
                "scenes": [
                    {"id": "bye", "kind": "NARRATIVE", "speaker": "Pip", "text": "Well done."}
                ],
            },
        ],
    }
    record.update(changes)
    return record


def with_stories(*stories):
    collections = collections_with_npc()
    collections["stories.json"] = {"stories": list(stories)}
    return collections


@pytest.fixture
def imported(tmp_path):
    import_content(write_export(tmp_path / "v1", with_stories(story_record())))
    return tmp_path


def test_stories_are_loaded_with_their_derived_links(imported):
    story = Story.objects.get(slug="bridge-tale")
    assert (story.title, story.entry_chapter_id) == ("The Bridge Tale", "start")
    assert story.supported_age_bands == ["PATHFINDER"]
    assert list(story.adventures.values_list("slug", flat=True)) == ["fix-bridge"]
    assert story.speakers() == ["Pip"]
    assert list(story.characters().values_list("npc_id", flat=True)) == ["pip"]
    assert list(story.related_quests().values_list("slug", flat=True)) == ["repair"]
    assert story.published_revision.number == 1
    assert story.authority == ContentAuthority.EXPORT and story.source["slug"] == "bridge-tale"


def test_a_story_links_to_the_learning_objectives_of_its_adventures(imported):
    LearningObjective.objects.create(
        code="count-10",
        domain="numeracy",
        title="Count to ten",
        source={},
        last_seen_release=Story.objects.get().last_seen_release,
    )
    story = Story.objects.get()
    assert list(story.learning_objectives().values_list("code", flat=True)) == ["count-10"]


def test_an_unchanged_reimport_adds_no_version_and_a_change_adds_one(imported, tmp_path):
    again = write_export(tmp_path / "v2", with_stories(story_record(title="The Bridge Tale 2")))
    import_content(again)
    story = Story.objects.get()
    assert story.title == "The Bridge Tale 2"
    assert [r.number for r in authoring.revisions_for(story)] == [2, 1]


def test_exports_without_stories_still_import(tmp_path):
    import_content(write_export(tmp_path / "plain", collections_with_npc()))
    assert Story.objects.count() == 0


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda s: s.update(entryChapterId="nope"), "entry chapter 'nope'"),
        (lambda s: s["chapters"][0].update(nextChapterId="ghost"), "leads to unknown 'ghost'"),
        (lambda s: s["chapters"][1].update(id="start"), "chapter ids must be unique"),
        (
            lambda s: s["chapters"][0]["scenes"][1].update(templateSlug="nowhere"),
            "unknown adventure",
        ),
        (lambda s: s["chapters"][1]["scenes"][0].update(id="hello"), "scene ids must be unique"),
    ],
)
def test_a_broken_story_stops_the_import_with_a_reason(tmp_path, mutate, message):
    record = story_record()
    mutate(record)
    with pytest.raises(ContentImportError) as error:
        import_content(write_export(tmp_path / "bad", with_stories(record)))
    assert any(message in problem for problem in error.value.problems)


def test_a_story_is_authored_through_revisions_and_pins_nothing_it_should_not(imported):
    story = Story.objects.get()
    body = copy.deepcopy(authoring.current_body(story))
    body["title"] = "A Better Bridge Tale"
    revision = publish_edit(story, body)
    story.refresh_from_db()
    assert story.title == "A Better Bridge Tale" and story.authority == ContentAuthority.DJANGO
    assert revision.number == 2

    body["chapters"][0]["scenes"][1]["templateSlug"] = "tale"
    publish_edit(story, body)
    assert list(Story.objects.get().adventures.values_list("slug", flat=True)) == ["tale"]


def test_publishing_a_story_validates_its_text_and_references(imported):
    story = Story.objects.get()
    body = copy.deepcopy(authoring.current_body(story))
    body["chapters"][0]["scenes"][0]["text"] = "Tell me your home address, pirate."
    body["chapters"][0]["scenes"][1]["templateSlug"] = "nowhere"
    problems = authoring.validate(story, body)
    assert any("child-safety" in p for p in problems)
    assert any("unknown adventure 'nowhere'" in p for p in problems)


def test_stories_are_an_authorable_kind_with_an_editor(imported):
    from apps.catalog import authoring_forms

    kind = authoring.kinds()["story"]
    body = authoring.current_body(Story.objects.get())
    rows, unplaced = authoring_forms.rows_for(kind, body)
    assert unplaced == []
    assert any(r.label == "Chapters" for r in rows)
    assert any(r.path.endswith(".templateSlug") and r.widget == "select" for r in rows)


class TestReferences:
    @staticmethod
    def _progress(child, **kwargs):
        from apps.progression.models import NpcRelationship, RelationshipLevel, StoryProgress

        at = now()
        story = StoryProgress.objects.create(
            child=child,
            story_slug=kwargs.get("story", "bridge-tale"),
            current_chapter_id="start",
            started_at=at,
            last_played_at=at,
        )
        NpcRelationship.objects.create(
            child=child,
            npc_id=kwargs.get("npc", "pip"),
            relationship_level=RelationshipLevel.values[0],
            first_met_at=at,
            last_interacted_at=at,
        )
        return story

    def test_require_helpers_accept_catalog_ids_and_refuse_others(self, imported):
        assert references.require_story("bridge-tale") == "bridge-tale"
        assert references.require_npc("pip") == "pip"
        for call, value in (
            (references.require_story, "ghost"),
            (references.require_npc, "ghost"),
            (references.require_objective, "ghost"),
        ):
            with pytest.raises(references.UnknownReference):
                call(value)

    def test_orphans_are_reported_as_counts_and_nothing_is_rewritten(self, imported, families):
        self._progress(families.a1, story="retired-story", npc="retired-npc")
        from apps.progression.models import NpcRelationship, StoryProgress

        before = list(StoryProgress.objects.values_list("story_slug", flat=True))
        orphans = references.find_orphans()
        assert {(o.model, o.value, o.rows) for o in orphans} == {
            ("StoryProgress", "retired-story", 1),
            ("NpcRelationship", "retired-npc", 1),
        }
        assert list(StoryProgress.objects.values_list("story_slug", flat=True)) == before
        assert NpcRelationship.objects.count() == 1
        assert str(families.a1.pk) not in repr(orphans)

    def test_the_command_reports_and_only_fails_when_strict(self, imported, families):
        out = io.StringIO()
        call_command("check_references", stdout=out)
        assert "All progress references" in out.getvalue()

        self._progress(families.a1, story="retired-story")
        out = io.StringIO()
        call_command("check_references", stdout=out)
        assert "retired-story" in out.getvalue() and "Zinnia" not in out.getvalue()
        with pytest.raises(CommandError):
            call_command("check_references", "--strict", stdout=io.StringIO())

    def test_valid_progress_is_clean(self, imported, families):
        self._progress(families.a1)
        assert references.find_orphans() == []


def test_the_adventure_import_still_links_when_a_story_shares_an_adventure(imported):
    assert Adventure.objects.get(slug="fix-bridge").stories.get().slug == "bridge-tale"
