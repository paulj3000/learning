"""Permission classes. The default (`IsProvisionedParent`) is deny-by-default for the whole API."""

from rest_framework.exceptions import NotAuthenticated, PermissionDenied
from rest_framework.permissions import BasePermission

from .authentication import UnprovisionedParent, VerifiedToken
from .models import ParentAccount


class AccountNotProvisioned(PermissionDenied):
    default_code = "account_not_provisioned"
    default_detail = "Account setup is required."


class SensitiveActionUnavailable(PermissionDenied):
    default_code = "sensitive_action_unavailable"
    default_detail = "This action is not available."


class IsVerifiedPrincipal(BasePermission):
    """A verified Cognito token, provisioned or not. Used only by onboarding."""

    def has_permission(self, request, view):
        if not isinstance(request.auth, VerifiedToken):
            raise NotAuthenticated
        return True


class IsProvisionedParent(IsVerifiedPrincipal):
    """Default for every view: a verified token that maps to an active `ParentAccount`."""

    def has_permission(self, request, view):
        super().has_permission(request, view)
        user = request.user
        if isinstance(user, UnprovisionedParent):
            raise AccountNotProvisioned
        return isinstance(user, ParentAccount) and user.is_active


class RequiresRecentAuthentication(BasePermission):
    """A sensitive action: the parent must have signed in recently (LAI-0209, ADR-043).

    List it **after** the permissions that decide whether the caller may do the action at all
    (for example `IsProvisionedParent`, `IsAssetAdministrator`): DRF checks them in order, so a
    caller without the right is refused as unauthorized and is never invited to sign in again,
    and recent sign-in never grants a right. Object-level checks (a child resolved through its
    parent) still run afterwards and still answer 404 for another family's child.
    See `apps.users.recent_auth` for the evidence and the answers.
    """

    def has_permission(self, request, view):
        from .recent_auth import require_recent_authentication

        require_recent_authentication(request)
        return True


class SensitiveActionBlocked(BasePermission):
    """Denies everything (ADR-024 A3).

    For a sensitive action whose own specification is not done yet (account deletion, consent
    changes). Child deletion and the asset administrator's changes use
    `RequiresRecentAuthentication` (LAI-0209); a new sensitive endpoint declares this class
    until its specification says which guard applies, so it cannot work by accident.
    """

    def has_permission(self, request, view):
        raise SensitiveActionUnavailable
