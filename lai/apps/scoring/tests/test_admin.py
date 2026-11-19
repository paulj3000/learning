"""Django Admin for scoring: deny by default, frozen policies read-only, no child progress
registered; corrections through `manage.py scoring_correct`."""

import pytest
from django.contrib import admin
from django.core.management import CommandError, call_command
from django.test import Client
from django.urls import NoReverseMatch, reverse

from apps.core.tests.test_django_admin import make_admin
from apps.scoring import fixtures, ledger, policies
from apps.scoring.contracts import EntryKind
from apps.scoring.models import (
    AwardLedgerEntry,
    PolicyStatus,
    ProgressionProjection,
    ScoringPolicy,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

BACKEND = "apps.users.backends.AdminPasswordBackend"


def login(user):
    client = Client()
    client.force_login(user, backend=BACKEND)
    return client


def admin_url(model, name, *args):
    return reverse(f"admin:scoring_{model}_{name}", args=args)


@pytest.fixture
def staff_client(db):
    return login(make_admin("scoring-staff")[0])


@pytest.fixture
def root_client(db):
    return login(make_admin("scoring-root", superuser=True)[0])


def action_names(response):
    form = response.context["action_form"]
    if form is None:  # no action is available to this user at all
        return set()
    return {value for value, _ in form.fields["action"].choices}


# --- Access -----------------------------------------------------------------------------------


def test_an_anonymous_visitor_is_sent_to_the_admin_login():
    client = Client()
    anonymous = client.get(admin_url("scoringpolicy", "changelist"))
    assert anonymous.status_code == 302 and "login" in anonymous["Location"]


def test_a_non_staff_admin_account_is_turned_away(db):
    user, _ = make_admin("not-staff")
    user.is_staff = False
    user.save()
    client = login(user)
    for model in ("scoringpolicy",):
        response = client.get(admin_url(model, "changelist"))
        assert response.status_code in (302, 403)
        if response.status_code == 302:
            assert "login" in response["Location"]


def test_staff_see_the_policies(staff_client):
    fixtures.create_dev_policy()
    assert staff_client.get(admin_url("scoringpolicy", "changelist")).status_code == 200
    page = staff_client.get(admin_url("scoringpolicy", "changelist"))
    assert b"default" in page.content


# --- Policies ---------------------------------------------------------------------------------


def test_a_frozen_policy_renders_read_only(staff_client):
    active = policies.activate(fixtures.create_dev_policy())
    draft = fixtures.create_dev_policy()
    frozen_page = staff_client.get(admin_url("scoringpolicy", "change", active.pk))
    draft_page = staff_client.get(admin_url("scoringpolicy", "change", draft.pk))
    assert frozen_page.status_code == draft_page.status_code == 200
    assert "title" not in frozen_page.context["adminform"].form.fields
    assert "title" in draft_page.context["adminform"].form.fields
    # inline rules: no add/change/delete rights on a frozen policy, full on a draft
    frozen_inline = frozen_page.context["inline_admin_formsets"][0]
    draft_inline = draft_page.context["inline_admin_formsets"][0]
    assert not frozen_inline.has_change_permission and not frozen_inline.has_add_permission
    assert not frozen_inline.has_delete_permission
    assert draft_inline.has_change_permission and draft_inline.has_add_permission


def test_a_posted_edit_to_a_frozen_policy_changes_nothing(staff_client):
    active = policies.activate(fixtures.create_dev_policy())
    staff_client.post(admin_url("scoringpolicy", "change", active.pk), {"title": "Hacked"})
    assert ScoringPolicy.objects.get(pk=active.pk).title == active.title


def test_a_frozen_policy_cannot_be_deleted_in_admin(staff_client):
    active = policies.activate(fixtures.create_dev_policy())
    response = staff_client.post(admin_url("scoringpolicy", "delete", active.pk), {"post": "yes"})
    assert response.status_code in (302, 403)
    assert ScoringPolicy.objects.filter(pk=active.pk).exists()


def test_the_approve_action_is_missing_for_non_superusers(staff_client, root_client):
    fixtures.create_dev_policy()
    staff_actions = action_names(staff_client.get(admin_url("scoringpolicy", "changelist")))
    root_actions = action_names(root_client.get(admin_url("scoringpolicy", "changelist")))
    assert "approve_selected" not in staff_actions
    assert {"activate_selected", "clone_selected", "retire_selected"} <= staff_actions
    assert "approve_selected" in root_actions


def test_a_staff_post_of_the_approve_action_does_nothing(staff_client):
    policy = ScoringPolicy.objects.create(version=1, title="Real", level_thresholds=[0, 5])
    staff_client.post(
        admin_url("scoringpolicy", "changelist"),
        {"action": "approve_selected", "_selected_action": [policy.pk]},
    )
    assert ScoringPolicy.objects.get(pk=policy.pk).economy_approved_at is None


def test_superuser_approval_of_a_development_fixture_is_refused(root_client):
    fixture = fixtures.create_dev_policy()
    root_client.post(
        admin_url("scoringpolicy", "changelist"),
        {"action": "approve_selected", "_selected_action": [fixture.pk]},
    )
    assert ScoringPolicy.objects.get(pk=fixture.pk).economy_approved_at is None


def test_the_activate_and_clone_actions_work_for_staff(staff_client):
    first = policies.activate(fixtures.create_dev_policy())
    draft = fixtures.create_dev_policy()
    staff_client.post(
        admin_url("scoringpolicy", "changelist"),
        {"action": "activate_selected", "_selected_action": [draft.pk]},
    )
    first.refresh_from_db()
    draft.refresh_from_db()
    assert (first.status, draft.status) == (PolicyStatus.RETIRED, PolicyStatus.ACTIVE)
    staff_client.post(
        admin_url("scoringpolicy", "changelist"),
        {"action": "clone_selected", "_selected_action": [draft.pk]},
    )
    assert ScoringPolicy.objects.filter(version=3, status=PolicyStatus.DRAFT).exists()


# --- Ledger: child progress, never on the admin -------------------------------------------------


@pytest.mark.parametrize("model", [AwardLedgerEntry, ProgressionProjection])
def test_child_progress_is_not_registered_on_the_admin(model):
    assert model not in admin.site._registry
    with pytest.raises(NoReverseMatch):
        admin_url(model._meta.model_name, "changelist")


@pytest.fixture
def root_user(db):
    return make_admin("scoring-correct-root", superuser=True)[0]


def test_a_correction_needs_a_superuser(families, grant):
    entry = grant(families.a1)
    staff, _ = make_admin("scoring-correct-staff")
    for username in (staff.admin_username, "nobody"):
        with pytest.raises(CommandError):
            call_command("scoring_correct", str(entry.pk), staff=username, reason="defect")
    assert not AwardLedgerEntry.objects.filter(entry_kind=EntryKind.CORRECTION).exists()


def test_a_correction_reverses_what_remains_and_keeps_the_original(families, grant, root_user):
    entry = grant(families.a1, ref="a", amount=70)
    call_command("scoring_correct", str(entry.pk), staff=root_user.admin_username, reason="Mis-set")
    [correction] = AwardLedgerEntry.objects.filter(entry_kind=EntryKind.CORRECTION)
    assert (correction.amount, correction.corrects_id) == (-70, entry.pk)
    assert correction.reason == "Mis-set" and correction.created_by == root_user
    assert AwardLedgerEntry.objects.get(pk=entry.pk).amount == 70
    assert ledger.projection_matches_ledger(families.a1)
    with pytest.raises(CommandError):  # nothing remains to reverse
        call_command(
            "scoring_correct", str(entry.pk), staff=root_user.admin_username, reason="again"
        )


def test_a_partial_correction_and_a_refused_one(families, grant, root_user):
    entry = grant(families.a1, ref="b", amount=50)
    call_command(
        "scoring_correct", str(entry.pk), staff=root_user.admin_username, reason="half", amount=-20
    )
    with pytest.raises(CommandError):  # would go below zero
        call_command(
            "scoring_correct", str(entry.pk), staff=root_user.admin_username, reason="x", amount=-40
        )
    with pytest.raises(CommandError):  # would raise the award above its original
        call_command(
            "scoring_correct", str(entry.pk), staff=root_user.admin_username, reason="x", amount=30
        )


def test_a_correction_cannot_itself_be_corrected(families, grant, root_user):
    entry = grant(families.a1, ref="c", amount=10)
    call_command("scoring_correct", str(entry.pk), staff=root_user.admin_username, reason="defect")
    correction = AwardLedgerEntry.objects.get(entry_kind=EntryKind.CORRECTION)
    with pytest.raises(CommandError):
        call_command(
            "scoring_correct", str(correction.pk), staff=root_user.admin_username, reason="x"
        )
