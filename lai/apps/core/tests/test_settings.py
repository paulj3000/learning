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
    "LAI_ASSET_STORAGE": "s3",
    "LAI_ASSET_BUCKET": "lai-assets-test",
    "LAI_ASSET_REGION": "us-test-1",
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
    assert prod.SECURE_REDIRECT_EXEMPT == [r"^api/v1/health/$", r"^api/v1/health/ready/$"]
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


@pytest.mark.parametrize(
    "overrides",
    [
        {"LAI_ASSET_STORAGE": None},
        {"LAI_ASSET_STORAGE": "local"},
        {"LAI_ASSET_BUCKET": None},
        {"LAI_ASSET_REGION": None},
    ],
)
def test_production_requires_private_s3_asset_storage(monkeypatch, overrides):
    _prod_env(monkeypatch, **overrides)
    with pytest.raises(ImproperlyConfigured, match="LAI_ASSET_"):
        _load("config.settings.production")


@pytest.mark.parametrize(
    "name, value",
    [
        ("LAI_ASSET_STORAGE", "ftp"),
        ("LAI_ASSET_DELIVERY", "public"),
        ("LAI_ASSET_URL_TTL_SECONDS", "5"),
        ("LAI_ASSET_URL_TTL_SECONDS", "999999"),
    ],
)
def test_asset_settings_reject_unsafe_values(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ImproperlyConfigured, match=name.replace("_SECONDS", "")):
        _load("config.settings.base")
    monkeypatch.delenv(name)
    _load("config.settings.base")  # leave the default loaded


CLOUDFRONT_ENV = {
    "LAI_ASSET_DELIVERY": "cloudfront",
    "LAI_ASSET_CLOUDFRONT_DOMAIN": "d111111abcdef8.cloudfront.net",
    "LAI_ASSET_CLOUDFRONT_KEY_PAIR_ID": "K2JCJMDEHXQW5F",
    "LAI_ASSET_CLOUDFRONT_PRIVATE_KEY_B64": "c2VjcmV0",
}


def test_production_accepts_complete_cloudfront_delivery(monkeypatch):
    """AM-11: off unless chosen; when chosen, domain, key id and key are all explicit."""
    _prod_env(monkeypatch, **CLOUDFRONT_ENV)
    _load("config.settings.base")  # production star-imports base, so reload it first
    loaded = _load("config.settings.production")
    assert loaded.LAI_ASSET_DELIVERY == "cloudfront"
    assert loaded.LAI_ASSET_CLOUDFRONT_DOMAIN == "d111111abcdef8.cloudfront.net"
    for name in CLOUDFRONT_ENV:
        monkeypatch.delenv(name)
    assert _load("config.settings.base").LAI_ASSET_DELIVERY == "django"  # leave the default loaded


@pytest.mark.parametrize(
    "name, value",
    [
        ("LAI_ASSET_CLOUDFRONT_DOMAIN", None),
        ("LAI_ASSET_CLOUDFRONT_DOMAIN", "https://d111111abcdef8.cloudfront.net"),
        ("LAI_ASSET_CLOUDFRONT_DOMAIN", "d111111abcdef8.cloudfront.net/assets"),
        ("LAI_ASSET_CLOUDFRONT_DOMAIN", "localhost"),
        ("LAI_ASSET_CLOUDFRONT_KEY_PAIR_ID", None),
        ("LAI_ASSET_CLOUDFRONT_KEY_PAIR_ID", "APKAEXAMPLE"),
        ("LAI_ASSET_CLOUDFRONT_PRIVATE_KEY_B64", None),
        ("LAI_ASSET_STORAGE", "local"),
    ],
)
def test_cloudfront_delivery_refuses_incomplete_settings(monkeypatch, name, value):
    for key, setting in CLOUDFRONT_ENV.items():
        monkeypatch.setenv(key, setting)
    monkeypatch.setenv("LAI_ASSET_STORAGE", "s3")
    if value is None:
        monkeypatch.delenv(name)
    else:
        monkeypatch.setenv(name, value)
    with pytest.raises(ImproperlyConfigured, match="LAI_ASSET_"):
        _load("config.settings.base")
    for key in [*CLOUDFRONT_ENV, "LAI_ASSET_STORAGE"]:
        monkeypatch.delenv(key, raising=False)
    _load("config.settings.base")  # leave the default loaded


