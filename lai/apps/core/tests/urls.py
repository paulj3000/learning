"""Throwaway routes that show how future domain APIs use the shared conventions.

Used only by tests (selected with the `api_urls` fixture); never installed in real settings.
"""

from django.urls import path
from rest_framework import exceptions, serializers
from rest_framework.authentication import BaseAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from config.urls import handler400, handler403, handler404, handler500  # noqa: F401
from config.urls import urlpatterns as real_patterns


class ExampleSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=20)
    count = serializers.IntegerField(min_value=1)

    def validate(self, attrs):
        if attrs["name"] == "forbidden":
            raise serializers.ValidationError("That name is not allowed.", code="name_blocked")
        return attrs


class ValidateView(APIView):
    """The convention: `serializer.is_valid(raise_exception=True)`; no hand-built 400s."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ExampleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(serializer.validated_data, status=201)


class DefaultsView(APIView):
    """Declares nothing: must inherit deny-by-default."""

    def get(self, request):  # pragma: no cover - must never run
        return Response({"leak": True})


class BearerOnly(BaseAuthentication):
    def authenticate(self, request):
        return None

    def authenticate_header(self, request):
        return 'Bearer realm="api"'


class BearerView(APIView):
    authentication_classes = [BearerOnly]

    def get(self, request):  # pragma: no cover - must never run
        return Response({})


class RaisingView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, kind):
        if kind == "denied":
            raise exceptions.PermissionDenied("child Ann may not see this")
        if kind == "missing":
            raise exceptions.NotFound("no child named Ann")
        if kind == "throttled":
            raise exceptions.Throttled(wait=7)
        if kind == "failed":
            raise exceptions.AuthenticationFailed("token for Ann is bad")
        raise RuntimeError("secret child data: Ann")


urlpatterns = [
    path("api/v1/example/validate/", ValidateView.as_view()),
    path("api/v1/example/defaults/", DefaultsView.as_view()),
    path("api/v1/example/bearer/", BearerView.as_view()),
    path("api/v1/example/raise/<str:kind>/", RaisingView.as_view()),
    *real_patterns,
]
