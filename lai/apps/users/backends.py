"""Django password backends.

`AdminPasswordBackend` (LAI-0404, ADR-034) is Django Admin sign-in. It matches an `admin_username`
and a Django password, and only for active staff rows. A parent who signs in with Cognito has no
admin username and an unusable password, so it can never authenticate one. It never authenticates
the API.

`LocalParentPasswordBackend` (LAI-AUTH-DUAL, ADR-038) is the local-development parent sign-in. It
is listed only by local settings (and test settings, which switch AUTH_PROVIDER per test), and it
refuses everything unless AUTH_PROVIDER=django, so even a misconfigured backend list cannot let a
password reach the API in an AWS environment. It matches only local parent rows (the
`LOCAL_PARENT_SUB_PREFIX` placeholder sub), never a Cognito-linked parent or an admin username.
"""

from django.conf import settings
from django.contrib.auth.backends import ModelBackend
from django.views.decorators.debug import sensitive_variables

from .models import LOCAL_PARENT_SUB_PREFIX, ParentAccount


class AdminPasswordBackend(ModelBackend):
    """Admin-username sign-in; ModelBackend supplies the group and permission lookups."""

    @sensitive_variables("password")
    def authenticate(self, request, username=None, password=None, **kwargs):
        if not username or not password:
            return None
        account = ParentAccount.objects.filter(admin_username=username).first()
        if account is None:
            # Run the hasher anyway so an unknown username takes as long as a wrong password.
            ParentAccount().set_password(password)
            return None
        if account.check_password(password) and self._may_sign_in(account):
            return account
        return None

    def get_user(self, user_id):
        account = ParentAccount.objects.filter(pk=user_id).first()
        return account if account is not None and self._may_sign_in(account) else None

    @staticmethod
    def _may_sign_in(account: ParentAccount) -> bool:
        return (
            account.is_active
            and account.is_staff
            and bool(account.admin_username)
            and account.has_usable_password()
        )


class LocalParentPasswordBackend(ModelBackend):
    """Local parent sign-in by username and Django password. AUTH_PROVIDER=django only."""

    @sensitive_variables("password")
    def authenticate(self, request, username=None, password=None, **kwargs):
        if settings.AUTH_PROVIDER != "django" or not username or not password:
            return None
        sub = LOCAL_PARENT_SUB_PREFIX + username
        account = ParentAccount.objects.filter(cognito_sub=sub).first()
        if account is None:
            ParentAccount().set_password(password)  # same timing as a wrong password
            return None
        if account.check_password(password) and self._may_sign_in(account):
            return account
        return None

    def get_user(self, user_id):
        account = ParentAccount.objects.filter(pk=user_id).first()
        return account if account is not None and self._may_sign_in(account) else None

    @staticmethod
    def _may_sign_in(account: ParentAccount) -> bool:
        return (
            settings.AUTH_PROVIDER == "django"
            and account.is_active
            and account.cognito_sub.startswith(LOCAL_PARENT_SUB_PREFIX)
            and account.has_usable_password()
        )
