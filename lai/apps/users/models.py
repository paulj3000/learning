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
from django.contrib.auth.models import PermissionsMixin
from django.contrib.postgres.fields import ArrayField
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models.functions import Lower
from django.utils.timezone import now

from apps.core.models import ChildOwnedModel

MAX_CHILD_PROFILES = 3  # react/src/features/child-profile/constants.ts: MAX_CHILD_PROFILES
MAX_INTERESTS = 5
NICKNAME_MAX_LENGTH = 30
DISPLAY_NAME_MAX_LENGTH = 80
TIMEZONE_MAX_LENGTH = 64
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


class ParentAccount(AbstractBaseUser, PermissionsMixin):
    """The authenticated adult. This is Django's user model (`AUTH_USER_MODEL`).

    A parent's credentials live in Cognito; their password column is always an unusable password.
    Deliberately absent: email (mutable, personal, and never an identity key). `PermissionsMixin`
    (groups and permissions, ADR-035) serves Django Admin only: no API permission reads it.

    Django Admin staff (LAI-0404, ADR-034) are rows with `admin_username`, `is_staff` and a usable
    password, created only by `manage.py create_admin_account`. A staff row is either linked to
    a real parent's Cognito sub (one person, two credentials) or standalone, with a placeholder
    sub (`ADMIN_ONLY_SUB_PREFIX`) that no Cognito token can carry. Nothing in the API sets these
    fields, so signing in with Cognito never grants admin access. Replaces Amplify `ParentProfile`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cognito_sub = models.CharField(max_length=128, unique=True, editable=False)
    display_name = models.CharField(max_length=DISPLAY_NAME_MAX_LENGTH, blank=True)
    timezone = models.CharField(max_length=TIMEZONE_MAX_LENGTH, blank=True)
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

    # Django Admin permission hooks (ADR-035). Only active staff hold any permission, so a
    # parent row can never gain admin rights from a stray grant. Superusers hold every
    # permission; other staff get what their groups grant (`ensure_asset_roles`), and the
    # catalog admin still decides by role (apps/catalog/admin_access.py).
    def has_perm(self, perm, obj=None) -> bool:
        return self.is_active and self.is_staff and super().has_perm(perm, obj)

    def has_module_perms(self, app_label) -> bool:
        return self.is_active and self.is_staff and super().has_module_perms(app_label)

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


class ParentRecord(ParentAccount):
    """The Django Admin's read-only view of parent rows (no `admin_username`). Not a table.

    LAI-CHILD-001, ADR-039: staff inspect which children an account owns; they never edit it.
    """

    class Meta:
        proxy = True
        verbose_name = "parent account"


class CompanionType(models.TextChoices):
    """The island companions a child can choose (CLAUDE.md section 6). Replaces Amplify
    `CompanionProfile`: one choice per child, so it is two columns on the child, not a table."""

    CHATTY_PARROT = "CHATTY_PARROT", "Chatty the Parrot"


# What a child hears the companion called; authored, never parent or child text.
COMPANION_DISPLAY_NAMES = {CompanionType.CHATTY_PARROT: "Chatty"}


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
    # Deprecated by `ChildPhoto` (LAI-0904, ADR-042): never written by the API or the Amplify
    # import and never read. Kept only because dropping a column is a destructive migration;
    # removal is tracked with LAI-1103.
    avatar_photo_key = models.CharField(max_length=255, blank=True)
    interests = ArrayField(
        models.CharField(max_length=32), size=MAX_INTERESTS, blank=True, default=list
    )
    reading_mode = models.CharField(max_length=16, choices=ReadingMode.choices)
    active = models.BooleanField(default=True)
    # Parent kill switch: when false no child data goes to the AI model at all.
    ai_enabled = models.BooleanField(default=True)
    # The companion the child chose at Welcome Harbor (AMP-03); blank until they choose.
    companion_type = models.CharField(max_length=32, choices=CompanionType.choices, blank=True)
    companion_chosen_at = models.DateTimeField(null=True, blank=True)
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
                condition=models.Q(companion_type="", companion_chosen_at__isnull=True)
                | models.Q(
                    companion_type__in=CompanionType.values, companion_chosen_at__isnull=False
                ),
                name="users_childprofile_companion_valid",
            ),
        ]
        indexes = [models.Index(fields=["parent", "created_at"], name="users_child_parent_created")]

    def clean(self):
        if not (self.nickname or "").strip():
            raise ValidationError(
                {"nickname": ValidationError("Enter a nickname.", code="blank_nickname")}
            )

    def __str__(self) -> str:
        return str(self.id)

    def __repr__(self) -> str:
        return f"<ChildProfile {self.id}>"


class ChildPhotoStatus(models.TextChoices):
    CURRENT = "CURRENT", "Current"
    # Replaced or removed: no longer served; its object is being (or failed to be) deleted.
    DELETING = "DELETING", "Deleting"


class ChildPhoto(ChildOwnedModel):
    """A parent-uploaded profile photo for one child (LAI-0904, ADR-042).

    Django is the authority for photo metadata; the bytes live in the private child photo bucket
    (`photo_storage.py`) under `storage_key`, `children/<child uuid>/<photo uuid>`. The key is
    never sent to a client. At most one `CURRENT` photo per child. A replaced or removed photo is
    `DELETING` until its object is gone, so a failed S3 delete is retried by
    `manage.py child_photo_storage_audit` instead of being forgotten.

    Child deletion (LAI-0602) must call `photos.delete_all_child_photos` before deleting the child:
    the cascade from `ChildOwnedModel` removes these rows, not the objects. The id is the photo
    UUID in the key.
    """

    storage_key = models.CharField(max_length=128, unique=True, editable=False)
    status = models.CharField(
        max_length=16, choices=ChildPhotoStatus.choices, default=ChildPhotoStatus.CURRENT
    )
    content_type = models.CharField(max_length=32, default="image/jpeg")
    byte_size = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)
    width = models.PositiveSmallIntegerField()
    height = models.PositiveSmallIntegerField()
    created_at = models.DateTimeField(default=now, editable=False)
    status_changed_at = models.DateTimeField(default=now)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["child"],
                condition=models.Q(status="CURRENT"),
                name="users_childphoto_one_current_per_child",
            ),
            models.CheckConstraint(
                condition=models.Q(status__in=ChildPhotoStatus.values),
                name="users_childphoto_status_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(storage_key__startswith="children/"),
                name="users_childphoto_key_prefix",
            ),
        ]
        indexes = [models.Index(fields=["status", "status_changed_at"], name="users_photo_status")]

    def __repr__(self) -> str:
        return f"<ChildPhoto {self.id}>"


class AuthSessionAnchor(models.Model):
    """The `auth_time` Django first saw for one Cognito sign-in session (LAI-0209, ADR-043).

    A Cognito sign-in session is identified by the access token's `origin_jti`, which Cognito
    ties to the session's refresh token: every token refreshed from that refresh token carries
    the same value. Recent authentication is judged by `auth_time`, so a refresh must never
    move it. If a later token of the same session ever presents a different `auth_time`, the
    recent-authentication guard refuses it, whatever the identity provider does on refresh.

    Only a SHA-256 digest of `origin_jti` is stored (it is a revocation handle, not a credential,
    but it is never needed in clear). No token, claim set, IP address or device data is kept.
    """

    account = models.ForeignKey(ParentAccount, on_delete=models.CASCADE, related_name="+")
    session_digest = models.CharField(max_length=64)
    auth_time = models.BigIntegerField()
    first_seen_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["account", "session_digest"],
                name="users_authsessionanchor_one_per_session",
            ),
        ]
        indexes = [models.Index(fields=["first_seen_at"], name="users_anchor_seen_idx")]

    def __str__(self) -> str:
        return f"session anchor {self.pk}"


# --- Family accounts and child authentication (LAI-AUTH-01, ADR-NNN) ---------------------------
#
# docs/platform/FAMILY_CHILD_AUTHENTICATION.md. Additive only: nothing here changes a parent or
# child row, and every child-owned record keeps pointing at `ChildProfile`, so the family login
# (mode A) and the independent child login (mode B) reach the same progress by construction.
# None of these tables is read by an authenticator or a route yet: until ADR-NNN is accepted and
# LAI-AUTH-02/03/04 wire them, they are inert. Only SHA-256 digests of credentials are stored;
# PINs are stored as Django password hashes; Cognito passwords are never seen by Django.


class FamilyDevice(models.Model):
    """A shared device a signed-in parent handed to their children (mode A).

    Carried by an opaque HttpOnly cookie; only its SHA-256 is stored. It can list the parent's
    active children and open a child play session for one of them, and nothing else: it is not a
    parent credential. `remembered` devices live `LAI_FAMILY_DEVICE_REMEMBER_SECONDS`, the others
    `LAI_FAMILY_DEVICE_SESSION_SECONDS`. Ends at `expires_at`, on `revoked_at`, or when the parent
    is deactivated. No device name, user agent or IP address is kept.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    parent = models.ForeignKey(
        ParentAccount, on_delete=models.CASCADE, related_name="+", editable=False
    )
    token_hash = models.CharField(max_length=64, unique=True, editable=False)
    remembered = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=now, editable=False)
    last_used_at = models.DateTimeField(default=now)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(expires_at__gt=models.F("created_at")),
                name="users_familydevice_expires_later",
            ),
        ]
        indexes = [models.Index(fields=["parent", "revoked_at"], name="users_device_parent")]

    def __str__(self) -> str:
        return f"family device {self.pk}"


