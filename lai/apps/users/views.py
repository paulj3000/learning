from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import exceptions
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .authentication import UnprovisionedParent
from .permissions import IsProvisionedParent, IsVerifiedPrincipal, SensitiveActionBlocked
from .scoping import ChildScopedAPIView
from .serializers import ChildProfileSerializer, ChildProfileWrite, model_errors


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
    and never trusts it, and a Cognito group never sets it. The Android app makes the same call
    (docs/android/ANDROID_AUTH_FLOW.md).
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


class ChildProfileLimitReached(exceptions.APIException):
    status_code = 409
    default_code = "child_profile_limit_reached"
    default_detail = "No more child profiles can be added."


class ChildListView(APIView):
    """GET the signed-in parent's children; POST creates one (LAI-ANDROID-API-001).

    Parent-scoped: the owner is always `request.user`. At most `MAX_CHILD_PROFILES` profiles,
    active or not (409 `child_profile_limit_reached`).
    """

    def get(self, request):
        children = services.list_child_profiles(request.user)
        return Response({"children": ChildProfileSerializer(children, many=True).data})

    def post(self, request):
        body = ChildProfileWrite(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            child = services.create_child_profile(request.user, **body.model_fields())
        except services.ChildProfileLimitReached:
            raise ChildProfileLimitReached from None
        except DjangoValidationError as error:
            raise model_errors(error) from None
        return Response(ChildProfileSerializer(child).data, status=201)


class ChildDetailView(ChildScopedAPIView):
    """GET or PATCH one of the parent's children. DELETE is blocked until LAI-0602/LAI-0209."""

    def get_permissions(self):
        if self.request.method == "DELETE":
            return [IsProvisionedParent(), SensitiveActionBlocked()]
        return super().get_permissions()

    def get(self, request, child_id):
        return Response(ChildProfileSerializer(self.child).data)

    def patch(self, request, child_id):
        body = ChildProfileWrite(data=request.data, partial=True)
        body.is_valid(raise_exception=True)
        try:
            child = services.update_child_profile(
                request.user, self.child.pk, **body.model_fields()
            )
        except services.ChildProfileNotFound:
            raise exceptions.NotFound from None
        except DjangoValidationError as error:
            raise model_errors(error) from None
        return Response(ChildProfileSerializer(child).data)

    def delete(self, request, child_id):  # pragma: no cover - SensitiveActionBlocked denies first
        raise exceptions.PermissionDenied
