"""Django serves a site icon, so browsers never get a 404 for /favicon.ico.

Trello IIGt0JWT: Chromium's automatic `GET /favicon.ico` on the Admin login page answered 404,
which the Question Studio browser acceptance suite (correctly) reported as a failed request.
"""

import pytest
from django.contrib.staticfiles import finders
from django.templatetags.static import static
from django.urls import reverse

pytestmark = pytest.mark.django_db

ICON = "core/favicon.svg"


def test_admin_login_declares_the_site_icon(client):
    response = client.get(reverse("admin:login"))
    assert response.status_code == 200
    html = response.content.decode()
    assert f'<link rel="icon" type="image/svg+xml" href="{static(ICON)}">' in html


def test_the_override_keeps_the_stock_admin_title_and_branding(client):
    html = client.get(reverse("admin:login")).content.decode()
    # From django.contrib.admin's base_site.html via the extended template, unchanged.
    assert "Learning Adventure Island administration" in html
    assert "<title>" in html and "Learning Adventure Island admin</title>" in html
    assert html.count('rel="icon"') == 1


def test_favicon_ico_redirects_to_the_icon_for_pages_without_an_icon_link(client):
    # Error pages (a 403 for staff without permission) and JSON responses have no <link>, so
    # browsers ask for /favicon.ico there; it must not be a 404.
    response = client.get("/favicon.ico")
    assert response.status_code == 302
    assert response["Location"] == static(ICON)


def test_the_icon_is_a_collectable_static_file():
    path = finders.find(ICON)
    assert path, f"{ICON} must be found by the static file finders (collectstatic ships it)"
    with open(path, encoding="utf-8") as handle:
        assert handle.read().lstrip().startswith("<svg")
