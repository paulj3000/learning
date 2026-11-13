"""Django Admin declares a site icon, so browsers never fall back to /favicon.ico (a 404).

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


def test_the_icon_is_a_collectable_static_file():
    path = finders.find(ICON)
    assert path, f"{ICON} must be found by the static file finders (collectstatic ships it)"
    with open(path, encoding="utf-8") as handle:
        assert handle.read().lstrip().startswith("<svg")
