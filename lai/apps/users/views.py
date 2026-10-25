from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .authentication import UnprovisionedParent
from .permissions import IsProvisionedParent, IsVerifiedPrincipal


class MeView(APIView):
    """The signed-in parent's own account.

    GET never creates anything: an unprovisioned parent gets 403 `account_not_provisioned`.
    POST provisions the account once (201) and is idempotent afterwards (200). It reads the
    identity only from the verified token, takes no request body, creates no children, and
    grants no privileges.

    GET also returns `django_admin`: whether this account is active Django Admin staff (LAI-0404,
    ADR-034). It only lets the React menu show an "Admin" link; Django Admin checks its own
    session sign-in on every request and never trusts this value. A Cognito group never sets it.
    """

    def get_permissions(self):
        permission = IsVerifiedPrincipal if self.request.method == "POST" else IsProvisionedParent
        return [permission()]

    def get(self, request):
        user = request.user
        return Response({"id": str(user.pk), "django_admin": bool(user.is_active and user.is_staff)})

    def post(self, request):
        user = request.user
        if isinstance(user, UnprovisionedParent):
            account, created = services.provision_parent_account(user.cognito_sub)
        else:
            account, created = user, False
        return Response({"id": str(account.pk)}, status=201 if created else 200)