class ChildPin(ChildOwnedModel):
    """An optional profile-switching PIN a parent set for one child (mode A).

    A convenience between siblings on a family device, never a replacement for the parent's
    Cognito sign-in and never accepted on its own (a live `FamilyDevice` is always required).
    Stored as a Django password hash. A four-digit PIN is guessable offline from its hash, so the
    real protection is the server-side lockout: `failed_attempts` and `locked_until` live in
    PostgreSQL, not a per-process cache, so every worker and restart sees the same count.
    """

    pin_hash = models.CharField(max_length=256, editable=False)
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(default=now)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["child"], name="users_childpin_one_per_child"),
        ]

    def __repr__(self) -> str:
        return f"<ChildPin {self.id}>"


class ChildCredentialStatus(models.TextChoices):
    # Django has the row; the Cognito user is being created (LAI-AUTH-05).
    PROVISIONING = "PROVISIONING", "Provisioning"
    ACTIVE = "ACTIVE", "Active"
    # The parent paused independent login; the profile and progress are untouched.
    SUSPENDED = "SUSPENDED", "Suspended"
    # The parent removed independent login; kept as a tombstone so the login name is released.
    REVOKED = "REVOKED", "Revoked"


LOGIN_NAME_MIN_LENGTH = 4
LOGIN_NAME_MAX_LENGTH = 20


