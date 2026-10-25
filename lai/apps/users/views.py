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

    Both return `{"id", "django_admin"}`. `django_admin` says whether this account is active Django
    Admin staff (LAI-0404, ADR-034). The React app POSTs once after every sign-in, which creates the
    account the first time and reads the flag in the same call. The flag only decides whether the
    React menu shows an "Admin" link: Django Admin checks its own session sign-in on every request
    and never trusts it, and a Cognito group never sets it.
    """

    def get_permissions(self):
        permission = IsVerifiedPrincipal if self.request.method == "POST" else IsProvisionedParent
        return [permission()]

    def get(self, request):
        return Response(_account_body(request.user))

    def post(self, request):
        user = request.user
        if isinstance(user, UnprovisionedParent):
            account, created = services.provision_parent_account(user.cognito_sub)
        else:
            account, created = user, False
        return Response(_account_body(account), status=201 if created else 200)


def _account_body(account):
    return {"id": str(account.pk), "django_admin": bool(account.is_active and account.is_staff)}
