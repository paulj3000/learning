"""LAI-0818: child-facing publication safety (ADR-047 D and E).

Covers content-safety screening, per-age-band copy limits, service-level permission checks
(every bypass attempt), the submit / return / approve workflow, the optional independent
approval setting, admin-log entries, and the named-session confirmation before retirement.
"""

import copy
import uuid

import pytest
from django.contrib.admin.models import LogEntry
from django.contrib.auth.models import Permission
from django.utils.timezone import now

from apps.catalog import authoring
from apps.catalog.importer import import_content
from apps.catalog.models import (
    Adventure,
    AdventureStep,
    ContentRevision,
    Location,
    RevisionStatus,
)
from apps.catalog.tests.helpers import staff_user, write_export
from apps.catalog.tests.test_authoring import collections_with_npc
from apps.game_sessions import services
from apps.users.models import ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def bay(tmp_path):
    import_content(write_export(tmp_path / "v1", collections_with_npc()))
    return Location.objects.get(slug="bay")


def person(name, *codenames, staff=True, active=True):
    account = ParentAccount.objects.create(
        cognito_sub=f"django-admin-only:{name}-{uuid.uuid4()}",
        admin_username=f"{name[:12]}-{uuid.uuid4().hex[:8]}",
        is_staff=staff,
        is_active=active,
    )
    for codename in codenames:
        account.user_permissions.add(Permission.objects.get(codename=codename))
    return account


def author():
    return person("author", "edit_content_draft")


def approver():
    return person("approver", "edit_content_draft", "publish_content")


def body_of(row, **changes):
    body = copy.deepcopy(authoring.current_body(row))
    body.update(changes)
    return body


class TestSafetyScreening:
    @pytest.mark.parametrize(
        ("text", "category"),
        [
            ("What is your home address?", "personal-information"),
            ("Please keep this between us.", "secrecy"),
            ("I am your teacher now.", "person-impersonation"),
            ("Call me on 555-123-4567.", "contact-details"),
            ("You passed the test.", "learning-judgment"),
        ],
    )
    def test_unsafe_child_text_is_refused_with_its_category(self, bay, text, category):
        user = author()
        draft = authoring.create_draft(bay, body_of(bay, tagline=text), user=user)
        assert any(category in problem for problem in draft.validation_report), (
            draft.validation_report
        )

    def test_a_web_address_without_a_scheme_is_refused(self, bay):
        problems = authoring.validate(bay, body_of(bay, tagline="Visit pirates.com today"))
        assert any("web addresses" in problem for problem in problems)

    def test_publish_and_submit_refuse_unsafe_text_and_change_nothing(self, bay):
        user = approver()
        draft = authoring.create_draft(
            bay, body_of(bay, tagline="Don't tell your family about this."), user=user
        )
        with pytest.raises(authoring.PublishRefused) as refused:
            authoring.submit(draft, user=user)
        assert any("secrecy" in p for p in refused.value.problems)
        with pytest.raises(authoring.PublishRefused):
            authoring.publish(draft, user=user)
        bay.refresh_from_db()
        assert bay.published_revision.number == 1
        assert ContentRevision.objects.get(pk=draft.pk).status == RevisionStatus.DRAFT

    def test_ordinary_child_text_passes(self, bay):
        assert authoring.validate(bay, body_of(bay, tagline="A sunny harbor full of boats.")) == []


class TestAgeBandLimits:
    def test_text_under_a_band_list_uses_the_shortest_band_limit(self):
        sprout = {"lines": [{"ageBands": ["SPROUT"], "text": "x" * 161}]}
        assert authoring.copy_problems(sprout, ("lines",)) == [
            "$.lines[0].text: longer than 160 characters"
        ]
        mixed = {"lines": [{"ageBands": ["EXPLORER", "SPROUT"], "text": "x" * 161}]}
        assert len(authoring.copy_problems(mixed, ("lines",))) == 1

    def test_explorer_text_keeps_the_general_limit(self):
        explorer = {"lines": [{"ageBands": ["EXPLORER"], "text": "x" * 500}]}
        assert authoring.copy_problems(explorer, ("lines",)) == []
        too_long = {"lines": [{"ageBands": ["EXPLORER"], "text": "x" * 601}]}
        assert len(authoring.copy_problems(too_long, ("lines",))) == 1

    def test_text_outside_a_band_list_uses_the_general_limit(self):
        assert authoring.copy_problems({"text": "x" * 300}, ("",)) == []

    def test_a_pathfinder_limit_sits_between(self):
        body = {"lines": [{"ageBands": ["PATHFINDER"], "text": "x" * 321}]}
        assert len(authoring.copy_problems(body, ("lines",))) == 1


