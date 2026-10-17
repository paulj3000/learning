import json
import logging

import pytest
from django.test import Client
from django.urls import URLPattern, URLResolver

from apps.core.middleware import RequestIdLogFilter
from apps.core.request_context import choose_request_id


@pytest.fixture
def api_urls(settings):
    settings.ROOT_URLCONF = "apps.core.tests.urls"


@pytest.fixture
def client():
    return Client(raise_request_exception=False)


def assert_error(response, status, code, message=None):
    assert response.status_code == status
    assert response["Content-Type"].startswith("application/json")
    body = response.json()
    assert body["error"]["code"] == code
    if message:
        assert body["error"]["message"] == message
    assert body["request_id"] == response["X-Request-ID"]
    assert set(body) <= {"error", "request_id"}
    return body


# --- validation ---------------------------------------------------------------------------


def test_validation_error_lists_fields_with_messages_and_codes(api_urls, client):
    response = client.post("/api/v1/example/validate/", {}, content_type="application/json")
    body = assert_error(response, 400, "validation_error", "Invalid request.")
    assert body["error"]["details"]["name"] == [
        {"message": "This field is required.", "code": "required"}
    ]
    assert body["error"]["details"]["count"][0]["code"] == "required"


def test_validation_error_codes_for_bad_values(api_urls, client):
    response = client.post(
        "/api/v1/example/validate/",
        {"name": "x" * 21, "count": 0},
        content_type="application/json",
    )
    details = assert_error(response, 400, "validation_error")["error"]["details"]
    assert details["name"][0]["code"] == "max_length"
    assert details["count"][0]["code"] == "min_value"


def test_non_field_validation_error_uses_non_field_errors(api_urls, client):
    response = client.post(
        "/api/v1/example/validate/",
        {"name": "forbidden", "count": 1},
        content_type="application/json",
    )
    details = assert_error(response, 400, "validation_error")["error"]["details"]
    assert details == {
        "non_field_errors": [{"message": "That name is not allowed.", "code": "name_blocked"}]
    }


def test_valid_request_is_not_wrapped(api_urls, client):
    response = client.post(
        "/api/v1/example/validate/",
        {"name": "Pip", "count": 2},
        content_type="application/json",
    )
    assert response.status_code == 201
    assert response.json() == {"name": "Pip", "count": 2}


def test_malformed_json_is_parse_error(api_urls, client):
    response = client.post(
        "/api/v1/example/validate/", "{not json", content_type="application/json"
    )
    assert_error(response, 400, "parse_error")


def test_unsupported_media_type(api_urls, client):
    response = client.post("/api/v1/example/validate/", "a=b", content_type="text/plain")
    assert_error(response, 415, "unsupported_media_type")


# --- authentication, authorization, not found, method ----------------------------------------


def test_deny_by_default_without_credentials(api_urls, client):
    # No authenticator is installed yet, so DRF answers 403 permission_denied (not 401). Once
    # LAI-0402 adds a bearer authenticator the same request becomes 401 not_authenticated.
    response = client.get("/api/v1/example/defaults/")
    body = assert_error(response, 403, "permission_denied", "You do not have permission.")
    assert "leak" not in json.dumps(body)


def test_bearer_scheme_gives_401_with_www_authenticate(api_urls, client):
    response = client.get("/api/v1/example/bearer/")
    assert_error(response, 401, "not_authenticated")
    assert response["WWW-Authenticate"] == 'Bearer realm="api"'


def test_authentication_failed_does_not_echo_detail(api_urls, client):
    response = client.get("/api/v1/example/raise/failed/")
    assert_error(response, 403, "authentication_failed", "Authentication failed.")
    assert "Ann" not in response.content.decode()


def test_permission_denied_message_is_fixed(api_urls, client):
    response = client.get("/api/v1/example/raise/denied/")
    assert_error(response, 403, "permission_denied", "You do not have permission.")
    assert "Ann" not in response.content.decode()


def test_not_found_from_a_view_and_from_routing(api_urls, client):
    in_view = client.get("/api/v1/example/raise/missing/")
    assert_error(in_view, 404, "not_found", "Not found.")
    assert "Ann" not in in_view.content.decode()
    assert_error(client.get("/api/v1/does-not-exist/"), 404, "not_found")


def test_method_not_allowed_keeps_allow_header(client):
    response = client.post("/api/v1/health/")
    assert_error(response, 405, "method_not_allowed", "Method not allowed.")
    assert set(response["Allow"].split(", ")) == {"GET", "HEAD", "OPTIONS"}


def test_throttled_keeps_retry_after(api_urls, client):
    response = client.get("/api/v1/example/raise/throttled/")
    assert_error(response, 429, "throttled", "Too many requests.")
    assert response["Retry-After"] == "7"


def test_unexpected_exception_is_a_safe_500(api_urls, client, caplog):
    with caplog.at_level(logging.ERROR):
        response = client.get("/api/v1/example/raise/boom/")
    body = assert_error(response, 500, "server_error", "Something went wrong.")
    text = response.content.decode()
    assert "secret" not in text and "Ann" not in text and "Traceback" not in text
    assert "details" not in body["error"]
    # Not swallowed: the failure is logged server-side with its traceback.
    assert any(record.exc_info for record in caplog.records)


