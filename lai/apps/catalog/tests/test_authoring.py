"""ADR-043: versioned content authoring (LAI-0810), authority-aware import (LAI-0811) and session
version pinning (LAI-0813)."""

import copy
import uuid

import pytest
from django.contrib.contenttypes.models import ContentType

from apps.catalog import authoring
from apps.catalog.importer import import_content
from apps.catalog.models import (
    Adventure,
    AdventureStep,
    ContentAuthority,
    ContentRevision,
    Location,
    Quest,
    RevisionImmutable,
    RevisionOrigin,
    RevisionStatus,
    World,
)
from apps.catalog.tests.helpers import base_collections, write_export
from apps.game_sessions import services
from apps.game_sessions.services import ContentVersionChanged

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def collections_with_npc():
    """The helper export, made schema-valid (publishing validates against the real schema)."""
    collections = base_collections()
    collections["locations.json"]["locations"][0]["decoration"] = "harbor"
    collections["npcs.json"] = {
        "npcs": [
            {
                "id": "pip",
                "displayName": "Pip",
                "role": "Shipwright",
                "homeLocationSlug": "bay",
                "interactionId": "talk-pip",
                "schedule": [],
                "dialogue": [],
                "questOffers": [],
            }
        ]
    }
    return collections


@pytest.fixture
def imported(tmp_path):
    import_content(write_export(tmp_path / "v1", collections_with_npc()))
    return tmp_path


@pytest.fixture
def editor(django_user_model):
    return django_user_model.objects.create(
        cognito_sub=f"admin-{uuid.uuid4()}", admin_username="editor", is_staff=True
    )


def published(row):
    return authoring.revisions_for(row).get(status=RevisionStatus.PUBLISHED)


def edited(row, **changes):
    body = copy.deepcopy(authoring.current_body(row))
    body.update(changes)
    return body


class TestImportRevisions:
    def test_every_imported_record_gets_a_published_first_version(self, imported):
        bay = Location.objects.get(slug="bay")
        revision = published(bay)
        assert (revision.number, revision.origin) == (1, RevisionOrigin.IMPORT)
        assert revision.body == bay.source and bay.published_revision == revision
        assert bay.authority == ContentAuthority.EXPORT
        for model in (World, Adventure, AdventureStep, Quest):
            for row in model.objects.all():
                assert row.published_revision_id is not None

    def test_an_export_change_to_an_export_owned_record_publishes_a_new_version(
        self, imported, tmp_path
    ):
        changed = collections_with_npc()
        changed["locations.json"]["locations"][0]["title"] = "The Busy Bay"
        import_content(write_export(tmp_path / "v2", changed))

        bay = Location.objects.get(slug="bay")
        assert bay.title == "The Busy Bay"
        assert [(r.number, r.status) for r in authoring.revisions_for(bay)] == [
            (2, RevisionStatus.PUBLISHED),
            (1, RevisionStatus.SUPERSEDED),
        ]

    def test_an_unchanged_reimport_adds_no_version(self, imported, tmp_path):
        import_content(write_export(tmp_path / "again", collections_with_npc()), force=True)
        assert authoring.revisions_for(Location.objects.get(slug="bay")).count() == 1


