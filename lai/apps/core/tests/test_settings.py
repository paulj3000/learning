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


PROD_ENV = {
    "DJANGO_SECRET_KEY": "x" * 50,
    "DJANGO_ALLOWED_HOSTS": "api.example.test",
    "DATABASE_URL": "postgresql://u:p@db.internal:5432/lai",
    "COGNITO_REGION": "us-test-1",
    "COGNITO_USER_POOL_ID": "us-test-1_TESTPOOL1",
    "COGNITO_ALLOWED_CLIENT_IDS": "client-one,client-two",
}


def _prod_env(monkeypatch, **overrides):
    for name, value in {**PROD_ENV, **overrides}.items():
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)


def test_production_fails_without_required_values(monkeypatch):
    _prod_env(monkeypatch, **{name: None for name in PROD_ENV})
    with pytest.raises(ImproperlyConfigured, match="DJANGO_SECRET_KEY"):
        _load("config.settings.production")


@pytest.mark.parametrize("hosts", ["", "*"])
def test_production_rejects_missing_or_wildcard_hosts(monkeypatch, hosts):
    _prod_env(monkeypatch, DJANGO_ALLOWED_HOSTS=hosts)
    with pytest.raises(ImproperlyConfigured, match="DJANGO_ALLOWED_HOSTS"):
        _load("config.settings.production")


@pytest.mark.parametrize(
    "name, value",
    [
        ("COGNITO_REGION", None),
        ("COGNITO_USER_POOL_ID", None),
        ("COGNITO_ALLOWED_CLIENT_IDS", None),
        ("COGNITO_ALLOWED_CLIENT_IDS", " , "),
        ("COGNITO_USER_POOL_ID", "eu-test-9_OTHERREGION"),
    ],
)
def test_production_requires_consistent_cognito_settings(monkeypatch, name, value):
    _prod_env(monkeypatch, **{name: value})
    with pytest.raises(ImproperlyConfigured):
        _load("config.settings.production")


def test_production_is_secure_when_configured(monkeypatch):
    _prod_env(monkeypatch, DJANGO_TRUST_PROXY_SSL_HEADER=None)
    prod = _load("config.settings.production")
    assert prod.DEBUG is False
    assert prod.ALLOWED_HOSTS == ["api.example.test"]
    assert prod.COGNITO_ALLOWED_CLIENT_IDS == ["client-one", "client-two"]
    assert prod.SECURE_SSL_REDIRECT is True
    assert prod.SESSION_COOKIE_SECURE and prod.CSRF_COOKIE_SECURE
    assert prod.SECURE_HSTS_SECONDS > 0
    assert not hasattr(prod, "SECURE_PROXY_SSL_HEADER")
    assert not hasattr(prod, "CORS_ALLOW_ALL_ORIGINS")


def test_production_serves_the_admin_securely(monkeypatch):
    _prod_env(monkeypatch, DJANGO_CSRF_TRUSTED_ORIGINS="https://admin.example.test")
    prod = _load("config.settings.production")
    assert prod.CSRF_TRUSTED_ORIGINS == ["https://admin.example.test"]
    security = prod.MIDDLEWARE.index("django.middleware.security.SecurityMiddleware")
    assert prod.MIDDLEWARE[security + 1] == "whitenoise.middleware.WhiteNoiseMiddleware"
    assert "whitenoise" in prod.STORAGES["staticfiles"]["BACKEND"]
    assert prod.SECURE_REDIRECT_EXEMPT == [r"^api/v1/health/$"]
    assert prod.SESSION_COOKIE_PATH == prod.CSRF_COOKIE_PATH == "/admin/"
    # The shared base list is not mutated for other settings modules.
    assert "whitenoise.middleware.WhiteNoiseMiddleware" not in settings.MIDDLEWARE


@pytest.mark.parametrize(
    "value, expected",
    [(None, "static/"), ("/static/", "/static/"), ("https://cdn.example.test/admin/", None)],
)
def test_production_static_url_defaults_to_the_admin_host_path(monkeypatch, value, expected):
    _prod_env(monkeypatch, DJANGO_STATIC_URL=value)
    prod = _load("config.settings.production")
    assert prod.STATIC_URL == (expected or value)


@pytest.mark.parametrize(
    "value", ["http://cdn.example.test/", "//cdn.example.test/", "https://cdn.example.test/x"]
)
def test_production_rejects_unsafe_static_urls(monkeypatch, value):
    _prod_env(monkeypatch, DJANGO_STATIC_URL=value)
    with pytest.raises(ImproperlyConfigured, match="DJANGO_STATIC_URL"):
        _load("config.settings.production")


def test_static_build_settings_need_no_database_or_secrets(monkeypatch):
    for name in PROD_ENV:
        monkeypatch.delenv(name, raising=False)
    build = _load("config.settings.static_build")
    assert build.DATABASES == {} and build.DEBUG is False
    assert build.STORAGES == _load("config.settings.base").MANIFEST_STATIC_STORAGES


@pytest.mark.parametrize(
    "origins", ["http://admin.example.test", "https://*.example.test", "admin.example.test"]
)
def test_production_rejects_unsafe_csrf_trusted_origins(monkeypatch, origins):
    _prod_env(monkeypatch, DJANGO_CSRF_TRUSTED_ORIGINS=origins)
    with pytest.raises(ImproperlyConfigured, match="DJANGO_CSRF_TRUSTED_ORIGINS"):
        _load("config.settings.production")


@pytest.mark.parametrize("path", ["/admin/", "admin", "api/admin/", "Admin/", "../x/"])
def test_the_admin_path_must_be_a_plain_relative_prefix(monkeypatch, path):
    monkeypatch.setenv("DJANGO_ADMIN_URL_PATH", path)
    with pytest.raises(ImproperlyConfigured, match="DJANGO_ADMIN_URL_PATH"):
        _load("config.settings.base")


def test_the_admin_path_can_move_and_the_cookies_follow(monkeypatch):
    monkeypatch.setenv("DJANGO_ADMIN_URL_PATH", "staff/django-admin/")
    base = _load("config.settings.base")
    assert base.SESSION_COOKIE_PATH == base.CSRF_COOKIE_PATH == "/staff/django-admin/"
    monkeypatch.delenv("DJANGO_ADMIN_URL_PATH")
    assert _load("config.settings.base").ADMIN_URL_PATH == "admin/"  # leave the default loaded


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

    # pytest-django swapped in an isolated database; the developer's own database is untouched.
    assert connection.settings_dict["NAME"].startswith("test_")
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
        assert cursor.fetchone() == (1,)
    assert 160000 <= connection.cursor().connection.info.server_version < 170000
    call_command("migrate", "--check", verbosity=0)


@pytest.mark.postgres
@pytest.mark.django_db
def test_no_pending_model_changes():
    call_command("makemigrations", "--check", "--dry-run", verbosity=0)
