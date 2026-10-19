"""LAI-0208: what the server writes down, not just what it answers.

`console_output` swaps the stream of the real, configured console handler, so every record passes
through the project's actual filters and formatter. Only the repository's own logging is covered.
"""

import importlib
import io
import logging
import sys

import pytest
from django.core.exceptions import ImproperlyConfigured
from django.test import Client

from apps.core.privacy import PrivacyFormatter
from apps.core.reporting import PrivacyExceptionReporterFilter

from . import sentinels as S

URL = "/api/v1/privacy/{}/"


@pytest.fixture(autouse=True)
def privacy_routes(settings):
    settings.ROOT_URLCONF = "apps.core.tests.privacy_urls"


@pytest.fixture
def console_output():
    handlers = [
        h for h in logging.getLogger().handlers if isinstance(h.formatter, PrivacyFormatter)
    ]
    assert handlers, "the project's console handler is not configured"
    buffers = []
    originals = []
    for handler in handlers:
        originals.append((handler, handler.stream))
        handler.stream = io.StringIO()
        buffers.append(handler.stream)
    yield lambda: "".join(b.getvalue() for b in buffers)
    for handler, stream in originals:
        handler.stream = stream


@pytest.fixture
def client():
    return Client(raise_request_exception=False)


def assert_clean(text, *extra_allowed):
    leaked = [s for s in S.ALL if s in text]
    assert leaked == [], f"private values leaked: {leaked}"


# --- unexpected exceptions -----------------------------------------------------------


@pytest.mark.parametrize("kind", ["plain", "chained", "context", "database"])
def test_unexpected_exceptions_leak_nothing_to_the_response_or_the_log(
    client, console_output, kind
):
    response = client.get(URL.format(kind) + f"?token={S.QUERY}", HTTP_COOKIE=f"s={S.COOKIE}")
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "server_error"
    assert_clean(response.content.decode())
    assert_clean(console_output())


def test_the_log_keeps_enough_to_diagnose(client, console_output):
    response = client.get(URL.format("plain"))
    out = console_output()
    request_id = response["X-Request-ID"]
    assert f"[req={request_id}]" in out
    assert "RuntimeError" in out and "builtins" in out  # the exception type
    assert "Internal Server Error: api/v1/privacy/<str:kind>/" in out  # the route, not the path
    assert "in get" in out and "privacy_urls.py" in out  # where it happened
    assert "GET api/v1/privacy/<str:kind>/ 500" in out  # the access line with status


def test_chained_exceptions_show_every_type_and_no_message(client, console_output):
    client.get(URL.format("chained"))
    out = console_output()
    assert "ValueError" in out and "RuntimeError" in out
    assert_clean(out)


def test_application_logger_exception_calls_are_sanitized(client, console_output):
    for kind in ("logged", "logged-error"):
        assert client.get(URL.format(kind)).status_code == 200
    out = console_output()
    assert "handler failed" in out and "RuntimeError" in out
    assert_clean(out)


def test_the_raw_request_path_is_never_logged(client, console_output):
    client.get(f"/api/v1/privacy/{S.PATH_PART}/?q={S.QUERY}")
    client.get(f"/api/v1/children/{S.PATH_PART}/nothing/")  # unmatched route
    assert_clean(console_output())


def test_raw_tracebacks_are_an_explicit_local_opt_in(client, console_output, settings):
    settings.LOG_RAW_EXCEPTIONS = True
    client.get(URL.format("plain"))
    assert S.NICKNAME in console_output()  # proves the switch is what controls it


def test_the_default_is_sanitized_everywhere():
    from config.settings import base, local, test

    assert base.LOG_RAW_EXCEPTIONS is False and test.LOG_RAW_EXCEPTIONS is False
    assert local.LOG_RAW_EXCEPTIONS is False  # opt-in via LAI_LOG_RAW_EXCEPTIONS only


# --- Django's own reporting channels -------------------------------------------------


def test_debug_pages_hide_local_variables_and_credentials(client, settings):
    settings.DEBUG = True
    settings.ALLOWED_HOSTS = ["testserver"]
    response = client.get(
        URL.format("plain"),
        HTTP_COOKIE=f"s={S.COOKIE}",
        HTTP_AUTHORIZATION=f"Bearer {S.BEARER}",
    )
    html = response.content.decode()
    assert response.status_code == 500 and "Traceback" in html
    for secret in (S.LOCAL, S.COOKIE, S.BEARER):
        assert secret not in html
    assert settings.DEFAULT_EXCEPTION_REPORTER_FILTER.endswith("PrivacyExceptionReporterFilter")


def test_reporter_filter_cleanses_every_frame_variable():
    frame = sys._getframe()
    secret_value = S.LOCAL  # noqa: F841
    variables = PrivacyExceptionReporterFilter().get_traceback_frame_variables(None, frame)
    assert variables and all(S.LOCAL not in str(value) for _name, value in variables)


