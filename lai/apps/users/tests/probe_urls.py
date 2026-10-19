"""Private test-only routes that exercise the child-scoping rules. Never installed in settings.

They return ids only (never nicknames) and expose no real CRUD. `leaky_urls` holds one
deliberately non-compliant view so the route checker can be shown to catch it.
"""

from django.urls import path
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.scoping import ChildScopedAPIView
from config.urls import handler400, handler403, handler404, handler500  # noqa: F401
from config.urls import urlpatterns as real_patterns


class ChildProbe(ChildScopedAPIView):
    def get(self, request, child_id):
        return Response({"child": str(self.child.pk)})

    def patch(self, request, child_id):
        # Ownership comes from the authorized child, never from the body.
        type(self.child).objects.filter(pk=self.child.pk).update(
            active=bool(request.data.get("active", self.child.active))
        )
        return Response({"child": str(self.child.pk)})


class NestedProbe(ChildScopedAPIView):
    """Shows the nested-record pattern with a stand-in queryset (no model or table is created)."""

    queryset_factory = None  # set by tests

    def get(self, request, child_id, record_id):
        record = self.get_scoped_object(self.queryset_factory(), record_id)
        return Response({"record": str(record.pk)})


class LeakyProbe(APIView):
    """Non-compliant on purpose: takes a child id without scoping."""

    def get(self, request, child_id):  # pragma: no cover - only inspected, never called
        return Response({})


probe_patterns = [
    path("api/v1/children/<uuid:child_id>/probe/", ChildProbe.as_view()),
    path("api/v1/children/<uuid:child_id>/records/<uuid:record_id>/", NestedProbe.as_view()),
]
urlpatterns = [*probe_patterns, *real_patterns]
leaky_urlpatterns = [
    path("api/v1/children/<uuid:child_id>/leaky/", LeakyProbe.as_view()),
    *real_patterns,
]