class TestAdminPublishing:
    def test_publishing_a_draft_updates_the_row_and_makes_it_django_owned(self, imported, editor):
        bay = Location.objects.get(slug="bay")
        draft = authoring.create_draft(bay, edited(bay, title="Sunny Bay"), user=editor)
        assert draft.status == RevisionStatus.DRAFT and draft.validation_report == []
        assert Location.objects.get(slug="bay").title == "The Bay"  # a draft changes nothing

        authoring.publish(draft, user=editor)

        bay.refresh_from_db()
        draft.refresh_from_db()
        assert bay.title == "Sunny Bay" and bay.source["title"] == "Sunny Bay"
        assert bay.authority == ContentAuthority.DJANGO and bay.published_revision == draft
        assert draft.published_by == editor and draft.published_at is not None
        assert authoring.revisions_for(bay).get(number=1).status == RevisionStatus.SUPERSEDED

    def test_quest_relations_follow_the_published_body(self, imported):
        quest = Quest.objects.get(slug="repair")
        body = edited(quest)
        body["stages"][0]["objectives"] = [
            {"id": "o1", "label": "Solve", "kind": "SOLVE", "adventureSlug": "tale"}
        ]
        authoring.publish(authoring.create_draft(quest, body))
        assert [a.slug for a in quest.adventures.all()] == ["tale"]

    @pytest.mark.parametrize(
        ("change", "expected"),
        [
            ({"title": "Sunny — Bay"}, "em dash"),
            ({"title": "<b>Bay</b>"}, "plain text"),
            ({"slug": "renamed"}, "never changes"),
            ({"worldSlug": "nowhere"}, "unknown island"),
            ({"skills": "Counting"}, "$.skills"),
        ],
    )
    def test_publishing_refuses_invalid_content_and_changes_nothing(
        self, imported, change, expected
    ):
        bay = Location.objects.get(slug="bay")
        draft = authoring.create_draft(bay, edited(bay, **change))
        assert any(expected in problem for problem in draft.validation_report)

        with pytest.raises(authoring.PublishRefused) as refused:
            authoring.publish(draft)

        assert any(expected in problem for problem in refused.value.problems)
        bay.refresh_from_db()
        assert bay.title == "The Bay" and bay.authority == ContentAuthority.EXPORT
        assert published(bay).number == 1

    def test_an_unknown_quest_reference_is_refused(self, imported):
        quest = Quest.objects.get(slug="repair")
        body = edited(quest, giverNpcId="nobody")
        with pytest.raises(authoring.PublishRefused, match="unknown NPC"):
            authoring.publish(authoring.create_draft(quest, body))


class TestImportNeverOverwritesAdminEdits:
    def _take_over(self):
        bay = Location.objects.get(slug="bay")
        authoring.publish(authoring.create_draft(bay, edited(bay, title="Sunny Bay")))
        return bay

    def test_a_differing_export_is_a_conflict_kept_as_a_draft(self, imported, tmp_path):
        self._take_over()
        changed = collections_with_npc()
        changed["locations.json"]["locations"][0]["title"] = "Export Bay"

        report = import_content(write_export(tmp_path / "v2", changed))

        bay = Location.objects.get(slug="bay")
        assert bay.title == "Sunny Bay" and bay.authority == ContentAuthority.DJANGO
        assert report.counts["locations"]["conflicts"] == 1
        assert report.conflicts == ["place bay"]
        draft = authoring.revisions_for(bay).get(status=RevisionStatus.DRAFT)
        assert draft.origin == RevisionOrigin.IMPORT and draft.body["title"] == "Export Bay"
        assert bay.last_seen_release == report_release(report)

        # The same export again adds no second draft.
        import_content(write_export(tmp_path / "v2", changed), force=True)
        assert authoring.revisions_for(bay).filter(status=RevisionStatus.DRAFT).count() == 1

    def test_an_export_matching_the_django_version_is_skipped(self, imported, tmp_path):
        self._take_over()
        changed = collections_with_npc()
        changed["locations.json"]["locations"][0]["title"] = "Sunny Bay"
        report = import_content(write_export(tmp_path / "v2", changed))
        assert report.counts["locations"]["skipped"] == 1
        assert report.counts["locations"]["conflicts"] == 0

    def test_a_django_owned_quest_keeps_its_relations(self, imported, tmp_path):
        quest = Quest.objects.get(slug="repair")
        authoring.publish(authoring.create_draft(quest, edited(quest, title="Mend it")))
        changed = collections_with_npc()
        changed["quests.json"]["quests"][0]["stages"][0]["objectives"][0]["adventureSlug"] = "tale"
        import_content(write_export(tmp_path / "v2", changed))
        assert [a.slug for a in quest.adventures.all()] == ["fix-bridge"]

    def test_choosing_the_exported_version_returns_the_record_to_the_export(
        self, imported, tmp_path
    ):
        self._take_over()
        changed = collections_with_npc()
        changed["locations.json"]["locations"][0]["title"] = "Export Bay"
        import_content(write_export(tmp_path / "v2", changed))
        bay = Location.objects.get(slug="bay")

        authoring.publish(authoring.revisions_for(bay).get(status=RevisionStatus.DRAFT))

        bay.refresh_from_db()
        assert bay.title == "Export Bay" and bay.authority == ContentAuthority.EXPORT


