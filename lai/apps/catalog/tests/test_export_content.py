"""LAI-0814: export of published content, the content checks, and promotion between environments."""

import copy
import io
import json

import pytest
from django.contrib.contenttypes.models import ContentType
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.catalog import authoring, export
from apps.catalog.importer import ContentImportError, import_content
from apps.catalog.models import (
    Adventure,
    ContentAuthority,
    ContentRevision,
    Location,
    RevisionOrigin,
    RevisionStatus,
    Story,
)
from apps.catalog.tests.helpers import publish_edit, staff_user, write_export
from apps.catalog.tests.test_authoring import collections_with_npc
from apps.catalog.tests.test_story_catalog import story_record

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def collections():
    data = collections_with_npc()
    data["stories.json"] = {"stories": [story_record()]}
    data["rewards.json"] = {
        "collectibleSets": [],
        "items": [
            {
                "id": "badge",
                "displayName": "Badge",
                "description": "A badge.",
                "category": "KEEPSAKE",
                "rarity": "COMMON",
            }
        ],
        "rewardRules": [
            {
                "id": "badge-rule",
                "message": "Nice!",
                "itemIds": ["badge"],
                "trigger": {"type": "QUEST_COMPLETED", "questId": "repair"},
            }
        ],
    }
    data["adventures.json"]["learningObjectives"] = [
        {"code": "count-10", "domain": "numeracy", "title": "Count to ten"}
    ]
    data["adventures.json"]["wonderWallQuestions"] = []
    pack = data["islands.json"]["islands"][0]["pack"]
    pack.update(
        itemIds=["badge"],
        collectibleSetIds=[],
        npcIds=["pip"],
        discoveryIds=[],
        storySlugs=["bridge-tale"],
    )
    data["assets.json"]["assets"] = []
    data["assets.json"]["locationAssets"] = []
    return data


@pytest.fixture
def imported(tmp_path):
    import_content(write_export(tmp_path / "v1", collections()))
    return tmp_path


def manifest_of(directory):
    return json.loads((directory / "manifest.json").read_text())


def files_of(directory):
    return {p.name: p.read_bytes() for p in sorted(directory.glob("*.json"))}


class TestBuildAndWrite:
    def test_the_same_published_content_always_gives_the_same_bytes(self, imported):
        export.write_export(export.build_export(), imported / "a")
        export.write_export(export.build_export(), imported / "b")
        assert files_of(imported / "a") == files_of(imported / "b")
        assert (
            manifest_of(imported / "a")["contentDigest"]
            == manifest_of(imported / "b")["contentDigest"]
        )

    def test_the_manifest_lists_every_record_with_revision_owner_dependencies_and_checksum(
        self, imported
    ):
        manifest = export.write_export(export.build_export(), imported / "out")
        by_id = {(r["kind"], r["id"]): r for r in manifest["records"]}
        quest = by_id[("quest", "repair")]
        assert quest["revision"]["number"] == 1 and quest["authority"] == "EXPORT"
        assert quest["draft"] is False and quest["publishedAt"]
        assert "adventure:fix-bridge" in quest["dependsOn"] and "npc:pip" in quest["dependsOn"]
        assert "adventure:fix-bridge" in by_id[("story", "bridge-tale")]["dependsOn"]
        assert set(by_id) >= {
            ("island", "home-island"),
            ("place", "bay"),
            ("adventure", "fix-bridge"),
            ("learning-objective", "count-10"),
            ("npc", "pip"),
            ("item", "badge"),
            ("reward-rule", "badge-rule"),
        }
        assert manifest["excludesDrafts"] is True
        assert manifest["notExported"] == {"adventures.json": ["wonderWallQuestions"]}

    def test_adventures_carry_their_steps_in_order(self, imported):
        export.write_export(export.build_export(), imported / "out")
        adventures = json.loads((imported / "out" / "adventures.json").read_text())["adventures"]
        bridge = next(a for a in adventures if a["slug"] == "fix-bridge")
        assert [s["id"] for s in bridge["steps"]] == ["count", "done"]

    def test_only_published_content_is_exported_by_default(self, imported):
        staff = staff_user()
        bay = Location.objects.get(slug="bay")
        body = copy.deepcopy(authoring.current_body(bay))
        body["title"] = "Draft Bay"
        draft = authoring.create_draft(bay, body, user=staff)
        authoring.submit(draft, user=staff)

        plan = export.build_export()
        titles = [loc["title"] for loc in plan.collections["locations.json"]["locations"]]
        assert titles == ["The Bay"]
        assert not any(r.draft for r in plan.records)

        with_drafts = export.build_export(include_drafts=True)
        assert [loc["title"] for loc in with_drafts.collections["locations.json"]["locations"]] == [
            "Draft Bay"
        ]
        assert [r.key for r in with_drafts.records if r.draft] == ["bay"]
        manifest = export.write_export(with_drafts, imported / "review")
        assert manifest["excludesDrafts"] is False

    def test_a_row_without_a_published_version_stops_the_export(self, imported):
        Location.objects.filter(slug="bay").update(published_revision=None)
        plan = export.build_export()
        assert plan.problems == ["place bay: no published version"]


