"""Tenant isolation for child-scoped endpoints (LAI-0403).

Run against private probe routes (`probe_urls.py`), because no child-data API exists yet. The
fixtures (`families`, `api`, `token_for`) live in `lai/conftest.py` for reuse by future endpoints.
"""

import ast
import inspect
import logging
import re
import uuid
from pathlib import Path

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import URLPattern, URLResolver

from apps.users import scoping, services
from apps.users.models import ChildProfile
from apps.users.scoping import ChildScopedMixin

from .helpers import access_claims

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

LAI_ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(autouse=True)
def probe_routes(settings):
    settings.ROOT_URLCONF = "apps.users.tests.probe_urls"


def probe(child):
    return f"/api/v1/children/{child.pk}/probe/"


def contract(response):
    """Everything an outside caller can observe, minus the per-request id."""
    body = response.json()
    body.pop("request_id", None)
    return (
        response.status_code,
        body,
        response["Content-Type"],
        response.get("WWW-Authenticate"),
        response.get("Allow"),
    )


# --- the authorization matrix -------------------------------------------------------------------


def test_a_parent_can_reach_each_of_their_own_children(families, api):
    client = api(families.a)
    for child in (families.a1, families.a2):
        response = client.get(probe(child))
        assert response.status_code == 200 and response.json() == {"child": str(child.pk)}


def test_the_other_family_can_reach_theirs(families, api):
    client = api(families.b)
    assert client.get(probe(families.b1)).status_code == 200
    assert client.get(probe(families.b2)).status_code == 200


@pytest.mark.parametrize("actor, target", [("a", "b1"), ("a", "b2"), ("b", "a1"), ("b", "a2")])
def test_a_parent_cannot_read_the_other_familys_children(families, api, actor, target):
    response = api(getattr(families, actor)).get(probe(getattr(families, target)))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_unknown_and_foreign_ids_are_indistinguishable(families, api):
    client = api(families.a)
    foreign = contract(client.get(probe(families.b1)))
    unknown = contract(client.get(f"/api/v1/children/{uuid.uuid4()}/probe/"))
    assert foreign == unknown
    assert foreign[0] == 404


def test_foreign_and_unknown_ids_cost_the_same_queries(families, api):
    client = api(families.a)

    def count(url):
        with CaptureQueriesContext(connection) as queries:
            client.get(url)
        return len(queries)

    assert count(probe(families.b1)) == count(f"/api/v1/children/{uuid.uuid4()}/probe/")


def test_error_bodies_never_contain_ids_or_names(families, api):
    body = api(families.a).get(probe(families.b1)).content.decode()
    for secret in (str(families.b1.pk), str(families.b.pk), "Quince", "Secret-Interest"):
        assert secret not in body


def test_unauthenticated_requests_are_denied_for_every_child(families, api):
    for child in (families.a1, families.b1):
        response = api().get(probe(child))
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "not_authenticated"
        assert response["WWW-Authenticate"] == "Bearer"


def test_invalid_and_expired_tokens_are_denied(families, api, cognito, token_for):
    expired = cognito.sign(access_claims(families.a.cognito_sub, exp=1))
    for token in ("garbage", expired, cognito.sign(access_claims(), kid="nope")):
        response = api(token=token).get(probe(families.a1))
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "authentication_failed"


def test_an_unprovisioned_identity_is_denied_even_for_an_existing_child(families, api):
    response = api("sub-never-onboarded").get(probe(families.a1))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "account_not_provisioned"


def test_an_inactive_parent_is_denied(families, api):
    families.a.is_active = False
    families.a.save()
    assert api(families.a).get(probe(families.a1)).status_code == 403


def test_a_deleted_parent_loses_access_immediately(families, api):
    client = api(families.b)
    families.b1.delete()
    families.b2.delete()
    families.b.delete()
    assert client.get(probe(families.a1)).status_code == 403  # token still valid, no account


# --- writes -------------------------------------------------------------------------------------


def patch(client, child, **body):
    return client.patch(probe(child), body, content_type="application/json")


def test_own_child_can_be_modified(families, api):
    assert patch(api(families.a), families.a1, active=False).status_code == 200
    families.a1.refresh_from_db()
    assert families.a1.active is False


