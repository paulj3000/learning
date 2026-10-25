"""Parent and child identity (LAI-0301).

Three different identities, kept apart on purpose:

1. Cognito identity: proves who is signed in. Only the immutable `sub` claim is stored here.
2. `ParentAccount`: the application's record of that parent. It is the Django user model.
3. `ChildProfile`: a player profile a parent manages. It has no login, no email, no Cognito
   identity, and no password. Children never authenticate.

Privacy rule for this module: `__str__` and `__repr__` use ids only, never names, so a log line
or exception message built from a model cannot carry a child's nickname.
"""

import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.db import models
from django.utils.timezone import now

MAX_CHILD_PROFILES = 3  # react/src/features/child-profile/constants.ts: MAX_CHILD_PROFILES
MAX_INTERESTS = 5
NICKNAME_MAX_LENGTH = 30
# Cognito subs are UUIDs, so a sub with this prefix can never arrive in a verified token.
ADMIN_ONLY_SUB_PREFIX = "django-admin-only:"


class AgeBand(models.TextChoices):
    SPROUT = "SPROUT", "Sprouts (ages 3-4)"
    PATHFINDER = "PATHFINDER", "Pathfinders (ages 5-6)"
    EXPLORER = "EXPLORER", "Explorers (ages 7-8)"


class ReadingMode(models.TextChoices):
    VOICE_FIRST = "VOICE_FIRST", "Voice first"
    READ_ALONG = "READ_ALONG", "Read along"
    INDEPENDENT = "INDEPENDENT", "Independent"


# CLAUDE.md section 3 and react/src/features/child-profile/constants.ts SESSION_MINUTES_RANGE.
SESSION_MINUTES_RANGE = {
    AgeBand.SPROUT: (5, 8),
    AgeBand.PATHFINDER: (8, 12),
    AgeBand.EXPLORER: (10, 18),
}


class ParentAccountManager(BaseUserManager):
    def get_or_create_for_cognito(self, cognito_sub: str, display_name: str = "", timezone_name=""):
        """Idempotent mapping from a verified Cognito `sub` to its application account.

        Callers must pass a `sub` taken from a verified token, never from request input.
        An existing account is returned unchanged: the sub is never rewritten.
        """
        if not cognito_sub or not cognito_sub.strip():
            raise ValueError("cognito_sub is required")
        account, _ = self.get_or_create(
            cognito_sub=cognito_sub,
            defaults={"display_name": display_name[:80], "timezone": timezone_name[:64]},
        )
        return account

    def create_user(self, *args, **kwargs):
        raise NotImplementedError("Use get_or_create_for_cognito; parents have no local login.")

    def create_superuser(self, *args, **kwargs):
        raise NotImplementedError("Use `manage.py create_admin_account` (docs/ARCHITECTURE.md).")


class ParentAccount(AbstractBaseUser):
    """The authenticated adult. This is Django's user model (`AUTH_USER_MODEL`).

    A parent's credentials live in Cognito; their password column is always an unusable password.
    Deliberately absent: email (mutable, personal, and never an identity key) and Django's
    permission tables (`PermissionsMixin`).

    Django Admin staff (LAI-0404, ADR-034) are rows with `admin_username`, `is_staff` and a usable
    password, created only by `manage.py create_admin_account`. A staff row is either linked to
    a real parent's Cognito sub (one person, two credentials) or standalone, with a placeholder
    sub (`ADMIN_ONLY_SUB_PREFIX`) that no Cognito token can carry. Nothing in the API sets these
    fields, so signing in with Cognito never grants admin access. Replaces Amplify `ParentProfile`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cognito_sub = models.CharField(max_length=128, unique=True, editable=False)
    display_name = models.CharField(max_length=80, blank=True)
    timezone = models.CharField(max_length=64, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    is_superuser = models.BooleanField(default=False)
    admin_username = models.CharField(max_length=150, unique=True, null=True, blank=True)
    created_at = models.DateTimeField(default=now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "cognito_sub"
    REQUIRED_FIELDS: list[str] = []
    objects = ParentAccountManager()

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(cognito_sub__regex=r"\S"),
                name="users_parentaccount_cognito_sub_not_blank",
            ),
            models.CheckConstraint(
                condition=models.Q(is_superuser=False) | models.Q(is_staff=True),
                name="users_parentaccount_superuser_is_staff",
            ),
        ]

    @classmethod
    def from_db(cls, db, field_names, values, **kwargs):
        instance = super().from_db(db, field_names, values, **kwargs)
        instance._loaded_cognito_sub = instance.cognito_sub
        return instance

    def save(self, *args, **kwargs):
        loaded = getattr(self, "_loaded_cognito_sub", None)
        if loaded is not None and loaded != self.cognito_sub:
            raise ValueError("cognito_sub is immutable once an account exists.")
        super().save(*args, **kwargs)
        self._loaded_cognito_sub = self.cognito_sub

    # Django Admin permission hooks. Superusers may do everything a ModelAdmin allows; other staff
    # get only what each ModelAdmin grants by role (apps/catalog/admin_access.py).
    def has_perm(self, perm, obj=None) -> bool:
        return self.is_active and self.is_staff and self.is_superuser

    def has_perms(self, perm_list, obj=None) -> bool:
        return all(self.has_perm(perm, obj) for perm in perm_list)

    def has_module_perms(self, app_label) -> bool:
        return self.is_active and self.is_staff and self.is_superuser

    def get_short_name(self) -> str:
        """What the admin header greets: the admin username, never the Cognito sub."""
        return self.admin_username or ""

    def __str__(self) -> str:
        return str(self.id)

    def __repr__(self) -> str:
        return f"<ParentAccount {self.id}>"


class AdminAccount(ParentAccount):
    """The Django Admin's view of staff rows (rows with an `admin_username`). Not a table."""

    class Meta:
        proxy = True
        verbose_name = "admin account"