class TestChecks:
    def test_clean_content_passes(self, imported):
        report = export.check_content()
        assert report.errors == [] and report.checked >= 8

    def test_a_row_that_no_longer_matches_its_published_version_is_an_error(self, imported):
        Location.objects.filter(slug="bay").update(source={"slug": "bay", "title": "Tampered"})
        report = export.check_content()
        assert any("place bay: the row no longer matches" in e for e in report.errors)

    def test_legacy_content_that_fails_the_safety_screen_is_reported(self, imported):
        bay = Location.objects.get(slug="bay")
        bad = {**bay.source, "tagline": "Please tell me your home address"}
        ContentRevision.objects.filter(pk=bay.published_revision_id).update(body=bad)
        Location.objects.filter(pk=bay.pk).update(source=bad)
        assert any("child-safety" in e for e in export.check_content().errors)

    def test_a_dangling_reference_is_an_error(self, imported):
        from apps.catalog.models import ItemDefinition

        ItemDefinition.objects.filter(item_id="badge").delete()
        report = export.check_content()
        assert any("badge" in e for e in report.errors)

    def test_orphaned_progress_is_a_warning_not_an_error(self, imported, families):
        from django.utils.timezone import now

        from apps.progression.models import StoryProgress

        StoryProgress.objects.create(
            child=families.a1,
            story_slug="retired",
            current_chapter_id="x",
            started_at=now(),
            last_played_at=now(),
        )
        report = export.check_content()
        assert report.errors == [] and any("retired" in w for w in report.warnings)

    def test_the_command_reports_and_fails_on_errors_only(self, imported):
        out = io.StringIO()
        call_command("check_content", stdout=out)
        assert "0 error(s)" in out.getvalue()
        Location.objects.filter(slug="bay").update(source={"slug": "bay"})
        with pytest.raises(CommandError):
            call_command("check_content", stdout=io.StringIO())

    def test_open_drafts_are_noted(self, imported):
        bay = Location.objects.get(slug="bay")
        authoring.create_draft(bay, authoring.current_body(bay), user=staff_user())
        out = io.StringIO()
        call_command("check_content", stdout=out)
        assert "open draft for place bay" in out.getvalue()


class TestExportCommand:
    def test_it_writes_after_a_clean_check(self, imported):
        out = io.StringIO()
        call_command("export_content", "--out", str(imported / "out"), stdout=out)
        assert "Wrote" in out.getvalue() and (imported / "out" / "manifest.json").exists()

    def test_it_refuses_to_write_when_the_check_finds_an_error(self, imported):
        Location.objects.filter(slug="bay").update(source={"slug": "bay"})
        with pytest.raises(CommandError):
            call_command(
                "export_content",
                "--out",
                str(imported / "never"),
                stdout=io.StringIO(),
                stderr=io.StringIO(),
            )
        assert not (imported / "never").exists()


