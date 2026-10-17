import importlib
import sys

import pytest
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command


def _load(name):
    sys.modules.pop(name, None)
    return importlib.import_module(name)


def test_running_under_test_settings_on_loopback_database():
    assert settings.SETTINGS_MODULE == "config.settings.test"
    assert settings.DEBUG is False
    assert settings.DATABASES["default"]["HOST"] == "127.0.0.1"


def test_test_settings_ignore_database_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@prod.example.com:5432/prod")
    module = _load("config.settings.test")
    assert module.DATABASES["default"]["HOST"] == "127.0.0.1"
    assert "prod" not in module.DATABASES["default"]["NAME"]


def test_test_settings_refuse_a_remote_postgres_host(monkeypatch):
    monkeypatch.setenv("POSTGRES_HOST", "db.example.com")
    with pytest.raises(RuntimeError):
        _load("config.settings.test")


def test_base_and_local_settings_import(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert "apps.core" in _load("config.settings.base").INSTALLED_APPS
    local = _load("config.settings.local")
    assert local.DEBUG is True
    assert local.DATABASES["default"]["HOST"] == "127.0.0.1"


def test_local_settings_use_database_url_when_given(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://a:b@localhost:5544/thing")
    db = _load("config.settings.local").DATABASES["default"]
    assert (db["USER"], db["HOST"], db["PORT"], db["NAME"]) == ("a", "localhost", "5544", "thing")


def test_production_fails_without_required_values(monkeypatch):
    for name in ("DJANGO_SECRET_KEY", "DJANGO_ALLOWED_HOSTS", "DATABASE_URL"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(ImproperlyConfigured, match="DJANGO_SECRET_KEY"):
        _load("config.settings.production")


@pytest.mark.parametrize("hosts", ["", "*"])
def test_production_rejects_missing_or_wildcard_hosts(monkeypatch, hosts):
    monkeypatch.setenv("DJANGO_SECRET_KEY", "x" * 50)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@db.internal:5432/lai")
    monkeypatch.setenv("DJANGO_ALLOWED_HOSTS", hosts)
    with pytest.raises(ImproperlyConfigured, match="DJANGO_ALLOWED_HOSTS"):
        _load("config.settings.production")


def test_production_is_secure_when_configured(monkeypatch):
    monkeypatch.setenv("DJANGO_SECRET_KEY", "x" * 50)
    monkeypatch.setenv("DJANGO_ALLOWED_HOSTS", "api.example.test")
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@db.internal:5432/lai")
    monkeypatch.delenv("DJANGO_TRUST_PROXY_SSL_HEADER", raising=False)
    prod = _load("config.settings.production")
    assert prod.DEBUG is False
    assert prod.ALLOWED_HOSTS == ["api.example.test"]
    assert prod.SECURE_SSL_REDIRECT is True
    assert prod.SESSION_COOKIE_SECURE and prod.CSRF_COOKIE_SECURE
    assert prod.SECURE_HSTS_SECONDS > 0
    assert not hasattr(prod, "SECURE_PROXY_SSL_HEADER")
    assert not hasattr(prod, "CORS_ALLOW_ALL_ORIGINS")


def test_production_does_not_hardcode_infrastructure():
    from pathlib import Path

    source = (
        Path(__file__).resolve().parents[3].joinpath("config/settings/production.py").read_text()
    )
    assert "arn:aws" not in source
    assert "amazonaws.com" not in source


def test_database_url_must_be_postgres():
    from config.settings.base import database_from_url

    with pytest.raises(ImproperlyConfigured):
        database_from_url("mysql://u:p@h/db")


def test_django_system_check_is_clean():
    call_command("check")


@pytest.mark.postgres
@pytest.mark.django_db
def test_postgres_16_connection_and_framework_migrations():
    from django.db import connection

    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        assert cursor.fetchone() == (1,)
    assert 160000 <= connection.cursor().connection.info.server_version < 170000
    call_command("migrate", "--check", verbosity=0)


def test_no_pending_model_changes():
    call_command("makemigrations", "--check", "--dry-run", verbosity=0)