class TestServicePermissions:
    """A direct service call cannot do what the person's permissions do not allow."""

    def _draft(self, bay):
        return authoring.create_draft(bay, body_of(bay, title="Sunny Bay"), user=author())

    def test_a_person_without_the_edit_permission_cannot_draft(self, bay):
        nobody = person("nobody")
        with pytest.raises(authoring.NotPermitted):
            authoring.create_draft(bay, body_of(bay), user=nobody)

    @pytest.mark.parametrize("user", [None, "anonymous"])
    def test_no_user_is_refused_everywhere(self, bay, user):
        draft = self._draft(bay)
        who = None if user is None else person("x", "publish_content", staff=False)
        for call in (
            lambda: authoring.create_draft(bay, body_of(bay), user=who),
            lambda: authoring.update_draft(draft, body_of(bay), user=who),
            lambda: authoring.submit(draft, user=who),
            lambda: authoring.publish(draft, user=who),
            lambda: authoring.discard(draft, user=who),
            lambda: authoring.rollback(draft, user=who),
            lambda: authoring.set_active(bay, False, user=who),
        ):
            with pytest.raises(authoring.NotPermitted):
                call()

    def test_an_editor_cannot_publish_reject_restore_or_retire(self, bay):
        editor = author()
        draft = authoring.create_draft(bay, body_of(bay, title="Sunny Bay"), user=editor)
        submitted = authoring.submit(draft, user=editor)
        first = authoring.revisions_for(bay).get(number=1)
        for call in (
            lambda: authoring.publish(submitted, user=editor),
            lambda: authoring.reject(submitted, user=editor, reason="No"),
            lambda: authoring.rollback(first, user=editor),
            lambda: authoring.set_active(bay, False, user=editor),
        ):
            with pytest.raises(authoring.NotPermitted):
                call()
        bay.refresh_from_db()
        assert bay.published_revision.number == 1 and bay.active

    def test_a_publisher_without_the_edit_permission_cannot_draft_or_discard(self, bay):
        publisher = person("pub", "publish_content")
        draft = self._draft(bay)
        with pytest.raises(authoring.NotPermitted):
            authoring.create_draft(bay, body_of(bay), user=publisher)
        with pytest.raises(authoring.NotPermitted):
            authoring.discard(draft, user=publisher)

    def test_an_inactive_account_is_refused_even_with_the_permission(self, bay):
        gone = person("gone", "edit_content_draft", "publish_content", active=False)
        with pytest.raises(authoring.NotPermitted):
            authoring.create_draft(bay, body_of(bay), user=gone)

    def test_a_non_staff_account_is_refused_even_with_the_permission(self, bay):
        outsider = person("out", "edit_content_draft", "publish_content", staff=False)
        with pytest.raises(authoring.NotPermitted):
            authoring.publish(self._draft(bay), user=outsider)