class TestPromotion:
    def _publish_edit(self):
        bay = Location.objects.get(slug="bay")
        body = copy.deepcopy(authoring.current_body(bay))
        body["title"] = "Sunny Bay"
        publish_edit(bay, body)

    def test_the_importer_accepts_an_exported_directory_and_the_manifest_verifies(self, imported):
        self._publish_edit()
        export.write_export(export.build_export(), imported / "out")
        export.verify_manifest_records(imported / "out")  # does not raise
        report = import_content(imported / "out", dry_run=True)
        assert report.status == "dry-run"
        # Django-owned and identical to what the export holds: nothing to apply, no conflict.
        assert report.conflicts == []

    @pytest.mark.django_db(transaction=True)
    def test_a_second_environment_receives_the_content_as_new_published_records(self, imported):
        self._publish_edit()
        export.write_export(export.build_export(), imported / "out")

        call_command("flush", interactive=False, verbosity=0)
        ContentType.objects.clear_cache()
        assert Location.objects.count() == 0

        export.verify_manifest_records(imported / "out")
        report = import_content(imported / "out")
        assert report.status == "imported" and report.conflicts == []
        bay = Location.objects.get(slug="bay")
        assert bay.title == "Sunny Bay"
        assert bay.authority == ContentAuthority.EXPORT  # the target tracks the export
        assert authoring.revisions_for(bay).get().origin == RevisionOrigin.IMPORT
        assert [s.step_id for s in Adventure.objects.get(slug="fix-bridge").steps.all()] == [
            "count",
            "done",
        ]
        assert list(Story.objects.get().adventures.values_list("slug", flat=True)) == ["fix-bridge"]

        again = import_content(imported / "out")  # repeatable
        assert again.status == "unchanged"

    @pytest.mark.django_db(transaction=True)
    def test_a_record_edited_in_the_target_is_reported_not_overwritten(self, imported):
        bay = Location.objects.get(slug="bay")
        body = copy.deepcopy(authoring.current_body(bay))
        body["title"] = "Source Bay"
        publish_edit(bay, body)
        export.write_export(export.build_export(), imported / "out")

        # The target environment's administrator has their own edit of the same record.
        edit = copy.deepcopy(authoring.current_body(bay))
        edit["title"] = "Target Bay"
        publish_edit(bay, edit)

        report = import_content(imported / "out", dry_run=True)
        assert report.conflicts == ["place bay"]
        assert Location.objects.get(slug="bay").title == "Target Bay"

        # ...and "Use the exported version" is how the target takes it deliberately.
        import_content(imported / "out", force=True)
        draft = authoring.use_exported_version(Location.objects.get(slug="bay"), user=staff_user())
        assert draft.status == RevisionStatus.DRAFT and draft.body["title"] == "Source Bay"

    def test_a_tampered_file_fails_the_integrity_check(self, imported):
        export.write_export(export.build_export(), imported / "out")
        path = imported / "out" / "locations.json"
        data = json.loads(path.read_text())
        data["locations"][0]["title"] = "Changed in transit"
        path.write_text(json.dumps(data))
        with pytest.raises(ContentImportError) as error:
            export.verify_manifest_records(imported / "out")
        assert any("checksum differs" in p for p in error.value.problems)

    def test_a_record_missing_from_the_files_fails_the_integrity_check(self, imported):
        export.write_export(export.build_export(), imported / "out")
        path = imported / "out" / "npcs.json"
        data = json.loads(path.read_text())
        data["npcs"] = []
        path.write_text(json.dumps(data))
        with pytest.raises(ContentImportError) as error:
            export.verify_manifest_records(imported / "out")
        assert any(
            "npc pip: listed in the manifest but not in the files" in p
            for p in error.value.problems
        )

    def test_the_typescript_export_has_no_records_list_and_verifies_trivially(self, imported):
        export.verify_manifest_records(imported / "v1")

    def test_load_content_runs_the_integrity_check_first(self, imported):
        export.write_export(export.build_export(), imported / "out")
        path = imported / "out" / "locations.json"
        data = json.loads(path.read_text())
        data["locations"][0]["title"] = "Changed in transit"
        path.write_text(json.dumps(data))
        with pytest.raises(CommandError):
            call_command(
                "load_content",
                "--path",
                str(imported / "out"),
                "--dry-run",
                stdout=io.StringIO(),
                stderr=io.StringIO(),
            )