def test_foreign_child_is_not_modified_and_nothing_is_written(families, api):
    client = api(families.a)
    with CaptureQueriesContext(connection) as queries:
        response = patch(client, families.b1, active=False)
    assert response.status_code == 404
    families.b1.refresh_from_db()
    assert families.b1.active is True
    writes = [q["sql"] for q in queries if q["sql"].split()[0] in {"UPDATE", "INSERT", "DELETE"}]
    assert writes == []  # no mutation happened before the error


def test_ownership_cannot_be_supplied_by_the_client(families, api):
    spoof = {"active": False, "parent": str(families.a.pk), "parent_id": str(families.a.pk)}
    assert patch(api(families.a), families.b1, **spoof).status_code == 404
    families.b1.refresh_from_db()
    assert families.b1.active is True and families.b1.parent_id == families.b.pk
    response = api(families.a).get(probe(families.b1) + f"?parent={families.b.pk}&parent_id=1")
    assert response.status_code == 404
    own = api(families.a).get(probe(families.a1) + f"?parent={families.b.pk}")
    assert own.json() == {"child": str(families.a1.pk)}


def test_services_do_not_let_a_child_move_to_another_parent(families):
    other = services.get_owned_child_profile(families.a, families.a1.pk)
    assert other.parent_id == families.a.pk
    assert ChildProfile._meta.get_field("parent").editable is False
    with pytest.raises(services.ChildProfileNotFound):
        services.get_owned_child_profile(families.a, families.b1.pk)
    assert list(services.list_child_profiles(families.a)) == [families.a1, families.a2]


# --- administrators ---------------------------------------------------------------------------


def test_an_admin_group_token_gets_no_cross_family_access(families, api, cognito):
    admin_token = cognito.sign(
        access_claims(families.a.cognito_sub, **{"cognito:groups": ["Admins"]})
    )
    client = api(token=admin_token)
    assert client.get(probe(families.a1)).status_code == 200
    for foreign in (families.b1, families.b2):
        assert client.get(probe(foreign)).status_code == 404
    assert patch(client, families.b1, active=False).status_code == 404
    families.b1.refresh_from_db()
    assert families.b1.active is True


def _code_identifiers(module):
    """Names, attributes, and string literals in the code, excluding docstrings."""
    tree = ast.parse(inspect.getsource(module))
    docstrings = {
        id(node.body[0].value)
        for node in ast.walk(tree)
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef))
        and node.body
        and isinstance(node.body[0], ast.Expr)
        and isinstance(node.body[0].value, ast.Constant)
    }
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            found.add(node.id)
        elif isinstance(node, ast.Attribute):
            found.add(node.attr)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            if id(node) not in docstrings:
                found.add(node.value)
    return found


def test_the_scoping_helpers_never_read_group_claims():
    for module in (scoping, services):
        identifiers = _code_identifiers(module)
        assert not identifiers & {"groups", "Admins", "is_staff", "cognito:groups", "auth"}


# --- nested, child-owned records ----------------------------------------------------------------


class DoesNotExist(Exception):
    pass


class FakeRecords:
    """Stands in for a queryset of child-owned rows (no table). Records how it was filtered."""

    model = type("Record", (), {"DoesNotExist": DoesNotExist})

    def __init__(self, rows):
        self.rows, self.filters = rows, []

    def filter(self, **kwargs):
        self.filters.append(kwargs)
        return FakeRecords([r for r in self.rows if r["child"] == kwargs.get("child")])

    def get(self, pk):
        for row in self.rows:
            if row["pk"] == pk:
                return type("R", (), {"pk": pk})
        raise DoesNotExist


def test_nested_records_resolve_only_through_the_authorized_child(families, api, monkeypatch):
    mine, theirs = uuid.uuid4(), uuid.uuid4()
    rows = [{"pk": mine, "child": families.a1}, {"pk": theirs, "child": families.a2}]
    fake = FakeRecords(rows)
    from apps.users.tests.probe_urls import NestedProbe

    monkeypatch.setattr(NestedProbe, "queryset_factory", staticmethod(lambda: fake))
    client = api(families.a)
    url = "/api/v1/children/{}/records/{}/"
    assert client.get(url.format(families.a1.pk, mine)).status_code == 200
    # Child A1 is authorized, but the record belongs to child A2: must not be reachable.
    assert client.get(url.format(families.a1.pk, theirs)).status_code == 404
    assert client.get(url.format(families.a1.pk, uuid.uuid4())).status_code == 404
    # Child B1 is not authorized at all: the record is never even looked up.
    fake.filters.clear()
    assert client.get(url.format(families.b1.pk, mine)).status_code == 404
    assert fake.filters == []
    assert all(f == {"child": families.a1} for f in fake.filters) or fake.filters == []


