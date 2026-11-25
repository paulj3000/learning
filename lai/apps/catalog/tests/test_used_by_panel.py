"""LAI-07 W2-5: the "Used by" panel on the content asset change page."""

import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.test import Client

from apps.assets import dependencies
from apps.assets.dependencies import Usage
from apps.assets.tests.helpers import make_definition
from apps.catalog.admin import ContentAssetAdmin
from apps.catalog.models import ContentAsset
from apps.users.models import ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

BACKEND = "apps.users.backends.AdminPasswordBackend"


def staff_client(name="viewer", *, superuser=False, groups=()):
    call_command("ensure_asset_roles", verbosity=0)
    account = ParentAccount.objects.create(
        cognito_sub=f"django-admin-only:{name}",
        admin_username=name,
        is_staff=True,
        is_superuser=superuser,
    )
    for group in groups:
        account.groups.add(Group.objects.get(name=group))
    client = Client()
    client.force_login(account, backend=BACKEND)
    return client


@pytest.fixture
def providers(monkeypatch):
    monkeypatch.setattr(dependencies, "_PROVIDERS", {})
    return dependencies.register_usage_provider


def panel(asset) -> str:
    return str(ContentAssetAdmin(ContentAsset, None).usage_panel(asset))


def test_the_three_groups_in_order_with_links_and_codes(providers):
    asset = make_definition("palm")
    providers(
        "npcs",
        lambda a, v: [
            Usage(
                "npcs", "npc_release_dependency", "NPC release 3 (active)", True, admin_url="/x/3/"
            ),
            Usage("npcs", "", "pip variant classic (model)"),
        ],
    )
    providers(
        "regions",
        lambda a, v: [Usage("regions", "region_published", "Region bay", historical=True)],
    )
    providers("audio", lambda a, v: [])
    html = panel(asset)
    assert html.index("Blocks retirement") < html.index("Informational") < html.index("Historical")
    assert '<a href="/x/3/">NPC release 3 (active)</a>' in html
    assert "<code>npc_release_dependency</code>" in html
    assert "pip variant classic (model)" in html
    assert "Region bay" in html
    assert "No usages from: audio" in html


def test_empty_groups_are_omitted(providers):
    providers("a", lambda a, v: [Usage("a", "", "just info")])
    html = panel(make_definition("palm"))
    assert "Informational" in html
    assert "Blocks retirement" not in html and "Historical" not in html


def test_labels_are_escaped(providers):
    providers("a", lambda a, v: [Usage("a", "", "<script>alert(1)</script>", admin_url="/ok/")])
    html = panel(make_definition("palm"))
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_a_failed_source_shows_a_safe_line_and_the_others_still_show(providers):
    def broken(a, v):
        raise RuntimeError("password=hunter2 traceback")

    providers("ok", lambda a, v: [Usage("ok", "", "fine")])
    providers("regions", broken)
    html = panel(make_definition("palm"))
    assert "The regions check failed, so retiring this asset will be refused until it works" in html
    assert "Ask a developer to check the server log." in html
    assert "hunter2" not in html and "RuntimeError" not in html
    assert "fine" in html


def test_a_view_only_staff_user_sees_the_panel_on_the_change_page(providers):
    providers("npcs", lambda a, v: [Usage("npcs", "c", "NPC release 1", True)])
    asset = make_definition("palm")
    client = staff_client("viewer")  # no groups: the catalog role may view, nothing more
    response = client.get(f"/admin/catalog/contentasset/{asset.pk}/change/")
    assert response.status_code == 200
    body = response.content.decode()
    assert "Used by" in body
    assert "Blocks retirement" in body
    assert "NPC release 1" in body
    assert "Used by shipped scenes" in body  # the list column's field stays on the page


def test_the_real_registry_renders_for_a_superuser():
    asset = make_definition("palm")
    response = staff_client("root", superuser=True).get(
        f"/admin/catalog/contentasset/{asset.pk}/change/"
    )
    assert response.status_code == 200
    assert "No usages from:" in response.content.decode()


def test_the_add_page_has_no_panel():
    response = staff_client("root", superuser=True).get("/admin/catalog/contentasset/add/")
    assert response.status_code == 200
    assert "usage_panel" not in response.content.decode()
