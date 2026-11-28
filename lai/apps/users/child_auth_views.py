"""Child sign-in and the parent's child-account management API (LAI-AUTH-03 to 07, ADR-075).

Child side (`/api/v1/child-auth/...`), no parent token involved:

- `POST session/` exchanges a child-pool access token (`Authorization: Bearer`, the child pool
  only) for the child session cookie, and with `{"remember": true}` a remembered-device cookie.
- `POST session/restore/` reopens a session from the remembered-device cookie.
- `GET session/` says who is signed in (the child's own id, nickname, age band) and gives the
  CSRF value for writes. The child id the app routes to comes from here, never from the app.
- `POST session/end/` signs out: the session ends and the remembered device is forgotten.

Parent side (`/api/v1/children/<id>/sign-in/...`), a parent bearer token only (the default
authenticator; a child session never reaches these routes). Anything that grants or restores
access needs a recent parent sign-in (`RequiresRecentAuthentication`, ADR-043): enabling,
password, username, resume, removal and giving consent. Protective actions do not, so a parent
can act at once: pause, sign out everywhere, forget a device, withdraw consent.

No response ever contains a password, token, cookie value or device detail.
"""

import logging

from django.conf import settings
from django.utils.decorators import method_decorator
from django.views.decorators.debug import sensitive_post_parameters
from rest_framework import exceptions, serializers
from rest_framework.authentication import get_authorization_header
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from rest_framework.views import APIView

from apps.core.exceptions import _CODED, error_body

from . import child_auth
from .authentication import verify_child_access_token
from .child_session import CSRF_HEADER, origin_allowed
from .permissions import IsProvisionedParent, RequiresRecentAuthentication
from .scoping import ChildScopedAPIView

logger = logging.getLogger("lai.auth")

SIGN_IN_HEADER = "HTTP_X_LAI_CHILD_SIGN_IN"


class ChildSignInThrottle(AnonRateThrottle):
    scope = "child_sign_in"


class ChildAccountThrottle(UserRateThrottle):
    scope = "child_account"


def _coded(status: int, code: str) -> type[exceptions.APIException]:
    """An API error class with its own stable code (apps.core.exceptions._CODED has the text)."""
    return type(
        f"ChildAuth_{code}",
        (exceptions.APIException,),
        {"status_code": status, "default_code": code, "default_detail": code},
    )


ChildSignInUnavailable = _coded(403, "child_sign_in_unavailable")

_DOMAIN_ERRORS = {
    child_auth.ProfileUnavailable: exceptions.NotFound,
    child_auth.CredentialUnavailable: _coded(404, "child_sign_in_not_found"),
    child_auth.LoginNameInvalid: _coded(400, "login_name_invalid"),
    child_auth.LoginNameUnavailable: _coded(409, "login_name_unavailable"),
    child_auth.PasswordInvalid: _coded(400, "password_invalid"),
    child_auth.AlreadyEnabled: _coded(409, "child_sign_in_exists"),
    child_auth.ConsentRequired: _coded(409, "consent_required"),
    child_auth.ConsentUnavailable: _coded(409, "consent_unavailable"),
    child_auth.IdentityServiceUnavailable: _coded(503, "child_identity_unavailable"),
}


def _raise_domain(error: child_auth.ChildAuthError):
    raise _DOMAIN_ERRORS.get(type(error), exceptions.ValidationError)() from None


def _set_session_cookie(response, value: str) -> None:
    response.set_cookie(
        settings.LAI_CHILD_SESSION_COOKIE_NAME,
        value,
        max_age=settings.LAI_CHILD_SESSION_MAX_SECONDS,
        path=settings.LAI_CHILD_SESSION_COOKIE_PATH,
        secure=settings.LAI_CHILD_COOKIE_SECURE,
        httponly=True,
        samesite="Strict",
    )


def _set_device_cookie(response, value: str | None) -> None:
    if value is None:
        _clear_device_cookie(response)
        return
    response.set_cookie(
        settings.LAI_CHILD_DEVICE_COOKIE_NAME,
        value,
        max_age=settings.LAI_CHILD_DEVICE_REMEMBER_SECONDS,
        path=settings.LAI_CHILD_DEVICE_COOKIE_PATH,
        secure=settings.LAI_CHILD_COOKIE_SECURE,
        httponly=True,
        samesite="Strict",
    )


def _clear_session_cookie(response) -> None:
    response.delete_cookie(
        settings.LAI_CHILD_SESSION_COOKIE_NAME,
        path=settings.LAI_CHILD_SESSION_COOKIE_PATH,
        samesite="Strict",
    )


def _clear_device_cookie(response) -> None:
    response.delete_cookie(
        settings.LAI_CHILD_DEVICE_COOKIE_NAME,
        path=settings.LAI_CHILD_DEVICE_COOKIE_PATH,
        samesite="Strict",
    )


