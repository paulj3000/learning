import pytest
from django.apps import apps
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.db.models import ProtectedError
from django.test.utils import CaptureQueriesContext

from apps.users import services
from apps.users.models import MAX_CHILD_PROFILES, ChildProfile, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

SUB_A = "11111111-aaaa-bbbb-cccc-000000000001"
SUB_B = "22222222-aaaa-bbbb-cccc-000000000002"

VALID = {
    "nickname": "Pip",
    "age_band": "PATHFINDER",
    "avatar_key": "FOX",
    "reading_mode": "READ_ALONG",
    "session_minutes": 10,
    "interests": ["Animals", "Space"],
}


@pytest.fixture
def parent_a():
    return ParentAccount.objects.get_or_create_for_cognito(SUB_A, "Parent A", "Europe/London")


@pytest.fixture
def parent_b():
    return ParentAccount.objects.get_or_create_for_cognito(SUB_B, "Parent B")


def child(parent, **overrides):
    return services.create_child_profile(parent, **{**VALID, **overrides})


# --- ParentAccount: Cognito identity mapping ------------------------------------------------


def test_parent_is_created_from_a_cognito_sub():
    account = ParentAccount.objects.get_or_create_for_cognito(SUB_A, "Ann", "UTC")
    assert account.cognito_sub == SUB_A and account.display_name == "Ann"
    assert account.pk is not None and account.is_active and not account.is_staff
    assert account.is_authenticated and not account.is_anonymous


def test_mapping_is_idempotent_and_never_rewrites_existing_data():
    first = ParentAccount.objects.get_or_create_for_cognito(SUB_A, "Ann")
    again = ParentAccount.objects.get_or_create_for_cognito(SUB_A, "Different Name")
    assert first.pk == again.pk
    assert ParentAccount.objects.count() == 1
    assert ParentAccount.objects.get().display_name == "Ann"


def test_different_subs_are_different_accounts(parent_a, parent_b):
    assert parent_a.pk != parent_b.pk and ParentAccount.objects.count() == 2


@pytest.mark.parametrize("bad", ["", "   ", None])
def test_blank_sub_is_rejected_by_the_manager(bad):
    with pytest.raises((ValueError, AttributeError)):
        ParentAccount.objects.get_or_create_for_cognito(bad)


def test_database_enforces_unique_and_non_blank_sub(parent_a):
    with pytest.raises(IntegrityError), transaction.atomic():
        ParentAccount.objects.create(cognito_sub=SUB_A)
    with pytest.raises(IntegrityError), transaction.atomic():
        ParentAccount.objects.create(cognito_sub="   ")


def test_cognito_sub_is_immutable(parent_a):
    loaded = ParentAccount.objects.get(pk=parent_a.pk)
    loaded.cognito_sub = SUB_B
    with pytest.raises(ValueError, match="immutable"):
        loaded.save()
    assert ParentAccount.objects.get(pk=parent_a.pk).cognito_sub == SUB_A


def test_parents_have_no_local_login_email_or_admin_rights(parent_a):
    assert not parent_a.has_usable_password() or parent_a.password == ""
    assert not parent_a.is_staff and not parent_a.is_superuser and parent_a.admin_username is None
    assert not parent_a.has_perm("catalog.view_world") and not parent_a.has_module_perms("catalog")
    field_names = {f.name for f in ParentAccount._meta.get_fields()}
    assert "email" not in field_names
    # PermissionsMixin exists for Django Admin (ADR-035), but a parent row holds nothing even when
    # a permission or a group is granted to it by mistake: only active staff hold permissions.
    from django.contrib.auth.models import Group, Permission

    publish = Permission.objects.get(codename="publish_assetversion")
    parent_a.user_permissions.add(publish)
    group = Group.objects.create(name="Mistaken grant")
    group.permissions.add(publish)
    parent_a.groups.add(group)
    parent_a = ParentAccount.objects.get(pk=parent_a.pk)  # drop the permission cache
    assert not parent_a.has_perm("assets.publish_assetversion")
    assert not parent_a.has_module_perms("assets")
    with pytest.raises(NotImplementedError):
        ParentAccount.objects.create_user()
    with pytest.raises(NotImplementedError, match="create_admin_account"):
        ParentAccount.objects.create_superuser()