class TestReviewWorkflow:
    def test_submit_return_reopen_edit_submit_approve(self, bay):
        writer, boss = author(), approver()
        draft = authoring.create_draft(bay, body_of(bay, title="Sunny Bay"), user=writer)
        submitted = authoring.submit(draft, user=writer)
        assert (submitted.status, submitted.submitted_by) == (RevisionStatus.SUBMITTED, writer)

        returned = authoring.reject(submitted, user=boss, reason="Please use a simpler word.")
        assert returned.status == RevisionStatus.REJECTED
        assert returned.rejection_reason == "Please use a simpler word."
        assert returned.reviewed_by == boss

        reopened = authoring.reopen(returned, user=writer)
        assert reopened.status == RevisionStatus.DRAFT
        authoring.update_draft(reopened, body_of(bay, title="Sunny Harbor"), user=writer)
        again = authoring.submit(reopened, user=writer)
        assert again.rejection_reason == ""

        published = authoring.publish(again, user=boss)
        assert published.status == RevisionStatus.PUBLISHED
        assert (published.published_by, published.reviewed_by) == (boss, boss)
        bay.refresh_from_db()
        assert bay.title == "Sunny Harbor" and bay.published_revision_id == published.pk

    def test_a_return_needs_a_reason(self, bay):
        writer, boss = author(), approver()
        submitted = authoring.submit(
            authoring.create_draft(bay, body_of(bay, title="Sunny Bay"), user=writer), user=writer
        )
        for reason in ("", "   ", "x" * 301):
            with pytest.raises(authoring.PublishRefused):
                authoring.reject(submitted, user=boss, reason=reason)
        assert ContentRevision.objects.get(pk=submitted.pk).status == RevisionStatus.SUBMITTED

    def test_a_submitted_version_cannot_be_edited_until_withdrawn(self, bay):
        writer = author()
        submitted = authoring.submit(
            authoring.create_draft(bay, body_of(bay, title="Sunny Bay"), user=writer), user=writer
        )
        with pytest.raises(authoring.PublishRefused):
            authoring.update_draft(submitted, body_of(bay, title="Other"), user=writer)
        draft = authoring.withdraw(submitted, user=writer)
        authoring.update_draft(draft, body_of(bay, title="Other"), user=writer)
        assert ContentRevision.objects.get(pk=draft.pk).body["title"] == "Other"

    def test_only_a_draft_can_be_submitted_and_only_a_returned_one_reopened(self, bay):
        writer, boss = author(), approver()
        draft = authoring.create_draft(bay, body_of(bay, title="Sunny Bay"), user=writer)
        with pytest.raises(authoring.PublishRefused):
            authoring.reopen(draft, user=writer)
        authoring.submit(draft, user=writer)
        with pytest.raises(authoring.PublishRefused):
            authoring.submit(draft, user=writer)
        published = authoring.publish(draft, user=boss)
        with pytest.raises(authoring.PublishRefused):
            authoring.reject(published, user=boss, reason="late")

    def test_a_returned_version_can_be_discarded_and_stays_in_history(self, bay):
        writer, boss = author(), approver()
        submitted = authoring.submit(
            authoring.create_draft(bay, body_of(bay, title="Sunny Bay"), user=writer), user=writer
        )
        returned = authoring.reject(submitted, user=boss, reason="Not now")
        authoring.discard(returned, user=writer)
        assert ContentRevision.objects.get(pk=returned.pk).status == RevisionStatus.DISCARDED

    def test_a_published_version_is_still_immutable(self, bay):
        boss = approver()
        draft = authoring.create_draft(bay, body_of(bay, title="Sunny Bay"), user=boss)
        published = authoring.publish(draft, user=boss)
        published.status = RevisionStatus.SUBMITTED
        with pytest.raises(ValueError):
            published.save()


class TestIndependentApproval:
    @pytest.fixture(autouse=True)
    def _on(self, settings):
        settings.LAI_CONTENT_INDEPENDENT_APPROVAL = True

    def test_publishing_an_unsubmitted_draft_is_refused(self, bay):
        boss = approver()
        draft = authoring.create_draft(bay, body_of(bay, title="Sunny Bay"), user=boss)
        with pytest.raises(authoring.PublishRefused) as refused:
            authoring.publish(draft, user=boss)
        assert "Submit" in refused.value.problems[0]

    def test_the_submitter_cannot_approve_or_return_their_own_version(self, bay):
        boss = approver()
        submitted = authoring.submit(
            authoring.create_draft(bay, body_of(bay, title="Sunny Bay"), user=boss), user=boss
        )
        with pytest.raises(authoring.PublishRefused):
            authoring.publish(submitted, user=boss)
        with pytest.raises(authoring.PublishRefused):
            authoring.reject(submitted, user=boss, reason="mine")
        bay.refresh_from_db()
        assert bay.published_revision.number == 1

    def test_a_different_administrator_approves(self, bay):
        first, second = approver(), approver()
        submitted = authoring.submit(
            authoring.create_draft(bay, body_of(bay, title="Sunny Bay"), user=first), user=first
        )
        authoring.publish(submitted, user=second)
        bay.refresh_from_db()
        assert bay.title == "Sunny Bay"

    def test_a_restore_is_not_sent_for_a_second_approval(self, bay):
        boss = approver()
        first = authoring.revisions_for(bay).get(number=1)
        restored = authoring.rollback(first, user=boss)
        assert restored.status == RevisionStatus.PUBLISHED and restored.number == 2

    def test_the_setting_is_off_by_default(self, settings):
        del settings.LAI_CONTENT_INDEPENDENT_APPROVAL
        assert authoring.independent_approval_required() is False


