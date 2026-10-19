"""Tenant isolation for child-scoped API views (LAI-0403, ADR-022 and ADR-024).

The rule every child-data endpoint must follow:

1. The parent is the authenticated `request.user` (a verified token mapped to a `ParentAccount`).
   It is never read from the URL, query string, or body.
2. The child comes from the URL (`<uuid:child_id>`) and is resolved *through that parent* by
   `ChildScopedMixin`, before the handler runs. Someone else's child and a nonexistent child give
   the same 404 `not_found`, from the same code path.
3. Records that belong to the child (progress, inventory, quests, ...) are fetched only with
   `self.scoped(queryset)` / `self.get_scoped_object(queryset, pk)`, which add
   `child=self.child`. A nested record id from the URL is never looked up on its own.
4. An `Admins` group claim changes none of this. Cross-family administration will be a separate,
   audited code path (LAI-0404), never these helpers.

Using the mixin does not secure an endpoint by itself: the handler must go through `self.child`,
`self.scoped`, and `self.get_scoped_object`, and tests must prove the cross-parent cases (see
docs/TESTING_STRATEGY.md, "Child-scoped endpoint checklist").
"""

from uuid import UUID

from rest_framework.exceptions import NotFound
from rest_framework.views import APIView

from . import services
from .models import ChildProfile, ParentAccount
from .permissions import AccountNotProvisioned

CHILD_URL_KWARG = "child_id"


class ChildScopedMixin:
    """Resolves `self.child` from `child_id` for the authenticated parent, or raises 404.

    Works on any DRF view or viewset (it hooks `initial`, which runs after authentication and
    permission checks, so unauthenticated callers get 401 and unprovisioned ones 403 first).
    """

    child: ChildProfile

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        parent = request.user
        if not isinstance(parent, ParentAccount):  # e.g. a view that loosened its permissions
            raise AccountNotProvisioned
        try:
            self.child = services.get_owned_child_profile(parent, kwargs.get(CHILD_URL_KWARG))
        except services.ChildProfileNotFound:
            raise NotFound from None

    def scoped(self, queryset):
        """Restrict a queryset of child-owned records (a `child` foreign key) to this child."""
        return queryset.filter(child=self.child)

    def get_scoped_object(self, queryset, pk):
        """One child-owned record by id, only if it belongs to this child; otherwise 404."""
        try:
            record_id = pk if isinstance(pk, UUID) else UUID(str(pk))
            return self.scoped(queryset).get(pk=record_id)
        except (ValueError, queryset.model.DoesNotExist):
            raise NotFound from None


class ChildScopedAPIView(ChildScopedMixin, APIView):
    """Base class for child-scoped views. It adds no endpoints and no CRUD."""