def _session_body(session) -> dict:
    child = session.child
    return {
        "child": {
            "id": str(child.pk),
            "nickname": child.nickname,
            "ageBand": child.age_band,
            "avatarKey": child.avatar_key,
        },
        "csrfToken": child_auth.session_csrf_token(session),
        "expiresAt": session.expires_at,
        "remembered": session.device_id is not None,
    }


def _require_same_origin_post(request) -> None:
    """Cookie-carrying child-auth POSTs: a custom header (forces a CORS preflight) and Origin."""
    if request.META.get(SIGN_IN_HEADER) != "1" or not origin_allowed(request):
        raise exceptions.PermissionDenied


def _refused(error: child_auth.SignInRefused) -> exceptions.APIException:
    logger.info("child sign-in refused: %s", error.reason)  # reason code only
    return ChildSignInUnavailable()


class _ChildAuthView(APIView):
    """No default authenticator: these routes read only the child cookies or a child-pool token."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ChildSignInThrottle]

    def get_authenticate_header(self, request):
        return "Bearer"  # so a refused token is 401, as on every other route


class SignInBody(serializers.Serializer):
    remember = serializers.BooleanField(required=False, default=False)


class ChildSessionView(_ChildAuthView):
    def post(self, request):
        parts = get_authorization_header(request).split()
        if len(parts) != 2 or parts[0].lower() != b"bearer":
            raise exceptions.NotAuthenticated
        try:
            token = parts[1].decode("ascii")
        except UnicodeDecodeError:
            raise exceptions.AuthenticationFailed from None
        issuer, verified = verify_child_access_token(token)  # 401 / 503, reason code logged
        body = SignInBody(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            result = child_auth.sign_in_with_token(
                issuer,
                verified,
                remember=body.validated_data["remember"],
                session_value=request.COOKIES.get(settings.LAI_CHILD_SESSION_COOKIE_NAME),
                device_value=request.COOKIES.get(settings.LAI_CHILD_DEVICE_COOKIE_NAME),
            )
        except child_auth.SignInRefused as error:
            raise _refused(error) from None
        response = Response(_session_body(result.session), status=201)
        _set_session_cookie(response, result.session_value)
        _set_device_cookie(response, result.device_value)
        return response

    def get(self, request):
        session = child_auth.session_for_value(
            request.COOKIES.get(settings.LAI_CHILD_SESSION_COOKIE_NAME)
        )
        if session is None:
            raise exceptions.NotAuthenticated
        return Response(_session_body(session))


class ChildSessionRestoreView(_ChildAuthView):
    def post(self, request):
        _require_same_origin_post(request)
        try:
            result = child_auth.sign_in_with_device(
                request.COOKIES.get(settings.LAI_CHILD_DEVICE_COOKIE_NAME),
                session_value=request.COOKIES.get(settings.LAI_CHILD_SESSION_COOKIE_NAME),
            )
        except child_auth.SignInRefused as error:
            _refused(error)
            # A refused remembered device is forgotten on this browser too.
            response = Response(
                error_body("child_sign_in_unavailable", _CODED["child_sign_in_unavailable"]),
                status=403,
            )
            _clear_device_cookie(response)
            return response
        response = Response(_session_body(result.session), status=201)
        _set_session_cookie(response, result.session_value)
        _set_device_cookie(response, result.device_value)
        return response


class ChildSessionEndView(_ChildAuthView):
    def post(self, request):
        session_value = request.COOKIES.get(settings.LAI_CHILD_SESSION_COOKIE_NAME)
        session = child_auth.session_for_value(session_value)
        if session is not None and not child_auth.session_csrf_matches(
            session, request.META.get(CSRF_HEADER)
        ):
            raise exceptions.PermissionDenied
        if session is None:
            _require_same_origin_post(request)
        child_auth.sign_out(
            session_value, request.COOKIES.get(settings.LAI_CHILD_DEVICE_COOKIE_NAME)
        )
        response = Response(status=204)
        _clear_session_cookie(response)
        _clear_device_cookie(response)
        return response


# --- parent management ---------------------------------------------------------------------------


class EnableBody(serializers.Serializer):
    username = serializers.CharField(max_length=64, trim_whitespace=False)
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)


class PasswordBody(serializers.Serializer):
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)


class UsernameBody(serializers.Serializer):
    username = serializers.CharField(max_length=64, trim_whitespace=False)


def _closed(serializer_class, data):
    body = serializer_class(data=data)
    body.is_valid(raise_exception=True)
    extra = set(data) - set(serializer_class().fields) if hasattr(data, "keys") else set()
    if extra:
        raise exceptions.ValidationError({"non_field_errors": ["Unexpected fields."]})
    return body.validated_data


def _overview(request, child_id):
    try:
        overview = child_auth.account_overview(request.user, child_id)
    except child_auth.ChildAuthError as error:
        _raise_domain(error)
    sign_in = overview["sign_in"]
    return {
        "consent": overview["consent"],
        "signIn": None
        if sign_in is None
        else {
            "status": sign_in["status"],
            "username": sign_in["username"],
            "createdAt": sign_in["created_at"],
            "passwordSetAt": sign_in["password_set_at"],
            "activeSessions": sign_in["active_sessions"],
            "rememberedDevices": sign_in["remembered_devices"],
        },
        "recentChanges": [
            {"action": e["action"], "occurredAt": e["occurred_at"]}
            for e in overview["recent_changes"]
        ],
    }


class _ParentManagementView(ChildScopedAPIView):
    throttle_classes = [ChildAccountThrottle]
    #: Methods that grant or restore access and so need a recent parent sign-in.
    recent_auth_methods: frozenset[str] = frozenset()

    def get_permissions(self):
        if self.request.method in self.recent_auth_methods:
            return [IsProvisionedParent(), RequiresRecentAuthentication()]
        return [IsProvisionedParent()]

    def respond(self, request, child_id, status=200, **extra):
        body = _overview(request, child_id)
        body.update(extra)
        return Response(body, status=status)


@method_decorator(sensitive_post_parameters("password"), name="dispatch")
class ChildSignInView(_ParentManagementView):
    """GET the overview; POST enables sign-in; PATCH changes the username; DELETE removes it."""

    recent_auth_methods = frozenset({"POST", "PATCH", "DELETE"})

    def get(self, request, child_id):
        return self.respond(request, child_id)

    def post(self, request, child_id):
        data = _closed(EnableBody, request.data)
        try:
            child_auth.enable_sign_in(
                request.user,
                self.child.pk,
                login_name=data["username"],
                password=data["password"],
            )
        except child_auth.ChildAuthError as error:
            _raise_domain(error)
        return self.respond(request, child_id, status=201)

    def patch(self, request, child_id):
        data = _closed(UsernameBody, request.data)
        try:
            child_auth.change_login_name(request.user, self.child.pk, login_name=data["username"])
        except child_auth.ChildAuthError as error:
            _raise_domain(error)
        return self.respond(request, child_id)

    def delete(self, request, child_id):
        try:
            result = child_auth.remove_sign_in(request.user, self.child.pk)
        except child_auth.ChildAuthError as error:
            _raise_domain(error)
        return self.respond(request, child_id, providerSynced=result.provider_synced)


@method_decorator(sensitive_post_parameters("password"), name="dispatch")
class ChildPasswordView(_ParentManagementView):
    recent_auth_methods = frozenset({"POST"})

    def post(self, request, child_id):
        data = _closed(PasswordBody, request.data)
        try:
            child_auth.set_password(request.user, self.child.pk, password=data["password"])
        except child_auth.ChildAuthError as error:
            _raise_domain(error)
        return self.respond(request, child_id)


class ChildSuspendView(_ParentManagementView):
    def post(self, request, child_id):
        try:
            result = child_auth.suspend_sign_in(request.user, self.child.pk)
        except child_auth.ChildAuthError as error:
            _raise_domain(error)
        return self.respond(request, child_id, providerSynced=result.provider_synced)


class ChildResumeView(_ParentManagementView):
    recent_auth_methods = frozenset({"POST"})

    def post(self, request, child_id):
        try:
            child_auth.resume_sign_in(request.user, self.child.pk)
        except child_auth.ChildAuthError as error:
            _raise_domain(error)
        return self.respond(request, child_id)


class ChildSignOutEverywhereView(_ParentManagementView):
    def post(self, request, child_id):
        try:
            result = child_auth.sign_out_everywhere(request.user, self.child.pk)
        except child_auth.ChildAuthError as error:
            _raise_domain(error)
        return self.respond(request, child_id, providerSynced=result.provider_synced)


class ChildDeviceListView(_ParentManagementView):
    def get(self, request, child_id):
        devices = child_auth.list_devices(request.user, self.child.pk)
        return Response(
            {
                "devices": [
                    {
                        "id": str(d.pk),
                        "rememberedAt": d.created_at,
                        "lastUsedAt": d.last_used_at,
                        "expiresAt": d.expires_at,
                    }
                    for d in devices
                ]
            }
        )


class ChildDeviceView(_ParentManagementView):
    def delete(self, request, child_id, device_id):
        try:
            child_auth.revoke_device(request.user, self.child.pk, device_id)
        except child_auth.ChildAuthError as error:
            _raise_domain(error)
        return Response(status=204)


class ChildSignInConsentView(_ParentManagementView):
    """POST gives consent (recent sign-in); DELETE withdraws it (immediate, protective)."""

    recent_auth_methods = frozenset({"POST"})

    def get(self, request, child_id):
        return self.respond(request, child_id)

    def post(self, request, child_id):
        try:
            child_auth.grant_sign_in_consent(request.user, self.child.pk)
        except child_auth.ChildAuthError as error:
            _raise_domain(error)
        return self.respond(request, child_id, status=201)

    def delete(self, request, child_id):
        try:
            child_auth.withdraw_sign_in_consent(request.user, self.child.pk)
        except child_auth.ChildAuthError as error:
            _raise_domain(error)
        return self.respond(request, child_id)
