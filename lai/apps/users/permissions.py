"""Permission classes. The default (`IsProvisionedParent`) is deny-by-default for the whole API."""

from rest_framework.exceptions import NotAuthenticated, PermissionDenied
from rest_framework.permissions import BasePermission

from .authentication import LocalSession, UnprovisionedParent, VerifiedToken
from .models import ParentAccount


class AccountNotProvisioned(PermissionDenied):
    default_code = "account_not_provisioned"
    default_detail = "Account setup is required."


class SensitiveActionUnavailable(PermissionDenied):
    default_code = "sensitive_action_unavailable"
    default_detail = "This action is not available."


class IsVerifiedPrincipal(BasePermission):
    """A verified Cognito token (provisioned or not), or a local Django sign-in (ADR-038).

    Used only by onboarding. A local session is always a provisioned `ParentAccount`.
    """

    def has_permission(self, request, view):
        if not isinstance(request.auth, VerifiedToken | LocalSession):
            raise NotAuthenticated
        return True


class IsProvisionedParent(IsVerifiedPrincipal):
    """Default for every view: a verified principal that maps to an active `ParentAccount`."""

    def has_permission(self, request, view):
        super().has_permission(request, view)
        user = request.user
        if isinstance(user, UnprovisionedParent):
            raise AccountNotProvisioned
        return isinstance(user, ParentAccount) and user.is_active


class SensitiveActionBlocked(BasePermission):
    """Denies everything (ADR-024 A3, LAI-0209).

    Account and child deletion, consent changes, and privileged administrative mutations need
    recent authentication plus a revocation-aware check that does not exist yet. A view that
    performs one of them must declare this class until LAI-0209 replaces it, so the endpoint
    cannot work by accident.
    """

    def has_permission(self, request, view):
        raise SensitiveActionUnavailable