def test_parent_account_is_the_user_model_and_only_the_admin_backend_signs_in():
    assert settings.AUTH_USER_MODEL == "users.ParentAccount"
    assert apps.get_model(settings.AUTH_USER_MODEL) is ParentAccount
    # The admin stack is installed (LAI-0404); Django password sign-in is the admin backend only.
    for name in ("django.contrib.auth", "django.contrib.admin", "django.contrib.sessions"):
        assert name in settings.INSTALLED_APPS
    assert settings.AUTHENTICATION_BACKENDS == ["apps.users.backends.AdminPasswordBackend"]


def test_string_forms_never_contain_names(parent_a):
    kid = child(parent_a, nickname="Zebedee")
    for obj in (parent_a, kid):
        assert "Parent A" not in f"{obj} {obj!r}" and "Zebedee" not in f"{obj} {obj!r}"
        assert str(obj.pk) in str(obj)


# --- ChildProfile -------------------------------------------------------------------------------


def test_child_profile_is_created_with_the_amplify_fields(parent_a):
    kid = child(parent_a)
    kid.refresh_from_db()
    assert kid.parent_id == parent_a.pk
    assert (kid.nickname, kid.age_band, kid.avatar_key) == ("Pip", "PATHFINDER", "FOX")
    assert kid.reading_mode == "READ_ALONG" and kid.session_minutes == 10
    assert kid.interests == ["Animals", "Space"] and kid.avatar_photo_key == ""
    assert kid.active is True and kid.ai_enabled is True


def test_a_parent_can_have_several_children(parent_a):
    names = ["A", "B", "C"]
    for name in names:
        child(parent_a, nickname=name)
    assert [c.nickname for c in services.list_child_profiles(parent_a)] == names


def test_three_profile_limit_counts_inactive_profiles_too(parent_a):
    for index in range(MAX_CHILD_PROFILES):
        kid = child(parent_a, nickname=f"K{index}")
    ChildProfile.objects.filter(pk=kid.pk).update(active=False)
    with pytest.raises(services.ChildProfileLimitReached):
        child(parent_a, nickname="Fourth")
    assert ChildProfile.objects.owned_by(parent_a).count() == 3


def test_limit_is_per_parent(parent_a, parent_b):
    for index in range(MAX_CHILD_PROFILES):
        child(parent_a, nickname=f"K{index}")
    assert child(parent_b, nickname="Ok").parent_id == parent_b.pk


def test_creation_locks_the_parent_row_to_make_the_limit_race_safe(parent_a):
    with CaptureQueriesContext(connection) as queries:
        child(parent_a)
    assert any("FOR UPDATE" in q["sql"] for q in queries)


@pytest.mark.parametrize(
    "overrides, field",
    [
        ({"nickname": ""}, "nickname"),
        ({"nickname": "   "}, "nickname"),
        ({"nickname": "x" * 31}, "nickname"),
        ({"age_band": "TEEN"}, "age_band"),
        ({"reading_mode": "SHOUTING"}, "reading_mode"),
        ({"avatar_key": ""}, "avatar_key"),
        ({"interests": ["a"] * 6}, "interests"),
        ({"age_band": "SPROUT", "session_minutes": 9}, "session_minutes"),
        ({"age_band": "SPROUT", "session_minutes": 4}, "session_minutes"),
        ({"age_band": "PATHFINDER", "session_minutes": 13}, "session_minutes"),
        ({"age_band": "EXPLORER", "session_minutes": 9}, "session_minutes"),
        ({"age_band": "EXPLORER", "session_minutes": 19}, "session_minutes"),
    ],
)
def test_invalid_profiles_are_rejected_by_validation(parent_a, overrides, field):
    with pytest.raises(ValidationError) as caught:
        child(parent_a, **overrides)
    assert field in caught.value.message_dict
    assert ChildProfile.objects.count() == 0
    assert "Pip" not in str(caught.value)  # validation errors never echo profile data


