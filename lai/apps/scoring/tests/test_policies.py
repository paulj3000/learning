"""Policy lifecycle, immutability, approval and the economy gate (GE-102)."""

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.core.tests.test_django_admin import make_admin
from apps.scoring import fixtures, policies
from apps.scoring.contracts import Currency, SourceKind
from apps.scoring.models import (
    AwardRule,
    ImmutablePolicy,
    PolicyStatus,
    ScoringPolicy,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def draft(key="default", **kw):
    return (
        fixtures.create_dev_policy(key) if not kw else ScoringPolicy.objects.create(key=key, **kw)
    )


def plain_policy(version=1, **kw):
    """A non-fixture policy, so it may be approved."""
    policy = ScoringPolicy.objects.create(
        key="default",
        version=version,
        title="Real",
        level_thresholds=[0, 500],
        **kw,
    )
    AwardRule.objects.create(
        policy=policy,
        rule_key="quest",
        source_kind=SourceKind.QUEST_COMPLETED,
        currency=Currency.XP,
        amount=10,
    )
    return policy


def superuser():
    return make_admin("owner-root", superuser=True)[0]


def staff():
    return make_admin("staff-only")[0]


# --- Lifecycle --------------------------------------------------------------------------------


def test_activation_retires_the_previous_active_version():
    first = policies.activate(draft())
    second = policies.activate(draft())
    first.refresh_from_db()
    assert first.status == PolicyStatus.RETIRED and first.retired_at is not None
    assert second.status == PolicyStatus.ACTIVE and second.version == 2
    assert ScoringPolicy.objects.filter(status=PolicyStatus.ACTIVE).count() == 1


def test_the_database_allows_one_active_policy_per_key():
    policies.activate(draft())
    other = draft()
    with pytest.raises(IntegrityError), transaction.atomic():
        ScoringPolicy.objects.filter(pk=other.pk).update(status=PolicyStatus.ACTIVE)


def test_another_key_has_its_own_active_policy():
    policies.activate(draft())
    policies.activate(draft("seasonal"))
    assert ScoringPolicy.objects.filter(status=PolicyStatus.ACTIVE).count() == 2


def test_only_a_draft_can_be_activated_and_only_the_active_retired():
    active = policies.activate(draft())
    with pytest.raises(policies.PolicyError):
        policies.activate(active)
    retired = policies.retire(active)
    assert retired.status == PolicyStatus.RETIRED
    with pytest.raises(policies.PolicyError):
        policies.retire(retired)
    with pytest.raises(policies.PolicyError):
        policies.retire(draft())


def test_version_numbers_are_unique_per_key():
    plain_policy(1)
    with pytest.raises(IntegrityError), transaction.atomic():
        plain_policy(1)


# --- Immutability -----------------------------------------------------------------------------


@pytest.mark.parametrize("status", [PolicyStatus.ACTIVE, PolicyStatus.RETIRED])
def test_frozen_policies_cannot_be_saved_or_deleted(status):
    policy = policies.activate(draft())
    if status == PolicyStatus.RETIRED:
        policy = policies.retire(policy)
    policy.title = "Edited"
    with pytest.raises(ImmutablePolicy):
        policy.save()
    with pytest.raises(ImmutablePolicy):
        policy.save(update_fields=["title"])
    with pytest.raises(ImmutablePolicy):
        policy.delete()
    assert ScoringPolicy.objects.get(pk=policy.pk).title != "Edited"


@pytest.mark.parametrize("status", [PolicyStatus.ACTIVE, PolicyStatus.RETIRED])
def test_rules_of_a_frozen_policy_cannot_be_changed_added_or_deleted(status):
    policy = policies.activate(draft())
    if status == PolicyStatus.RETIRED:
        policy = policies.retire(policy)
    rule = policy.rules.first()
    rule.amount = 99999
    with pytest.raises(ImmutablePolicy):
        rule.save()
    with pytest.raises(ImmutablePolicy):
        rule.delete()
    with pytest.raises(ImmutablePolicy):
        AwardRule.objects.create(
            policy=policy,
            rule_key="late",
            source_kind=SourceKind.QUEST_COMPLETED,
            currency=Currency.XP,
            amount=1,
        )
    assert policy.rules.get(pk=rule.pk).amount != 99999


def test_a_draft_and_its_rules_are_editable_and_deletable():
    policy = draft()
    policy.title = "Retitled"
    policy.save()
    rule = policy.rules.first()
    rule.amount = 7
    rule.save()
    rule.delete()
    from django.db.models import ProtectedError

    with pytest.raises(ProtectedError):  # rules are PROTECT: delete them first
        policy.delete()
    policy.rules.all().delete()
    policy.delete()
    assert not ScoringPolicy.objects.exists()


def test_lifecycle_only_update_fields_still_work_on_a_frozen_policy():
    policy = policies.activate(draft())
    policy.status = PolicyStatus.RETIRED
    policy.save(update_fields=["status"])
    assert ScoringPolicy.objects.get(pk=policy.pk).status == PolicyStatus.RETIRED


# --- Clone ------------------------------------------------------------------------------------


def test_clone_copies_rules_bumps_the_version_and_drops_approval():
    source = plain_policy()
    policies.record_economy_approval(source, superuser())
    source = policies.activate(source)
    clone = policies.clone_to_draft(source, title="Next")
    assert clone.version == 2 and clone.status == PolicyStatus.DRAFT
    assert clone.title == "Next" and clone.level_thresholds == [0, 500]
    assert clone.economy_approved_at is None and clone.economy_approved_by is None
    assert [(r.rule_key, r.amount) for r in clone.rules.all()] == [("quest", 10)]
    assert clone.rules.first().pk != source.rules.first().pk
    # cloning a clone continues the numbering
    assert policies.clone_to_draft(source).version == 3


# --- Approval ---------------------------------------------------------------------------------


def test_only_a_superuser_records_the_economy_approval():
    policy = plain_policy()
    for user in (staff(), None):
        with pytest.raises(policies.PolicyError):
            policies.record_economy_approval(policy, user)
    owner = superuser()
    approved = policies.record_economy_approval(policy, owner)
    assert approved.economy_approved_at is not None and approved.economy_approved_by == owner


def test_an_inactive_superuser_cannot_approve():
    policy = plain_policy()
    ghost, _ = make_admin("ghost-root", superuser=True, active=False)
    with pytest.raises(policies.PolicyError):
        policies.record_economy_approval(policy, ghost)


def test_a_development_fixture_can_never_be_approved():
    fixture = draft()
    with pytest.raises(policies.PolicyError):
        policies.record_economy_approval(fixture, superuser())
    fixture.refresh_from_db()
    assert fixture.economy_approved_at is None


def test_the_database_also_refuses_an_approved_fixture():
    fixture = draft()
    with pytest.raises(IntegrityError), transaction.atomic():
        ScoringPolicy.objects.filter(pk=fixture.pk).update(
            economy_approved_at="2026-11-18T00:00:00Z"
        )


def test_approval_is_idempotent():
    policy = plain_policy()
    owner = superuser()
    first = policies.record_economy_approval(policy, owner)
    again = policies.record_economy_approval(policy, owner)
    assert again.economy_approved_at == first.economy_approved_at


# --- The economy gate -------------------------------------------------------------------------


def test_the_engine_is_off_by_default_even_with_an_active_policy(settings):
    policies.activate(draft())
    settings.LAI_SCORING_ALLOW_UNAPPROVED = True
    settings.LAI_SCORING_ENABLED = False
    assert policies.awarding_policy() is None


def test_no_active_policy_gives_none(settings):
    settings.LAI_SCORING_ENABLED = True
    settings.LAI_SCORING_ALLOW_UNAPPROVED = True
    draft()  # a draft never awards
    assert policies.awarding_policy() is None


def test_an_unapproved_active_policy_awards_only_where_unapproved_is_allowed(settings):
    active = policies.activate(draft())
    settings.LAI_SCORING_ENABLED = True
    settings.LAI_SCORING_ALLOW_UNAPPROVED = False
    assert policies.awarding_policy() is None
    settings.LAI_SCORING_ALLOW_UNAPPROVED = True
    assert policies.awarding_policy() == active


def test_an_approved_non_fixture_policy_awards_without_the_unapproved_setting(settings):
    policy = plain_policy()
    policies.record_economy_approval(policy, superuser())
    active = policies.activate(policy)
    settings.LAI_SCORING_ENABLED = True
    settings.LAI_SCORING_ALLOW_UNAPPROVED = False
    assert policies.awarding_policy() == active


# --- Database and validation guards -----------------------------------------------------------


@pytest.mark.parametrize("field, value", [("minimum_trust", 0), ("amount", 0)])
def test_the_database_refuses_a_client_reported_or_zero_rule(field, value):
    policy = draft()
    values = {
        "policy": policy,
        "rule_key": "bad",
        "source_kind": SourceKind.QUEST_COMPLETED,
        "currency": Currency.XP,
        "amount": 5,
        field: value,
    }
    with pytest.raises(IntegrityError), transaction.atomic():
        AwardRule.objects.create(**values)


def test_activation_runs_full_clean_so_bad_thresholds_are_refused():
    policy = draft()
    policy.level_thresholds = [5, 3]  # must start at 0 and ascend
    policy.save()
    with pytest.raises(ValidationError):
        policies.activate(policy)
    policy.refresh_from_db()
    assert policy.status == PolicyStatus.DRAFT


def test_activation_refuses_an_invalid_rule():
    policy = draft()
    rule = policy.rules.get(rule_key="new-location")
    rule.selector = "a*b"  # the wildcard is allowed only at the end
    rule.save()
    with pytest.raises(ValidationError):
        policies.activate(policy)
    assert policy.__class__.objects.get(pk=policy.pk).status == PolicyStatus.DRAFT


def test_a_failed_activation_leaves_the_previous_active_version_alone():
    first = policies.activate(draft())
    bad = draft()
    bad.level_thresholds = []
    bad.save()
    with pytest.raises(ValidationError):
        policies.activate(bad)
    first.refresh_from_db()
    assert first.status == PolicyStatus.ACTIVE


def test_clone_keeps_the_suppress_flag_and_still_suppresses():
    source = policies.activate(draft())
    original = source.rules.get(rule_key="legacy-treasure-rush-cove")
    assert original.suppress
    clone = policies.clone_to_draft(source)
    copied = clone.rules.get(rule_key="legacy-treasure-rush-cove")
    assert copied.suppress and copied.amount == original.amount
    assert copied.selector == original.selector
    assert {r.rule_key for r in clone.rules.filter(suppress=True)} == {
        r.rule_key for r in source.rules.filter(suppress=True)
    }
    policies.activate(clone)  # a suppress rule with amount 0 passes activation


def test_a_non_suppress_rule_with_zero_amount_is_still_refused_by_the_database():
    policy = draft()
    with pytest.raises(IntegrityError), transaction.atomic():
        AwardRule.objects.create(
            policy=policy,
            rule_key="zero",
            source_kind=SourceKind.QUEST_COMPLETED,
            currency=Currency.XP,
            amount=0,
            suppress=False,
        )
    AwardRule.objects.create(
        policy=policy,
        rule_key="zero-ok",
        source_kind=SourceKind.QUEST_COMPLETED,
        currency=Currency.XP,
        amount=0,
        suppress=True,
        selector="x",
        stacking_group="zq",
    )
