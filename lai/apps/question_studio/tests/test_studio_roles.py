"""`ensure_studio_roles`: idempotent staff groups, membership kept, no parent or child access."""

from io import StringIO

import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.test import Client
from django.urls import reverse

from apps.question_studio import generation
from apps.question_studio.management.commands.ensure_studio_roles import (
    AUTHORS,
    POOL_MANAGERS,
    PUBLISHERS,
    REVIEWERS,
    ROLES,
)
from apps.question_studio.models import BatchStatus
from apps.users.models import ParentAccount

from .conftest import make_staff, params

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def ensure() -> str:
    out = StringIO()
    call_command("ensure_studio_roles", stdout=out)
    return out.getvalue()


def labels(group_name: str) -> set[str]:
    group = Group.objects.get(name=group_name)
    return {f"{p.content_type.app_label}.{p.codename}" for p in group.permissions.all()}


def admin_client(user) -> Client:
    client = Client()
    client.force_login(user, backend="apps.users.backends.AdminPasswordBackend")
    return client


def test_groups_get_exactly_the_listed_permissions():
    output = ensure()
    for group_name, names in ROLES.items():
        assert labels(group_name) == set(names)
        assert f"{group_name}: {len(names)} permissions" in output
    assert {"question_studio.cancel_generationbatch", "question_studio.retry_generationbatch"} <= (
        labels(AUTHORS)
    )
    for other in (REVIEWERS, PUBLISHERS, POOL_MANAGERS):
        assert "question_studio.cancel_generationbatch" not in labels(other)
        assert "question_studio.retry_generationbatch" not in labels(other)


def test_rerunning_is_idempotent_resets_hand_grants_and_keeps_members():
    ensure()
    staff = make_staff("author-a")
    staff.groups.add(Group.objects.get(name=AUTHORS))
    reviewers = Group.objects.get(name=REVIEWERS)
    reviewers.permissions.add(
        *Group.objects.get(name=AUTHORS).permissions.filter(codename="cancel_generationbatch")
    )
    ensure()
    ensure()
    assert Group.objects.filter(name__in=ROLES).count() == len(ROLES)
    assert labels(REVIEWERS) == set(ROLES[REVIEWERS])  # the hand grant is gone
    assert list(Group.objects.get(name=AUTHORS).user_set.all()) == [staff]  # membership kept


def test_an_author_in_the_group_can_cancel_and_retry(settings):
    ensure()
    settings.LAI_STUDIO_RUN_MODE = "manual"
    author = make_staff("author-b")
    author.groups.add(Group.objects.get(name=AUTHORS))
    author = ParentAccount.objects.get(pk=author.pk)  # drop the cached permissions
    assert author.has_perm("question_studio.cancel_generationbatch")
    assert author.has_perm("question_studio.retry_generationbatch")
    batch = generation.create_batch(author, params(count=2))
    response = admin_client(author).post(
        reverse("admin:question_studio_generationbatch_cancel", args=[batch.pk])
    )
    assert response.status_code == 302
    batch.refresh_from_db()
    assert batch.status == BatchStatus.CANCELLED


def test_reviewers_and_unassigned_staff_cannot_cancel(settings):
    ensure()
    settings.LAI_STUDIO_RUN_MODE = "manual"
    owner = make_staff("author-c", "add_generationbatch", "view_generationbatch", "view_question")
    batch = generation.create_batch(owner, params(count=2))
    reviewer = make_staff("reviewer-a")
    reviewer.groups.add(Group.objects.get(name=REVIEWERS))
    reviewer = ParentAccount.objects.get(pk=reviewer.pk)
    for user in (owner, reviewer):
        with pytest.raises(generation.NotPermitted):
            generation.request_cancel(batch.pk, user)
        response = admin_client(user).post(
            reverse("admin:question_studio_generationbatch_cancel", args=[batch.pk])
        )
        assert response.status_code in (302, 403)
        batch.refresh_from_db()
        assert batch.status != BatchStatus.CANCELLED


def test_parents_and_children_never_gain_studio_permissions(settings):
    """A parent (a Cognito account without is_staff) gets nothing from the command, and even
    membership of the authors group would not open the Studio admin to a non-staff account."""
    settings.LAI_STUDIO_RUN_MODE = "manual"
    owner = make_staff("author-d", "add_generationbatch", "view_generationbatch", "view_question")
    batch = generation.create_batch(owner, params(count=2))
    parent = ParentAccount.objects.create(cognito_sub="parent-sub-1")
    ensure()
    parent = ParentAccount.objects.get(pk=parent.pk)
    assert not parent.groups.exists()
    assert not parent.has_perm("question_studio.cancel_generationbatch")
    parent.groups.add(Group.objects.get(name=AUTHORS))
    response = admin_client(parent).post(
        reverse("admin:question_studio_generationbatch_cancel", args=[batch.pk])
    )
    assert response.status_code in (302, 403)  # to the admin sign-in, never the action
    batch.refresh_from_db()
    assert batch.status != BatchStatus.CANCELLED
    # Child profiles are not accounts at all: they have no groups or permissions to grant.
    from apps.users.models import ChildProfile

    assert not hasattr(ChildProfile, "groups")
