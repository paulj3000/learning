"""Child-pool user administration (LAI-AUTH-05, ADR-075).

Django is the only thing that creates or changes users in the child Cognito pool: the pool has
no public sign-up, and a parent's request reaches it only through `apps.users.child_auth`.
This module is the narrow adapter to that pool. It knows nothing about parents or children: it
receives Django's opaque `provider_username`, the login name the child types, and a password in
transit, and returns the pool's immutable `sub`.

- `CognitoChildIdentityProvider` calls the Cognito admin API with Django's own AWS credentials
  (an IAM policy scoped to the child pool ARN and these actions only; infra/lib/childIdentity*).
  Never used by tests or local development.
- `FakeChildIdentityProvider` keeps users in memory, for local development and tests (mocked
  Cognito). It enforces the same rules the pool does (unique aliases, disabled users).
- `disabled` refuses every call, which is the default and the production default until the owner
  approves the child pool.

Passwords are never logged, returned, stored or put in an exception. Errors carry a coarse code.
"""

from __future__ import annotations

import logging
import threading
import uuid
from dataclasses import dataclass, field
from functools import lru_cache

from django.conf import settings
from django.views.decorators.debug import sensitive_variables

logger = logging.getLogger("lai.auth")


class ChildIdentityError(Exception):
    """The child pool refused or could not run a call. `code` is safe to log."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class ChildIdentityUnavailable(ChildIdentityError):
    """Not configured, network, throttling or a Cognito fault: retry later, nothing changed."""


class LoginNameTaken(ChildIdentityError):
    def __init__(self):
        super().__init__("login_name_taken")


class PasswordRejected(ChildIdentityError):
    """The pool's password policy refused the password."""

    def __init__(self):
        super().__init__("password_rejected")


class UserMissing(ChildIdentityError):
    def __init__(self):
        super().__init__("user_missing")


def child_pool_issuer() -> str:
    """The child pool's issuer URL, or "" when it is not configured."""
    region = settings.COGNITO_REGION
    pool_id = settings.COGNITO_CHILD_USER_POOL_ID
    if not (region and pool_id):
        return ""
    return f"https://cognito-idp.{region}.amazonaws.com/{pool_id}"


def new_provider_username() -> str:
    """The pool's internal username for a new child: opaque, never shown, never an identity key."""
    return f"c-{uuid.uuid4().hex}"


class ChildIdentityProvider:
    """What Django needs from the child pool. Every method is idempotent where Cognito allows."""

    def issuer(self) -> str:
        raise NotImplementedError

    def create_user(self, provider_username: str, login_name: str, password: str) -> str:
        """Create an enabled user with a permanent password; return its `sub`."""
        raise NotImplementedError

    def set_password(self, provider_username: str, password: str) -> None:
        raise NotImplementedError

    def set_login_name(self, provider_username: str, login_name: str) -> None:
        raise NotImplementedError

    def disable_user(self, provider_username: str) -> None:
        raise NotImplementedError

    def enable_user(self, provider_username: str) -> None:
        raise NotImplementedError

    def sign_out_everywhere(self, provider_username: str) -> None:
        """Revoke the user's Cognito refresh tokens (Django sessions are revoked separately)."""
        raise NotImplementedError

    def delete_user(self, provider_username: str) -> None:
        """Delete the user; deleting a user that is already gone succeeds."""
        raise NotImplementedError


def _refuse(*_args, **_kwargs):
    raise ChildIdentityUnavailable("not_configured")


class DisabledChildIdentityProvider(ChildIdentityProvider):
    """Independent child sign-in is off: every administrative call is refused, nothing changes."""

    def issuer(self) -> str:
        return ""

    create_user = set_password = set_login_name = _refuse
    disable_user = enable_user = sign_out_everywhere = delete_user = _refuse


@dataclass
class _FakeUser:
    sub: str
    login_name: str
    password_set: bool = True
    enabled: bool = True
    sign_outs: int = 0


