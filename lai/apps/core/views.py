from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

SERVICE_NAME = "learning-adventure-island"


class HealthView(APIView):
    """Liveness probe: Django is up and routing works.

    Deliberately does no database, AWS, or business work and needs no authentication, so it is
    safe for monitors to call often. It is not a readiness check; add a separate endpoint for
    dependency checks rather than weakening this one.
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes: list = []
    http_method_names = ["get", "head", "options"]

    def get(self, request):
        response = Response({"status": "ok", "service": SERVICE_NAME})
        response["Cache-Control"] = "no-store"
        return response
