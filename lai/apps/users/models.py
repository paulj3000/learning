"""Parent and child identity (LAI-0301).

Three different identities, kept apart on purpose:

1. Cognito identity: proves who is signed in. Only the immutable `sub` claim is stored here.
2. `ParentAccount`: the application's record of that parent. It is the Django user model.
3. `ChildProfile`: a player profile a parent manages. It has no email and no password of its
   own. A parent may give it an independent sign-in (`ChildCredential`, ADR-075): a username
   in the separate child Cognito pool, mapped here by the pool's issuer and the user's
   immutable `sub`, never by the username. The profile's id, and so all its progress, stays
   the same whether or not it has one.

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


# --- Independent child sign-in (LAI-AUTH-02 to 07, ADR-075) ------------------------------------
#
# docs/platform/FAMILY_CHILD_AUTHENTICATION.md. Additive only: nothing here changes a parent or
# child row, and every child-owned record keeps pointing at `ChildProfile`, so a child who signs
# in on their own reaches exactly the progress they had before. Session and device credentials
# are 256-bit random values; only their SHA-256 digests are stored. Child passwords live only in
# the child Cognito pool: Django passes one through when the parent sets it and never keeps it.


class ChildCredentialStatus(models.TextChoices):
    # Django has the row; the child-pool user is being created.
    PROVISIONING = "PROVISIONING", "Provisioning"
    ACTIVE = "ACTIVE", "Active"
    # The parent paused sign-in; the profile and progress are untouched.
    SUSPENDED = "SUSPENDED", "Suspended"
    # The parent removed sign-in. Kept as a tombstone (login name cleared, identity kept so the
    # `sub` can never map to a child again).
    REVOKED = "REVOKED", "Revoked"


LOGIN_NAME_MIN_LENGTH = 4
LOGIN_NAME_MAX_LENGTH = 20
LOGIN_NAME_REGEX = r"^[a-z0-9][a-z0-9._-]{3,19}$"


class ChildCredential(ChildOwnedModel):
    """A parent-managed independent sign-in for one child, mapped to that child's profile.

    The user lives in the child Cognito pool (ADR-075). Identity is `(issuer, subject)`: the
    pool's issuer URL and the user's immutable `sub`, both taken from Cognito, never from a
    request. `provider_username` is the pool's internal username, an opaque value Django
    generates so the Cognito admin calls can address the user; the child signs in with
    `login_name`, which the pool holds as the `preferred_username` alias and the parent may
    change. Neither name is ever an identity key.

    `tokens_valid_after` is Django's own revocation line: a token issued before it cannot open a
    session, and a session or remembered device created before it is refused, even while
    Cognito still considers the token valid. A password reset, suspension or revocation moves
    it, so they take effect in Django immediately and never wait for a Cognito token to expire.

    Privacy: the login name is personal data. It is never logged, never shown in Django Admin,
    and `__str__`/`__repr__` use the id only.
    """

    login_name = models.CharField(max_length=LOGIN_NAME_MAX_LENGTH, blank=True)
    provider_username = models.CharField(max_length=64, unique=True, editable=False)
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
    password_set_at = models.DateTimeField(null=True, blank=True)
    # Revoked in Django, but the child-pool user could not be deleted yet; a retry finishes it.
    provider_cleanup_pending = models.BooleanField(default=False)

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
            # Login names are case-insensitive, like the child pool's aliases.
            models.UniqueConstraint(
                Lower("login_name"),
                condition=~models.Q(status="REVOKED"),
                name="users_childcredential_login_name_unique",
            ),
            # A Cognito identity maps to at most one credential, so to one child, forever.
            models.UniqueConstraint(
                fields=["issuer", "subject"],
                condition=~models.Q(subject=""),
                name="users_childcredential_identity_unique",
            ),
            # Anything but provisioning has a verified Cognito identity behind it.
            models.CheckConstraint(
                condition=models.Q(status="PROVISIONING")
                | (~models.Q(subject="") & ~models.Q(issuer="")),
                name="users_childcredential_live_has_identity",
            ),
            # A live credential has a well-formed login name; a tombstone has none.
            models.CheckConstraint(
                condition=(
                    models.Q(status="REVOKED", login_name="")
                    | (~models.Q(status="REVOKED") & models.Q(login_name__regex=LOGIN_NAME_REGEX))
                ),
                name="users_childcredential_login_name_format",
            ),
        ]

    def __repr__(self) -> str:
        return f"<ChildCredential {self.id}>"


class ChildDevice(ChildOwnedModel):
    """A device on which a child chose "remember me" (a remembered sign-in).

    Carried by an opaque HttpOnly cookie that only the child sign-in routes receive; only its
    SHA-256 is stored. It can do exactly one thing: open a new `ChildPlaySession` for this one
    child, after every check runs again (credential active and not reset since, consent still
    given, child and parent active). It is never a parent credential, never lists siblings, and
    cannot switch to another child: on a shared device, each child signs in with their own name
    and password, and that replaces the previous child's cookie. Signing out forgets it.

    No device name, user agent or IP address is kept. The parent sees when it was remembered and
    last used, and can revoke it.
    """

    CHILD_LINKS = ("credential",)

    credential = models.ForeignKey(
        ChildCredential, on_delete=models.CASCADE, related_name="+", editable=False
    )
    token_hash = models.CharField(max_length=64, unique=True, editable=False)
    created_at = models.DateTimeField(default=now, editable=False)
    last_used_at = models.DateTimeField(default=now)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(expires_at__gt=models.F("created_at")),
                name="users_childdevice_expires_later",
            ),
        ]
        indexes = [models.Index(fields=["child", "revoked_at"], name="users_childdev_child")]

    def __repr__(self) -> str:
        return f"<ChildDevice {self.id}>"


class ChildPlaySession(ChildOwnedModel):
    """A restricted gameplay session for exactly one child: the child principal.

    Opened by exchanging a verified child-pool access token (or from a remembered `ChildDevice`).
    The cookie carrying it (only its SHA-256 is stored) authenticates only the child gameplay
    routes on the allowlist in `apps.users.child_session`, only for this child, and only with
    the methods listed there: never account, child management, sign-in management, consent,
    photo upload or deletion routes.

    It ends at `expires_at` (absolute), after `LAI_CHILD_SESSION_IDLE_SECONDS` without use, on
    `revoked_at`, or when the parent or child is deactivated, the credential is suspended,
    revoked or reset, consent is withdrawn, or its remembered device is revoked. Expiry is a
    security control, not a play-time limit (ADR-053): a remembered device reopens the session
    without interrupting the child.
    """

    CHILD_LINKS = ("credential", "device")

    credential = models.ForeignKey(
        ChildCredential, on_delete=models.CASCADE, related_name="+", editable=False
    )
    device = models.ForeignKey(
        ChildDevice, on_delete=models.CASCADE, null=True, blank=True, related_name="+"
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
        ]
        indexes = [models.Index(fields=["child", "revoked_at"], name="users_playsess_child")]

    def __repr__(self) -> str:
        return f"<ChildPlaySession {self.id}>"


class ConsentPurpose(models.TextChoices):
    # The parent allows this child to sign in on their own (ADR-075). More purposes arrive with
    # the full consent design (LAI-0308, gate G9).
    CHILD_INDEPENDENT_SIGN_IN = "CHILD_INDEPENDENT_SIGN_IN", "Independent child sign-in"


class ParentConsent(ChildOwnedModel):
    """A parent's consent for one purpose for one child (the `ParentConsent` domain concept).

    Deliberately narrow until the consent design (LAI-0308, gate G9) is approved: it records
    who consented, to which approved policy text (`policy_version`), and when, and when it was
    withdrawn. A consent can only be given while `LAI_CHILD_SIGN_IN_CONSENT_VERSION` names an
    approved text, so with no approved text nobody can consent and child sign-in stays closed.
    Withdrawing it ends the child's sessions and remembered devices at once.
    """

    parent = models.ForeignKey(
        ParentAccount, on_delete=models.CASCADE, related_name="+", editable=False
    )
    purpose = models.CharField(max_length=40, choices=ConsentPurpose.choices, editable=False)
    policy_version = models.CharField(max_length=40, editable=False)
    granted_at = models.DateTimeField(default=now, editable=False)
    withdrawn_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(purpose__in=ConsentPurpose.values),
                name="users_parentconsent_purpose_valid",
            ),
            models.UniqueConstraint(
                fields=["child", "purpose"],
                condition=models.Q(withdrawn_at__isnull=True),
                name="users_parentconsent_one_live_per_purpose",
            ),
            models.CheckConstraint(
                condition=~models.Q(policy_version=""),
                name="users_parentconsent_has_policy_version",
            ),
        ]

    def __repr__(self) -> str:
        return f"<ParentConsent {self.id}>"


class ChildAccountAction(models.TextChoices):
    CONSENT_GRANTED = "CONSENT_GRANTED", "Consent given"
    CONSENT_WITHDRAWN = "CONSENT_WITHDRAWN", "Consent withdrawn"
    SIGN_IN_ENABLED = "SIGN_IN_ENABLED", "Sign-in enabled"
    LOGIN_NAME_CHANGED = "LOGIN_NAME_CHANGED", "Username changed"
    PASSWORD_SET = "PASSWORD_SET", "Password set"
    SUSPENDED = "SUSPENDED", "Sign-in paused"
    RESUMED = "RESUMED", "Sign-in resumed"
    REVOKED = "REVOKED", "Sign-in removed"
    SESSIONS_REVOKED = "SESSIONS_REVOKED", "Signed out everywhere"
    DEVICE_REVOKED = "DEVICE_REVOKED", "Remembered device removed"


class ChildAccountEvent(ChildOwnedModel):
    """An audit record of a parent's change to a child's sign-in or consent.

    An action code and a time only: never a password, token, login name, IP address or device
    detail. Child sign-ins themselves are not recorded here (sessions carry their own times).
    """

    parent = models.ForeignKey(
        ParentAccount, on_delete=models.CASCADE, related_name="+", editable=False
    )
    action = models.CharField(max_length=24, choices=ChildAccountAction.choices, editable=False)
    occurred_at = models.DateTimeField(default=now, editable=False)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(action__in=ChildAccountAction.values),
                name="users_childaccountevent_action_valid",
            ),
        ]
        indexes = [models.Index(fields=["child", "occurred_at"], name="users_acctevent_child")]

    def __repr__(self) -> str:
        return f"<ChildAccountEvent {self.id}>"