@dataclass
class FakeChildIdentityProvider(ChildIdentityProvider):
    """In-memory child pool (mocked Cognito). Never holds a password: only that one was set."""

    pool_issuer: str = "https://cognito-idp.us-west-1.amazonaws.com/us-west-1_FakeChildPool"
    users: dict[str, _FakeUser] = field(default_factory=dict)
    fail_next: str | None = None
    min_password_length: int = 8
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def issuer(self) -> str:
        return child_pool_issuer() or self.pool_issuer

    def _maybe_fail(self):
        if self.fail_next:
            code, self.fail_next = self.fail_next, None
            raise ChildIdentityUnavailable(code)

    def _user(self, provider_username: str) -> _FakeUser:
        user = self.users.get(provider_username)
        if user is None:
            raise UserMissing
        return user

    def _check_alias(self, login_name: str, owner: str | None) -> None:
        for name, user in self.users.items():
            if name != owner and user.login_name == login_name.lower():
                raise LoginNameTaken

    @sensitive_variables("password")
    def _check_password(self, password: str) -> None:
        if not isinstance(password, str) or len(password) < self.min_password_length:
            raise PasswordRejected

    @sensitive_variables("password")
    def create_user(self, provider_username, login_name, password):
        with self._lock:
            self._maybe_fail()
            self._check_password(password)
            if provider_username in self.users:  # a retried provisioning call
                return self.users[provider_username].sub
            self._check_alias(login_name, None)
            sub = str(uuid.uuid4())
            self.users[provider_username] = _FakeUser(sub=sub, login_name=login_name.lower())
            return sub

    @sensitive_variables("password")
    def set_password(self, provider_username, password):
        with self._lock:
            self._maybe_fail()
            self._check_password(password)
            self._user(provider_username).password_set = True

    def set_login_name(self, provider_username, login_name):
        with self._lock:
            self._maybe_fail()
            user = self._user(provider_username)
            self._check_alias(login_name, provider_username)
            user.login_name = login_name.lower()

    def disable_user(self, provider_username):
        with self._lock:
            self._maybe_fail()
            self._user(provider_username).enabled = False

    def enable_user(self, provider_username):
        with self._lock:
            self._maybe_fail()
            self._user(provider_username).enabled = True

    def sign_out_everywhere(self, provider_username):
        with self._lock:
            self._maybe_fail()
            self._user(provider_username).sign_outs += 1

    def delete_user(self, provider_username):
        with self._lock:
            self._maybe_fail()
            self.users.pop(provider_username, None)


class CognitoChildIdentityProvider(ChildIdentityProvider):
    """The Cognito admin API on the child pool. Signed with Django's AWS credentials."""

    def issuer(self) -> str:
        return child_pool_issuer()

    def _call(self, operation: str, **params):
        from botocore.exceptions import BotoCoreError, ClientError

        pool_id = settings.COGNITO_CHILD_USER_POOL_ID
        if not (pool_id and settings.COGNITO_REGION):
            raise ChildIdentityUnavailable("not_configured")
        try:
            return getattr(_admin_client(settings.COGNITO_REGION), operation)(
                UserPoolId=pool_id, **params
            )
        except ClientError as error:
            code = error.response.get("Error", {}).get("Code", "")
            if code in {"UsernameExistsException", "AliasExistsException"}:
                raise LoginNameTaken from None
            if code in {"InvalidPasswordException"}:
                raise PasswordRejected from None
            if code == "UserNotFoundException":
                raise UserMissing from None
            logger.warning("child identity call failed: %s", code or "client_error")
            raise ChildIdentityUnavailable(code or "client_error") from None
        except BotoCoreError:
            logger.warning("child identity call failed: network")
            raise ChildIdentityUnavailable("network") from None

    @sensitive_variables("password")
    def create_user(self, provider_username, login_name, password):
        try:
            response = self._call(
                "admin_create_user",
                Username=provider_username,
                # The login name is the `preferred_username` alias: the child signs in with it,
                # the parent can change it, and the internal username never changes.
                UserAttributes=[{"Name": "preferred_username", "Value": login_name}],
                MessageAction="SUPPRESS",  # no email or phone exists to send anything to
            )
            attributes = response.get("User", {}).get("Attributes", [])
        except LoginNameTaken:
            # A retried call finds its own user; any other holder of the alias is a real clash.
            existing = self._existing(provider_username)
            if existing is None:
                raise
            attributes = existing
        self.set_password(provider_username, password)
        for attribute in attributes:
            if attribute.get("Name") == "sub" and isinstance(attribute.get("Value"), str):
                return attribute["Value"]
        raise ChildIdentityUnavailable("no_sub")

    def _existing(self, provider_username):
        try:
            return self._call("admin_get_user", Username=provider_username).get(
                "UserAttributes", []
            )
        except UserMissing:
            return None

    @sensitive_variables("password")
    def set_password(self, provider_username, password):
        self._call(
            "admin_set_user_password",
            Username=provider_username,
            Password=password,
            Permanent=True,
        )

    def set_login_name(self, provider_username, login_name):
        self._call(
            "admin_update_user_attributes",
            Username=provider_username,
            UserAttributes=[{"Name": "preferred_username", "Value": login_name}],
        )

    def disable_user(self, provider_username):
        self._call("admin_disable_user", Username=provider_username)

    def enable_user(self, provider_username):
        self._call("admin_enable_user", Username=provider_username)

    def sign_out_everywhere(self, provider_username):
        self._call("admin_user_global_sign_out", Username=provider_username)

    def delete_user(self, provider_username):
        try:
            self._call("admin_delete_user", Username=provider_username)
        except UserMissing:
            return


@lru_cache(maxsize=2)
def _admin_client(region: str):
    import boto3

    return boto3.client("cognito-idp", region_name=region)


_FAKE = FakeChildIdentityProvider()


def get_child_identity_provider() -> ChildIdentityProvider:
    mode = settings.LAI_CHILD_IDENTITY_PROVIDER
    if mode == "cognito":
        return CognitoChildIdentityProvider()
    if mode == "fake":
        return _FAKE
    return DisabledChildIdentityProvider()


def reset_fake_provider() -> FakeChildIdentityProvider:
    """Tests: a clean fake pool."""
    global _FAKE
    _FAKE = FakeChildIdentityProvider()
    return _FAKE