class ChildProfileQuerySet(models.QuerySet):
    def owned_by(self, parent: "ParentAccount") -> "ChildProfileQuerySet":
        """Every read of child data must start here (or go through `services`)."""
        return self.filter(parent=parent)


class ChildProfile(models.Model):
    """A child's player profile, owned by exactly one `ParentAccount`.

    Mirrors Amplify `ChildProfile`. `ownerSub` is not copied: ownership is the foreign key.
    Deliberately absent: birth date, legal name, email, any free text beyond the nickname.

    Deletion: the parent foreign key is PROTECT. Today's behaviour is a hard delete of the child
    and everything attached, orchestrated by the application (it must also remove the photo
    object from S3), so a parent row cannot vanish and orphan children or photos. The deletion
    service (LAI-0602) deletes children explicitly; rows that belong to a child will cascade
    from the child.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    parent = models.ForeignKey(
        ParentAccount, on_delete=models.PROTECT, related_name="child_profiles", editable=False
    )
    nickname = models.CharField(max_length=NICKNAME_MAX_LENGTH)
    age_band = models.CharField(max_length=16, choices=AgeBand.choices)
    avatar_key = models.CharField(max_length=32)
    # Storage path of an optional parent-uploaded photo ("" when none). Resolved only for the
    # owning parent; the bytes are not in this database.
    avatar_photo_key = models.CharField(max_length=255, blank=True)
    interests = ArrayField(
        models.CharField(max_length=32), size=MAX_INTERESTS, blank=True, default=list
    )
    reading_mode = models.CharField(max_length=16, choices=ReadingMode.choices)
    session_minutes = models.PositiveSmallIntegerField()
    active = models.BooleanField(default=True)
    # Parent kill switch: when false no child data goes to the AI model at all.
    ai_enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ChildProfileQuerySet.as_manager()

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(nickname__regex=r"\S"), name="users_childprofile_nickname_set"
            ),
            models.CheckConstraint(
                condition=models.Q(age_band__in=AgeBand.values),
                name="users_childprofile_age_band_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(reading_mode__in=ReadingMode.values),
                name="users_childprofile_reading_mode_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    *[
                        models.Q(age_band=band, session_minutes__gte=low, session_minutes__lte=high)
                        for band, (low, high) in SESSION_MINUTES_RANGE.items()
                    ],
                    _connector=models.Q.OR,
                ),
                name="users_childprofile_session_minutes_for_age_band",
            ),
        ]
        indexes = [models.Index(fields=["parent", "created_at"], name="users_child_parent_created")]

    def clean(self):
        errors = {}
        if not (self.nickname or "").strip():
            errors["nickname"] = ValidationError("Enter a nickname.", code="blank_nickname")
        bounds = SESSION_MINUTES_RANGE.get(self.age_band)
        if bounds and not bounds[0] <= (self.session_minutes or 0) <= bounds[1]:
            errors["session_minutes"] = ValidationError(
                "Choose between %(low)s and %(high)s minutes for this age band.",
                code="session_minutes_out_of_range",
                params={"low": bounds[0], "high": bounds[1]},
            )
        if errors:
            raise ValidationError(errors)

    def __str__(self) -> str:
        return str(self.id)

    def __repr__(self) -> str:
        return f"<ChildProfile {self.id}>"