def test_production_child_photos_default_to_off_never_local(monkeypatch):
    """LAI-0904, ADR-042: S3 or disabled; unset is disabled so an early release still starts."""
    _prod_env(monkeypatch, LAI_CHILD_PHOTO_STORAGE=None)
    assert _load("config.settings.production").LAI_CHILD_PHOTO_STORAGE == "disabled"
    for backend in ("local", "memory"):
        _prod_env(monkeypatch, LAI_CHILD_PHOTO_STORAGE=backend)
        with pytest.raises(ImproperlyConfigured, match="LAI_CHILD_PHOTO_STORAGE"):
            _load("config.settings.production")


@pytest.mark.parametrize("missing", ["LAI_CHILD_PHOTOS_BUCKET", "LAI_CHILD_PHOTOS_REGION"])
def test_production_s3_child_photos_need_bucket_and_region(monkeypatch, missing):
    photo_env = {
        "LAI_CHILD_PHOTO_STORAGE": "s3",
        "LAI_CHILD_PHOTOS_BUCKET": "lai-child-photos-test",
        "LAI_CHILD_PHOTOS_REGION": "us-test-1",
    }
    _prod_env(monkeypatch, **photo_env)
    assert _load("config.settings.production").LAI_CHILD_PHOTOS_BUCKET == "lai-child-photos-test"
    _prod_env(monkeypatch, **{**photo_env, missing: None})
    with pytest.raises(ImproperlyConfigured, match=missing):
        _load("config.settings.production")


def test_production_child_photos_never_share_the_asset_bucket(monkeypatch):
    _prod_env(
        monkeypatch,
        LAI_CHILD_PHOTO_STORAGE="s3",
        LAI_CHILD_PHOTOS_BUCKET=PROD_ENV["LAI_ASSET_BUCKET"],
        LAI_CHILD_PHOTOS_REGION="us-test-1",
    )
    with pytest.raises(ImproperlyConfigured, match="must not be the asset bucket"):
        _load("config.settings.production")


@pytest.mark.parametrize(
    "name, value",
    [
        ("LAI_CHILD_PHOTO_STORAGE", "public"),
        ("LAI_CHILD_PHOTO_MAX_BYTES", "999999999"),
        ("LAI_CHILD_PHOTO_MAX_DIMENSION", "10"),
        ("LAI_CHILD_PHOTO_URL_TTL_SECONDS", "3600"),
        ("LAI_CHILD_PHOTO_URL_TTL_SECONDS", "1"),
    ],
)
def test_child_photo_settings_reject_unsafe_values(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ImproperlyConfigured, match=name):
        _load("config.settings.base")
    monkeypatch.delenv(name)
    _load("config.settings.base")  # leave the default loaded


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


def test_database_url_passes_tls_options_to_libpq():
    from config.settings.base import database_from_url

    db = database_from_url(
        "postgresql://u:p%40ss@db.rds.test:5432/lai"
        "?sslmode=verify-full&sslrootcert=/etc/lai/certs/rds-global-bundle.pem"
    )
    assert db["PASSWORD"] == "p@ss"
    assert db["OPTIONS"] == {
        "sslmode": "verify-full",
        "sslrootcert": "/etc/lai/certs/rds-global-bundle.pem",
    }
    assert "OPTIONS" not in database_from_url("postgresql://u:p@h:5432/lai")


@pytest.mark.parametrize("query", ["sslmode=sometimes", "options=-c%20search_path=x", "host=evil"])
def test_database_url_refuses_unknown_or_invalid_options(query):
    from config.settings.base import database_from_url

    with pytest.raises(ImproperlyConfigured):
        database_from_url(f"postgresql://u:p@h:5432/lai?{query}")


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
