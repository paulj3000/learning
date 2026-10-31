"""Local development sign-in (LAI-AUTH-DUAL, ADR-038). AUTH_PROVIDER=django only.

    GET  /api/v1/auth/csrf/     {"csrfToken"}; also sets the CSRF cookie
    POST /api/v1/auth/login/    {"username", "password"} -> {"id", "django_admin"}; starts a session
    POST /api/v1/auth/logout/   204; ends the session

With any other provider every route is a 404 `not_found`, as if it did not exist (Django Admin
keeps its own login page in every environment). Login and logout need the CSRF token
(`X-CSRFToken`) and pass Django's Origin check, although nobody is signed in yet for login: a
cross-site page must not be able to sign a browser in to an account it chose. `GET me/` is the
"who am I" call in both modes. Usernames and passwords are never logged.
"""

from django.conf import settings
from django.contrib.auth import login as django_login
from django.contrib.auth import logout as django_logout
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.debug import sensitive_post_parameters, sensitive_variables
from rest_framework import exceptions
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .authentication import enforce_csrf
from .backends import LocalParentPasswordBackend
from .views import _account_body

MAX_CREDENTIAL_LENGTH = 256


class InvalidCredentials(exceptions.APIException):
    status_code = 400
    default_code = "invalid_credentials"
    default_detail = "That username and password did not match."


class LocalAuthView(APIView):
    """Exists only while AUTH_PROVIDER=django. Reads the session itself, not through DRF."""

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def initial(self, request, *args, **kwargs):
        if settings.AUTH_PROVIDER != "django":
            raise exceptions.NotFound
        super().initial(request, *args, **kwargs)


class LocalCsrfView(LocalAuthView):
    def get(self, request):
        return Response({"csrfToken": get_token(request._request)})


@method_decorator(sensitive_post_parameters("password"), name="dispatch")
class LocalLoginView(LocalAuthView):
    @sensitive_variables("password")
    def post(self, request):
        enforce_csrf(request)
        body = request.data if isinstance(request.data, dict) else {}
        username, password = body.get("username"), body.get("password")
        if not all(
            isinstance(value, str) and 0 < len(value) <= MAX_CREDENTIAL_LENGTH
            for value in (username, password)
        ):
            raise InvalidCredentials
        # The local backend directly, not `authenticate()`: an admin username and password must
        # never start a gameplay session, even locally.
        account = LocalParentPasswordBackend().authenticate(
            request._request, username=username.strip(), password=password
        )
        if account is None:
            raise InvalidCredentials
        # Rotates the session key and the CSRF token (the client fetches a new token after this).
        django_login(request._request, account, backend=settings.LOCAL_PARENT_BACKEND)
        return Response(_account_body(account))


class LocalLogoutView(LocalAuthView):
    def post(self, request):
        enforce_csrf(request)
        django_logout(request._request)  # flushes the session, signed in or not
        return Response(status=204)