class ChildCredential(ChildOwnedModel):
    """A parent-managed independent sign-in for one child (mode B), mapped to its profile.

    The Cognito user lives in the child user pool (ADR-NNN decision 3). Django keeps only the
    login name the parent chose (it is the Cognito username, so the child can type it), the
    pool's issuer and the user's immutable `sub`. The password is never sent to or stored by
    Django except in transit to Cognito when the parent sets it (LAI-AUTH-05).

    `tokens_valid_after` is Django's own revocation line: a session or token issued before it is
    refused even while Cognito still considers it valid (a reset, suspension or revocation moves
    it). Suspension and revocation take effect in Django first, so they never wait on Cognito.

    Privacy: the login name is personal data. It is never logged, never shown in Django Admin,
    and `__str__`/`__repr__` use the id only.
    """

    login_name = models.CharField(max_length=LOGIN_NAME_MAX_LENGTH, editable=False)
    issuer = models.CharField(max_length=200, blank=True, editable=False)
    subject = models.CharField(max_length=128, blank=True, editable=False)
    status = models.CharField(
        max_length=16,
        choices=ChildCredentialStatus.choices,
        default=ChildCredentialStatus.PROVISIONING,
    )
    tokens_valid_after = models.DateTimeField(default=now)
    created_at = models.DateTimeField(default=now, editable=False)
    status_changed_at = models.DateTimeField(default=now)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(status__in=ChildCredentialStatus.values),
                name="users_childcredential_status_valid",
            ),
            # One live credential per child; revoked tombstones do not count.
            models.UniqueConstraint(
                fields=["child"],
                condition=~models.Q(status="REVOKED"),
                name="users_childcredential_one_live_per_child",
            ),
            # Login names are case-insensitive, like the child pool's usernames.
            models.UniqueConstraint(
                Lower("login_name"),
                condition=~models.Q(status="REVOKED"),
                name="users_childcredential_login_name_unique",
            ),
            # A Cognito identity maps to at most one credential, so to one child.
            models.UniqueConstraint(
                fields=["issuer", "subject"],
                condition=~models.Q(subject=""),
                name="users_childcredential_identity_unique",
            ),
            # An active credential always has a verified Cognito identity behind it.
            models.CheckConstraint(
                condition=~models.Q(status="ACTIVE")
                | (~models.Q(subject="") & ~models.Q(issuer="")),
                name="users_childcredential_active_has_identity",
            ),
            models.CheckConstraint(
                condition=models.Q(login_name__regex=r"^[a-z0-9][a-z0-9._-]{3,19}$"),
                name="users_childcredential_login_name_format",
            ),
        ]

    def __repr__(self) -> str:
        return f"<ChildCredential {self.id}>"


