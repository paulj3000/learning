"""The child-session allowlist is the whole of a child's API surface (ADR-075). Pinned here.

A route joins `CHILD_SESSION_ROUTES` only after a review that its view acts only on `self.child`
(never on the parent's other children or account). These tests make the list fail closed: an
entry that does not match a real child-scoped route, a method the view does not have, or a
parent-control route is a failure, not a silent no-op.
"""

from apps.users.child_session import CHILD_SESSION_ROUTES, _normalized
from apps.users.scoping import ChildScopedMixin
from apps.users.tests.test_tenant_isolation import walk

# Parent controls: never reachable with a child session, whatever the method.
FORBIDDEN_FRAGMENTS = (
    "sign-in/",
    "consents/",
    "photo/",
    "game-launches/",
    "ai/history/",
    "ai/safety-events/",
    "coop-sessions/",
)


def _routes():
    from config import urls

    return {route: callback for route, callback in walk(urls.urlpatterns)}


def test_every_allowlisted_route_is_a_real_child_scoped_route():
    routes = _routes()
    normalized = {_normalized(route): callback for route, callback in routes.items()}
    for route, methods in CHILD_SESSION_ROUTES.items():
        assert route in normalized, route
        cls = normalized[route].cls
        assert issubclass(cls, ChildScopedMixin), route
        assert "<uuid:child_id>" in route, route
        implemented = {m.upper() for m in ("get", "post", "put", "patch") if hasattr(cls, m)}
        # Every write a child may make is a write the view has; a listed read the view lacks
        # is only a 405, but the entry must still match something the view does.
        assert methods - {"HEAD", "OPTIONS", "GET"} <= implemented, (route, methods, implemented)
        assert methods & implemented, (route, methods, implemented)


def test_no_child_session_route_deletes_or_reaches_a_parent_control():
    for route, methods in CHILD_SESSION_ROUTES.items():
        assert "DELETE" not in methods, route
        assert not any(fragment in route for fragment in FORBIDDEN_FRAGMENTS), route


def test_routes_without_a_child_never_take_a_child_session():
    assert all(
        route.startswith("api/v1/children/<uuid:child_id>/") for route in CHILD_SESSION_ROUTES
    )


def test_no_view_bypasses_the_scoping_hooks():
    """The child-session authenticator is added only by `ChildScopedMixin.get_authenticators`."""
    for route, callback in _routes().items():
        cls = getattr(callback, "cls", None)
        if cls is None or not issubclass(cls, ChildScopedMixin):
            continue
        for name in ("get_authenticators",):
            owner = next(k for k in cls.__mro__ if name in vars(k))
            assert owner.__name__ in {"ChildScopedMixin", "APIView"}, (route, owner)
        assert "ChildSessionAuthentication" not in [
            a.__name__ for a in getattr(cls, "authentication_classes", [])
        ], route