def report_release(report):
    from apps.catalog.models import ContentRelease

    return ContentRelease.objects.get(pk=report.release_id)


class TestHistory:
    def test_rollback_publishes_an_old_body_as_a_new_version(self, imported):
        bay = Location.objects.get(slug="bay")
        authoring.publish(authoring.create_draft(bay, edited(bay, title="Sunny Bay")))
        first = authoring.revisions_for(bay).get(number=1)

        restored = authoring.rollback(first)

        bay.refresh_from_db()
        assert bay.title == "The Bay"
        assert (restored.number, restored.origin, restored.based_on) == (
            3,
            RevisionOrigin.ROLLBACK,
            first,
        )
        assert [r.status for r in authoring.revisions_for(bay)] == [
            RevisionStatus.PUBLISHED,
            RevisionStatus.SUPERSEDED,
            RevisionStatus.SUPERSEDED,
        ]

    def test_published_versions_are_immutable_and_nothing_is_deleted(self, imported):
        revision = published(Location.objects.get(slug="bay"))
        revision.body = {**revision.body, "title": "Changed"}
        with pytest.raises(RevisionImmutable):
            revision.save()
        with pytest.raises(RevisionImmutable):
            revision.delete()
        superseded = ContentRevision.objects.get(pk=revision.pk)
        superseded.status = RevisionStatus.DRAFT
        with pytest.raises(RevisionImmutable):
            superseded.save()

    def test_drafts_are_kept_when_discarded(self, imported):
        bay = Location.objects.get(slug="bay")
        draft = authoring.create_draft(bay, edited(bay, title="Maybe"))
        authoring.discard(draft)
        assert ContentRevision.objects.get(pk=draft.pk).status == RevisionStatus.DISCARDED
        with pytest.raises(authoring.PublishRefused):
            authoring.publish(draft)

    def test_one_published_version_per_record_is_a_database_rule(self, imported):
        from django.db import IntegrityError, transaction

        bay = Location.objects.get(slug="bay")
        with pytest.raises(IntegrityError), transaction.atomic():
            ContentRevision.objects.create(
                kind="place",
                content_type=ContentType.objects.get_for_model(Location),
                object_id=str(bay.pk),
                record_key="bay",
                number=9,
                body=bay.source,
                status=RevisionStatus.PUBLISHED,
                origin=RevisionOrigin.ADMIN,
            )


class TestSessionPinning:
    """LAI-0813: an active session keeps the content it started with."""

    def _publish_new_answer(self, value):
        step = AdventureStep.objects.get(adventure__slug="fix-bridge", step_id="count")
        body = copy.deepcopy(step.source)
        body["presentation"]["correctValue"] = value
        authoring.publish(authoring.create_draft(step, body))

    def _answer(self, child, session, value):
        return services.submit_answer(
            child,
            session.pk,
            step_id="count",
            answer={"kind": "number-input", "value": value},
            request_id=uuid.uuid4(),
        )

    def test_a_publish_during_a_session_does_not_change_its_grading(self, imported, families):
        bridge = Adventure.objects.get(slug="fix-bridge")
        session, _ = services.start_or_resume_session(families.a1, bridge)
        assert session.pinned_revisions.count() == 1 + bridge.steps.count()

        self._publish_new_answer(5)

        assert self._answer(families.a1, session, 3).correctness == "CORRECT"
        later, _ = services.start_or_resume_session(families.a2, bridge)
        assert self._answer(families.a2, later, 5).correctness == "CORRECT"

    def test_a_session_without_pins_keeps_the_old_refusal(self, imported, families):
        bridge = Adventure.objects.get(slug="fix-bridge")
        session, _ = services.start_or_resume_session(families.a1, bridge)
        session.pinned_revisions.clear()
        Adventure.objects.filter(pk=bridge.pk).update(version=2)
        with pytest.raises(ContentVersionChanged):
            self._answer(families.a1, session, 3)

    def test_body_for_falls_back_to_the_published_body(self, imported):
        bay = Location.objects.get(slug="bay")
        assert authoring.body_for(None, bay) == bay.source