class ChildSessionSource(models.TextChoices):
    FAMILY_DEVICE = "FAMILY_DEVICE", "Family device (mode A)"
    CHILD_LOGIN = "CHILD_LOGIN", "Independent child login (mode B)"


class ChildPlaySession(ChildOwnedModel):
    """A restricted gameplay session for exactly one child: the child principal.

    Both modes end here. Mode A opens one from a `FamilyDevice` (after the PIN, if the child has
    one); mode B opens one by exchanging a verified child-pool access token. The cookie carrying
    it (only its SHA-256 is stored) will authenticate only the child gameplay routes that opt in
    (LAI-AUTH-03), and only for this child: never account, child management, credential, consent,
    photo upload or deletion routes.

    It ends at `expires_at` (absolute), after `LAI_CHILD_SESSION_IDLE_SECONDS` without use, on
    `revoked_at`, or when the parent or child is deactivated, the device is revoked, or the
    credential is suspended, revoked or reset. Expiry is a security control, not a play-time
    limit (ADR-053): a family device reopens the session without interrupting the child.
    """

    CHILD_LINKS = ("credential",)

    parent = models.ForeignKey(
        ParentAccount, on_delete=models.CASCADE, related_name="+", editable=False
    )
    source = models.CharField(max_length=16, choices=ChildSessionSource.choices, editable=False)
    family_device = models.ForeignKey(
        FamilyDevice, on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    credential = models.ForeignKey(
        ChildCredential, on_delete=models.CASCADE, null=True, blank=True, related_name="+"
    )
    token_hash = models.CharField(max_length=64, unique=True, editable=False)
    created_at = models.DateTimeField(default=now, editable=False)
    last_seen_at = models.DateTimeField(default=now)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(expires_at__gt=models.F("created_at")),
                name="users_childplaysession_expires_later",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(
                        source="FAMILY_DEVICE",
                        family_device__isnull=False,
                        credential__isnull=True,
                    )
                    | models.Q(
                        source="CHILD_LOGIN", family_device__isnull=True, credential__isnull=False
                    )
                ),
                name="users_childplaysession_source_matches",
            ),
        ]
        indexes = [
            models.Index(fields=["parent", "revoked_at"], name="users_playsess_parent"),
            models.Index(fields=["child", "revoked_at"], name="users_playsess_child"),
        ]

    def __repr__(self) -> str:
        return f"<ChildPlaySession {self.id}>"
