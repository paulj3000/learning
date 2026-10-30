import logging

from django.db import DatabaseError, connection
from django.db.migrations.executor import MigrationExecutor
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

SERVICE_NAME = "learning-adventure-island"

logger = logging.getLogger(__name__)


class _ProbeView(APIView):
    """Unauthenticated, unthrottled, uncached GET probe. Subclasses return only fixed words."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes: list = []
    http_method_names = ["get", "head", "options"]

    def _respond(self, body: dict, status: int = 200) -> Response:
        response = Response(body, status=status)
        response["Cache-Control"] = "no-store"
        return response


class HealthView(_ProbeView):
    """Liveness probe: Django is up and routing works.

    Deliberately does no database, AWS, or business work and needs no authentication, so it is
    safe for monitors to call often. It is not a readiness check; ReadinessView checks the
    database instead of weakening this one.
    """

    def get(self, request):
        return self._respond({"status": "ok", "service": SERVICE_NAME})


def _database_check() -> str:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except DatabaseError as exc:
        # Type only: a driver message can carry the host name or user (ADR-025).
        logger.warning("readiness database check failed: %s", type(exc).__name__)
        return "error"
    return "ok"


def _migrations_check() -> str:
    try:
        executor = MigrationExecutor(connection)
        plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
    except DatabaseError as exc:
        logger.warning("readiness migration check failed: %s", type(exc).__name__)
        return "error"
    return "pending" if plan else "ok"


class ReadinessView(_ProbeView):
    """Readiness probe for the load balancer and the release script (ADR-037).

    Ready means the database answers and every migration this image knows is applied, so a
    container whose release skipped `migrate` never takes traffic. An older image after a rollback
    is still ready: migrations it does not know about are not "pending" for it. The body holds
    fixed words only (no host names, versions, or error text), and the status is 503 when not ready.
    """

    def get(self, request):
        checks = {"database": _database_check()}
        checks["migrations"] = _migrations_check() if checks["database"] == "ok" else "skipped"
        ready = all(value == "ok" for value in checks.values())
        return self._respond(
            {"status": "ok" if ready else "unavailable", "service": SERVICE_NAME, "checks": checks},
            status=200 if ready else 503,
        )
