import pytest
from django.test import Client
from django.urls import resolve, reverse

EXPECTED = {"status": "ok", "service": "learning-adventure-island"}


def test_health_returns_ok_json():
    response = Client().get("/api/v1/health/")
    assert response.status_code == 200
    assert response["Content-Type"] == "application/json"
    assert response["Cache-Control"] == "no-store"
    assert response.json() == EXPECTED


def test_health_schema_has_exactly_two_string_fields():
    body = Client().get("/api/v1/health/").json()
    assert set(body) == {"status", "service"}
    assert all(isinstance(value, str) for value in body.values())


def test_health_needs_no_authentication_header():
    assert Client().get("/api/v1/health/").status_code == 200


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_health_rejects_unsupported_methods(method):
    response = getattr(Client(), method)("/api/v1/health/")
    assert response.status_code == 405
    assert "GET" in response["Allow"]


def test_health_head_and_options_are_allowed():
    assert Client().head("/api/v1/health/").status_code == 200
    assert Client().options("/api/v1/health/").status_code == 200


def test_health_touches_no_database():
    # Without the django_db marker pytest-django raises on any database access.
    assert Client().get("/api/v1/health/").status_code == 200


def test_routing():
    assert reverse("health") == "/api/v1/health/"
    assert resolve("/api/v1/health/").view_name == "health"
    assert Client().get("/api/v1/nope/").status_code == 404
    assert Client().get("/health/").status_code == 404


def test_missing_trailing_slash_redirects_to_canonical_url():
    response = Client().get("/api/v1/health")
    assert response.status_code == 301
    assert response["Location"] == "/api/v1/health/"


def test_other_api_routes_are_denied_by_default():
    # A view that does not opt out of the default permission class is rejected.
    from rest_framework.test import APIRequestFactory
    from rest_framework.views import APIView

    class Guarded(APIView):
        def get(self, request):  # pragma: no cover - must never run
            raise AssertionError

    response = Guarded.as_view()(APIRequestFactory().get("/x"))
    assert response.status_code in {401, 403}