def test_the_mixin_scopes_by_the_authorized_child_object():
    class View(ChildScopedMixin):
        pass

    view, fake = View(), FakeRecords([])
    view.child = "the-child"
    view.scoped(fake)
    assert fake.filters == [{"child": "the-child"}]


# --- structural guards: fail if future code drops the pattern ---------------------------------


def walk(patterns, prefix=""):
    for entry in patterns:
        if isinstance(entry, URLResolver):
            yield from walk(entry.url_patterns, prefix + str(entry.pattern))
        elif isinstance(entry, URLPattern):
            yield prefix + str(entry.pattern), entry.callback


PUBLIC = {"api/v1/health/"}
PARENT_SCOPED = {"api/v1/me/"}


def unscoped_routes(urlpatterns):
    """Routes that are neither explicitly public, parent-scoped, nor correctly child-scoped."""
    bad = []
    for route, callback in walk(urlpatterns):
        if route in PUBLIC | PARENT_SCOPED:
            continue
        cls = getattr(callback, "cls", None)
        if "<uuid:child_id>" in route and cls and issubclass(cls, ChildScopedMixin):
            continue
        bad.append(route)
    return bad


def test_every_real_route_is_public_parent_scoped_or_child_scoped():
    from config import urls

    assert unscoped_routes(urls.urlpatterns) == []


def test_the_route_checker_accepts_compliant_and_flags_non_compliant_routes():
    from apps.users.tests import probe_urls

    assert unscoped_routes(probe_urls.urlpatterns) == []
    assert unscoped_routes(probe_urls.leaky_urlpatterns) == [
        "api/v1/children/<uuid:child_id>/leaky/"
    ]


def test_only_the_public_routes_allow_any_and_child_routes_keep_default_permissions():
    from apps.users.tests import probe_urls

    for route, callback in walk(probe_urls.urlpatterns):
        names = [p.__name__ for p in callback.cls.permission_classes]
        assert ("AllowAny" in names) == (route in PUBLIC), route
        if "<uuid:child_id>" in route:
            assert names == ["IsProvisionedParent"], route


def test_child_profiles_are_only_queried_through_the_services_module():
    pattern = re.compile(r"\bChildProfile\.objects\b")
    offenders = []
    for path in (LAI_ROOT / "apps").rglob("*.py"):
        parts = path.relative_to(LAI_ROOT).parts
        if "tests" in parts or "migrations" in parts or path.name in {"services.py", "models.py"}:
            continue
        if pattern.search(path.read_text()):
            offenders.append(str(path.relative_to(LAI_ROOT)))
    assert offenders == []


def test_no_view_reads_a_parent_from_the_request():
    """Views may read the parent only from `request.user`, never from client-supplied data."""
    forbidden = re.compile(r"(request\.(data|query_params|GET|POST)|kwargs)[^\n]*parent", re.I)
    offenders = []
    for path in (LAI_ROOT / "apps").rglob("*.py"):
        if "tests" in path.relative_to(LAI_ROOT).parts:
            continue
        if forbidden.search(path.read_text()):
            offenders.append(path.name)
    assert offenders == []
    assert ast.parse(inspect.getsource(scoping))  # the module itself parses


def test_scoping_is_applied_after_authentication_and_permissions():
    source = inspect.getsource(ChildScopedMixin.initial)
    assert source.index("super().initial") < source.index("get_owned_child_profile")


# --- logging ------------------------------------------------------------------------------------


def test_authorization_failures_log_no_child_or_identity_data(families, api, caplog):
    secrets = [str(families.b1.pk), "Quince", "Secret-Interest", families.b.cognito_sub]
    with caplog.at_level(logging.DEBUG):
        api(families.a).get(probe(families.b1))
        patch(api(families.a), families.b1, active=False)
        api("sub-never-onboarded").get(probe(families.a1))
    text = " ".join(r.getMessage() for r in caplog.records)
    assert "GET api/v1/children/<uuid:child_id>/probe/ 404" in text
    for secret in secrets + [families.a.cognito_sub, "sub-never-onboarded", "Zinnia"]:
        assert secret not in text