def test_disallowed_host_gets_json_400(settings):
    settings.ALLOWED_HOSTS = ["allowed.test"]
    response = Client().get("/api/v1/health/", HTTP_HOST="evil.test")
    assert_error(response, 400, "bad_request")


# --- request ids --------------------------------------------------------------------------------


def test_request_id_is_generated_and_unique(client):
    first = client.get("/api/v1/health/")["X-Request-ID"]
    second = client.get("/api/v1/health/")["X-Request-ID"]
    assert len(first) == 32 and first != second


def test_valid_inbound_request_id_is_kept(client):
    response = client.get("/api/v1/health/", HTTP_X_REQUEST_ID="trace-1234.abcd_EF")
    assert response["X-Request-ID"] == "trace-1234.abcd_EF"


@pytest.mark.parametrize(
    "bad",
    ["short", "has space in it", "x" * 65, "line\nbreak-injection", "tab\tchar-here", "é" * 10, ""],
)
def test_invalid_inbound_request_id_is_replaced(client, bad):
    response = client.get("/api/v1/health/", HTTP_X_REQUEST_ID=bad)
    assert response["X-Request-ID"] != bad
    assert len(response["X-Request-ID"]) == 32


def test_choose_request_id_rejects_trailing_newline():
    assert choose_request_id("abcdefgh\n") != "abcdefgh\n"


def test_request_id_header_present_on_errors_and_redirects(client):
    assert client.get("/api/v1/health")["X-Request-ID"]  # 301
    assert client.get("/nope")["X-Request-ID"]  # 404
    assert client.post("/api/v1/health/")["X-Request-ID"]  # 405


def test_health_contract_is_unchanged(client):
    response = client.get("/api/v1/health/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "learning-adventure-island"}
    assert "request_id" not in response.json()


# --- logging and privacy -----------------------------------------------------------------


class Collect(logging.Handler):
    def __init__(self):
        super().__init__(logging.DEBUG)
        self.records = []
        self.addFilter(RequestIdLogFilter())

    def emit(self, record):
        self.records.append(record)


@pytest.fixture
def logs():
    handler = Collect()
    loggers = [logging.getLogger("")]  # the others propagate to the root logger
    for logger in loggers:
        logger.addHandler(handler)
    previous = logging.getLogger("lai.request").level
    logging.getLogger("lai.request").setLevel(logging.INFO)
    yield handler.records
    logging.getLogger("lai.request").setLevel(previous)
    for logger in loggers:
        logger.removeHandler(handler)


def test_access_log_has_route_status_duration_and_request_id(client, logs):
    response = client.get("/api/v1/health/")
    lines = [r for r in logs if r.name == "lai.request"]
    assert len(lines) == 1  # no duplicate logging
    line = lines[0]
    assert line.getMessage().startswith("GET api/v1/health/ 200 ")
    assert line.getMessage().endswith("ms")
    assert line.request_id == response["X-Request-ID"]


def test_access_log_excludes_secrets_query_strings_and_raw_paths(client, logs):
    secrets = ["TOKEN-abc123", "COOKIE-xyz", "child-Ann-Smith", "PASSWORD-hunter2", "BODY-photo"]
    client.cookies["session"] = secrets[1]
    client.post(
        f"/api/v1/health/?childName={secrets[2]}&token={secrets[0]}",
        {"password": secrets[3], "photo": secrets[4]},
        content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {secrets[0]}",
    )
    client.get(f"/api/v1/children/{secrets[2]}/?token={secrets[0]}")  # unmatched route
    text = " ".join(r.getMessage() for r in logs)
    assert text
    for secret in secrets:
        assert secret not in text
    unmatched = [r for r in logs if r.name == "lai.request"][-1].getMessage()
    assert unmatched.startswith("GET - 404 ")


def test_4xx_is_logged_once_not_twice(client, logs):
    client.get("/api/v1/nope/")
    assert [r.name for r in logs] == ["lai.request"]


# --- deny by default and versioning ---------------------------------------------------------


def _views(patterns, prefix=""):
    for entry in patterns:
        if isinstance(entry, URLResolver):
            yield from _views(entry.url_patterns, prefix + str(entry.pattern))
        elif isinstance(entry, URLPattern):
            yield prefix + str(entry.pattern), entry.callback


def test_only_the_health_route_is_public():
    from config import urls

    public = []
    for route, callback in _views(urls.urlpatterns):
        permissions = [p.__name__ for p in callback.cls.permission_classes]
        if "AllowAny" in permissions:
            public.append(route)
    assert public == ["api/v1/health/"]


def test_every_route_lives_under_api_v1():
    from config import urls

    assert all(route.startswith("api/v1/") for route, _ in _views(urls.urlpatterns))


def test_project_never_enables_cookie_based_api_authentication(settings):
    assert settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"] == []
    assert "django.contrib.sessions" not in settings.INSTALLED_APPS
    assert not any("csrf" in name.lower() for name in settings.MIDDLEWARE)


def test_runserver_access_lines_with_query_strings_are_discarded(settings):
    server = settings.LOGGING["loggers"]["django.server"]
    assert server["propagate"] is False
    assert server["handlers"] == ["discard"]
    assert settings.LOGGING["loggers"]["django.request"]["level"] == "ERROR"
