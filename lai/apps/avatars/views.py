"""`GET /api/v1/children/<child_id>/avatar/`: the child's 3D avatar (LAI-JMP-01c).

Child-scoped like every play route: the parent is the token's account, the child is resolved
through that parent, and someone else's child is a 404. Read-only; staff configure avatars in
Django Admin. The answer names only published data (`apps.avatars.services`).
"""

from rest_framework.response import Response

from apps.users.scoping import ChildScopedAPIView

from .services import child_avatar


class ChildAvatarView(ChildScopedAPIView):
    """Parent bearer token only. The game-runtime cookie is deliberately not accepted here: its
    route allow-list (`test_tenant_isolation.py`) is a security boundary, widened only on purpose.
    """

    def get(self, request, child_id):
        response = Response(child_avatar(self.child))
        response["Cache-Control"] = "private, no-cache"  # a thumbnail URL inside expires
        return response
