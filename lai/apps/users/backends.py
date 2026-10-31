"""Django Admin sign-in (LAI-0404, ADR-034). The only Django authentication backend.

Matches an `admin_username` and a Django password, and only for active staff rows. A parent who
signs in with Cognito has no admin username and an unusable password, so this backend can never
authenticate one. It is not used by the API: DRF authenticates with Cognito bearer tokens only.
"""

from django.contrib.auth.backends import ModelBackend
from django.views.decorators.debug import sensitive_variables

from .models import ParentAccount


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
