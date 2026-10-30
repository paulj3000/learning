"""Readiness probe (ADR-037): database and migrations, fixed-word body, 503 when not ready."""

import pytest
from django.db import DatabaseError
from django.test import Client
from django.urls import resolve, reverse

from apps.core import views

URL = "/api/v1/health/ready/"


def test_routing():
    assert reverse("health-ready") == URL
    assert resolve(URL).view_name == "health-ready"


@pytest.mark.django_db
def test_ready_when_database_answers_and_migrations_are_applied():
    response = Client().get(URL)
    assert response.status_code == 200
    assert response["Cache-Control"] == "no-store"
    assert response.json() == {
        "status": "ok",
        "service": "learning-adventure-island",
        "checks": {"database": "ok", "migrations": "ok"},
    }


@pytest.mark.django_db
def test_not_ready_when_migrations_are_pending(monkeypatch):
    monkeypatch.setattr(views, "_migrations_check", lambda: "pending")
    response = Client().get(URL)
    assert response.status_code == 503
    assert response.json()["checks"] == {"database": "ok", "migrations": "pending"}
    assert response.json()["status"] == "unavailable"


class _BrokenCursor:
    def __enter__(self):
        raise DatabaseError("could not connect to server at db.secret-host.internal user=admin")

    def __exit__(self, *exc):
        return False


def test_not_ready_when_database_is_down_and_no_detail_leaks(monkeypatch, caplog):
    monkeypatch.setattr(views.connection, "cursor", lambda: _BrokenCursor())
    response = Client().get(URL)
    assert response.status_code == 503
    body = response.json()
    assert body["checks"] == {"database": "error", "migrations": "skipped"}
    assert "secret-host" not in response.content.decode()
    assert "secret-host" not in caplog.text
    assert "DatabaseError" in caplog.text


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_rejects_unsupported_methods(method):
    assert getattr(Client(), method)(URL).status_code == 405


def test_needs_no_authentication_and_ignores_bearer_tokens(monkeypatch):
    monkeypatch.setattr(views, "_database_check", lambda: "ok")
    monkeypatch.setattr(views, "_migrations_check", lambda: "ok")
    response = Client().get(URL, HTTP_AUTHORIZATION="Bearer not-a-token")
    assert response.status_code == 200