class TestAdminLog:
    def test_every_step_is_logged_on_the_revision(self, bay):
        writer, boss = author(), approver()
        draft = authoring.create_draft(bay, body_of(bay, title="Sunny Bay"), user=writer)
        authoring.update_draft(draft, body_of(bay, title="Sunny Bay"), user=writer)
        submitted = authoring.submit(draft, user=writer)
        returned = authoring.reject(submitted, user=boss, reason="Try again")
        reopened = authoring.reopen(returned, user=writer)
        again = authoring.submit(reopened, user=writer)
        published = authoring.publish(again, user=boss)
        authoring.rollback(authoring.revisions_for(bay).get(number=1), user=boss)
        authoring.discard(
            authoring.create_draft(bay, body_of(bay, title="Never"), user=writer), user=writer
        )

        messages = list(LogEntry.objects.values_list("change_message", flat=True))
        text = "\n".join(messages)
        for expected in (
            "Started draft",
            "Saved draft",
            "Submitted version",
            "Returned version",
            "Reopened version",
            "Published version",
            "Restored version 1",
            "Discarded version",
        ):
            assert expected in text, expected
        assert "Try again" in text
        assert LogEntry.objects.filter(object_id=str(published.pk)).exists()

    def test_log_entries_hold_no_content_body(self, bay):
        writer = author()
        authoring.create_draft(bay, body_of(bay, title="A secret title"), user=writer)
        assert not any(
            "secret" in m for m in LogEntry.objects.values_list("change_message", flat=True)
        )


class TestRetirement:
    @pytest.fixture
    def session(self, bay, families):
        bridge = Adventure.objects.get(slug="fix-bridge")
        started, _ = services.start_or_resume_session(families.a1, bridge)
        return bridge, started

    def test_retiring_a_record_with_no_open_session_needs_no_confirmation(self, bay):
        boss = approver()
        authoring.set_active(bay, False, user=boss)
        bay.refresh_from_db()
        assert bay.active is False
        authoring.set_active(bay, True, user=boss)
        bay.refresh_from_db()
        assert bay.active is True

    def test_an_open_session_blocks_retirement_until_it_is_named(self, session):
        bridge, started = session
        boss = approver()
        with pytest.raises(authoring.RetireNeedsConfirmation) as needed:
            authoring.set_active(bridge, False, user=boss)
        assert needed.value.sessions == [str(started.pk)[:8]]
        with pytest.raises(authoring.RetireNeedsConfirmation):
            authoring.set_active(bridge, False, user=boss, confirm_sessions=["wrong000"])
        bridge.refresh_from_db()
        assert bridge.active is True

        authoring.set_active(bridge, False, user=boss, confirm_sessions=needed.value.sessions)
        bridge.refresh_from_db()
        assert bridge.active is False

    def test_the_named_confirmation_is_recorded_in_the_admin_log(self, session):
        bridge, _ = session
        boss = approver()
        authoring.set_active(
            bridge, False, user=boss, confirm_sessions=authoring.open_sessions_using(bridge)
        )
        assert LogEntry.objects.filter(change_message__startswith="Retired adventure").exists()

    def test_a_finished_session_does_not_block_retirement(self, session):
        from apps.game_sessions.models import AdventureSession, SessionStatus

        bridge, started = session
        AdventureSession.objects.filter(pk=started.pk).update(
            status=SessionStatus.COMPLETED, completed_at=now()
        )
        authoring.set_active(bridge, False, user=approver())
        bridge.refresh_from_db()
        assert bridge.active is False

    def test_records_without_an_active_switch_cannot_be_retired(self, bay):
        step = AdventureStep.objects.first()
        with pytest.raises(authoring.PublishRefused):
            authoring.set_active(step, False, user=approver())


def test_the_test_staff_helper_can_still_publish(bay):
    user = staff_user()
    draft = authoring.create_draft(bay, body_of(bay, title="Sunny Bay"), user=user)
    assert authoring.publish(draft, user=user).status == RevisionStatus.PUBLISHED