@pytest.mark.parametrize(
    "overrides",
    [
        {"nickname": "  "},
        {"age_band": "TEEN"},
        {"reading_mode": "SHOUTING"},
        {"age_band": "SPROUT", "session_minutes": 9},
        {"age_band": "EXPLORER", "session_minutes": 9},
    ],
)
def test_database_constraints_hold_even_when_validation_is_bypassed(parent_a, overrides):
    values = {**VALID, **overrides}
    with pytest.raises(IntegrityError), transaction.atomic():
        ChildProfile.objects.bulk_create([ChildProfile(parent=parent_a, **values)])


def test_every_age_band_accepts_its_boundaries(parent_a):
    bands = {"SPROUT": (5, 8), "PATHFINDER": (8, 12), "EXPLORER": (10, 18)}
    for band, (low, high) in bands.items():
        for minutes in (low, high):
            ChildProfile.objects.create(
                parent=parent_a, **{**VALID, "age_band": band, "session_minutes": minutes}
            )
    assert ChildProfile.objects.count() == 6


def test_a_child_cannot_exist_without_a_parent():
    with pytest.raises(IntegrityError), transaction.atomic():
        ChildProfile.objects.create(**VALID)


# --- ownership --------------------------------------------------------------------------------


def test_a_parent_only_sees_their_own_children(parent_a, parent_b):
    mine, theirs = child(parent_a, nickname="Mine"), child(parent_b, nickname="Theirs")
    assert list(services.list_child_profiles(parent_a)) == [mine]
    assert list(services.list_child_profiles(parent_b)) == [theirs]
    assert services.get_owned_child_profile(parent_a, mine.pk) == mine
    assert services.get_owned_child_profile(parent_a, str(mine.pk)) == mine


def test_another_parents_child_id_is_indistinguishable_from_a_missing_one(parent_a, parent_b):
    theirs = child(parent_b)
    results = []
    for candidate in (theirs.pk, "00000000-0000-0000-0000-000000000000", "not-a-uuid", "", None):
        with pytest.raises(services.ChildProfileNotFound) as caught:
            services.get_owned_child_profile(parent_a, candidate)
        results.append((type(caught.value), str(caught.value), caught.value.args))
    assert len(set(results)) == 1  # same error, same text, nothing that reveals existence


# --- deletion ---------------------------------------------------------------------------------


def test_parent_with_children_cannot_be_deleted_by_accident(parent_a):
    child(parent_a)
    with pytest.raises(ProtectedError), transaction.atomic():
        parent_a.delete()
    assert ParentAccount.objects.filter(pk=parent_a.pk).exists()


def test_children_are_deleted_explicitly_then_the_parent(parent_a, parent_b):
    mine, other = child(parent_a, nickname="Mine"), child(parent_b, nickname="Other")
    sibling = child(parent_a, nickname="Sibling")
    mine.delete()
    assert ChildProfile.objects.filter(pk=sibling.pk).exists()
    sibling.delete()
    parent_a.delete()
    assert not ParentAccount.objects.filter(pk=parent_a.pk).exists()
    assert ChildProfile.objects.filter(pk=other.pk).exists()
    assert ParentAccount.objects.filter(pk=parent_b.pk).exists()


# --- migration ----------------------------------------------------------------------------------


def test_initial_migration_is_self_contained():
    from django.db.migrations.loader import MigrationLoader

    loader = MigrationLoader(connection)
    migration = loader.get_migration("users", "0001_initial")
    assert migration.dependencies == []  # no auth/contenttypes tables are involved
    assert {op.name for op in migration.operations} == {"ParentAccount", "ChildProfile"}
    assert ("users", "0001_initial") in loader.applied_migrations


def test_no_api_routes_expose_parent_or_child_data():
    from config import urls

    routes = [str(p.pattern) for p in urls.urlpatterns]
    assert not any("child" in r or "parent" in r or "user" in r for r in routes)