def test_django_security_log_details_are_withheld(client, console_output, settings):
    settings.ALLOWED_HOSTS = ["allowed.test"]
    client.get("/api/v1/health/", HTTP_HOST=f"{S.PATH_PART}.invalid")
    out = console_output()
    assert S.PATH_PART not in out and "details withheld" in out


def test_database_statements_and_parameters_are_never_logged(db, console_output, settings):
    settings.DEBUG = True
    root = logging.getLogger()
    previous = root.level
    root.setLevel(logging.DEBUG)
    try:
        from apps.users.models import ParentAccount

        ParentAccount.objects.get_or_create_for_cognito(S.SUB, S.NICKNAME)
        list(ParentAccount.objects.filter(cognito_sub=S.SUB))
    finally:
        root.setLevel(previous)
    out = console_output()
    assert_clean(out)
    assert "django.db.backends" not in out


@pytest.mark.parametrize("level", ["DEBUG", "debug", "TRACE", "", "nonsense"])
def test_the_log_level_can_never_be_debug(monkeypatch, level):
    monkeypatch.setenv("DJANGO_LOG_LEVEL", level)
    base = importlib.reload(importlib.import_module("config.settings.base"))
    try:
        assert base.LOGGING["root"]["level"] == "INFO"
    finally:
        monkeypatch.delenv("DJANGO_LOG_LEVEL")
        importlib.reload(base)


def test_no_logger_can_email_error_reports():
    names = ["", "django", "django.request", "django.security", "lai.request", "lai.auth"]
    for name in names:
        for handler in logging.getLogger(name).handlers:
            assert handler.__class__.__name__ != "AdminEmailHandler"
    from django.conf import settings

    assert settings.ADMINS == [] and settings.MANAGERS == []


def test_the_django_logger_has_no_handlers_of_its_own():
    # Otherwise records would be handled twice, once by a handler that bypasses our formatter.
    assert logging.getLogger("django").handlers == []


# --- production ----------------------------------------------------------------------


PROD = {
    "DJANGO_SECRET_KEY": "x" * 50,
    "DJANGO_ALLOWED_HOSTS": "api.example.test",
    "DATABASE_URL": f"postgresql://u:{S.PASSWORD}@db.internal:5432/lai",
    "COGNITO_REGION": "us-test-1",
    "COGNITO_USER_POOL_ID": "us-test-1_TESTPOOL1",
    "COGNITO_ALLOWED_CLIENT_IDS": "c1",
}


def test_production_cannot_enable_raw_tracebacks_or_debug(monkeypatch):
    for name, value in PROD.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("LAI_LOG_RAW_EXCEPTIONS", "1")
    monkeypatch.setenv("DJANGO_DEBUG", "1")
    sys.modules.pop("config.settings.production", None)
    prod = importlib.import_module("config.settings.production")
    assert prod.DEBUG is False and prod.LOG_RAW_EXCEPTIONS is False
    assert prod.ADMINS == []


def test_misconfiguration_errors_do_not_echo_secrets(monkeypatch):
    for name, value in PROD.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("DATABASE_URL", f"mysql://u:{S.PASSWORD}@h/db")
    sys.modules.pop("config.settings.production", None)
    with pytest.raises(ImproperlyConfigured) as caught:
        importlib.import_module("config.settings.production")
    assert S.PASSWORD not in str(caught.value)


def test_production_mode_unexpected_errors_are_safe_json(client, settings, console_output):
    assert settings.DEBUG is False  # test settings mirror production's DEBUG
    response = client.get(URL.format("plain"))
    assert response["Content-Type"].startswith("application/json")
    assert "Traceback" not in response.content.decode()
    assert_clean(response.content.decode() + console_output())


# --- request logging -----------------------------------------------------------------


def test_forged_request_ids_cannot_inject_log_lines(client, console_output):
    for forged in ("abcdefgh\nFAKE ERROR line", "abcdefgh\r\nINFO forged", "x" * 200):
        response = client.get("/api/v1/health/", HTTP_X_REQUEST_ID=forged)
        assert response["X-Request-ID"] != forged
    out = console_output()
    assert "FAKE ERROR" not in out and "forged" not in out
    assert all("\n" not in segment for segment in out.splitlines())


def test_odd_http_methods_cannot_inject_log_lines(console_output):
    Client(raise_request_exception=False).generic("BAD\nINFO forged line", "/api/v1/health/")
    out = console_output()
    assert "forged line" not in out and " OTHER " in out


def test_authentication_failures_log_only_reason_codes(client, console_output):
    # Cognito is not configured in this module, so every bearer token is rejected.
    for header in (f"Bearer {S.BEARER}", f"Bearer {S.BEARER} extra", "Bearer é", "Basic zzz"):
        client.get("/api/v1/me/", HTTP_AUTHORIZATION=header)
    out = console_output()
    assert_clean(out)
    assert "authentication rejected" in out


def test_no_application_code_prints():
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]
    offenders = [
        str(p.relative_to(root))
        for p in (root / "apps").rglob("*.py")
        if "tests" not in p.parts and "migrations" not in p.parts and "print(" in p.read_text()
    ]
    assert offenders == []
