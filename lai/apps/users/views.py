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
    """

    def get_permissions(self):
        permission = IsVerifiedPrincipal if self.request.method == "POST" else IsProvisionedParent
        return [permission()]

    def get(self, request):
        return Response({"id": str(request.user.pk)})

    def post(self, request):
        user = request.user
        if isinstance(user, UnprovisionedParent):
            account, created = services.provision_parent_account(user.cognito_sub)
        else:
            account, created = user, False
        return Response({"id": str(account.pk)}, status=201 if created else 200)
