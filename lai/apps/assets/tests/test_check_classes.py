"""Retirement-check classes, unsaved assets, keyword-only usage fields (ASSET_LIBRARY s. 25.9).

- AUTHORITATIVE and UNCLASSIFIED checks fail closed; INFORMATIONAL ones may fail without blocking,
  and the failure is logged (ids only) and reported through `unverified_checks()`.
- A blocking usage always blocks, whatever its source's class.
- An unsaved asset or version has no usages.
"""

import dataclasses
import logging

import pytest
from django.contrib import messages
from django.contrib.admin.sites import AdminSite
from django.contrib.messages.storage.fallback import FallbackStorage
from django.test import RequestFactory

from apps.assets import dependencies, services
from apps.assets.dependencies import (
    CheckClass,
    SourceUsages,
    Usage,
    register_usage_provider,
    unverified_checks,
    usages_by_source,
    usages_for,
)
from apps.assets.models import AssetVersion, VersionStatus
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import make_definition, make_version
from apps.catalog.models import AssetStatus, ContentAsset

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def registry(monkeypatch):
    monkeypatch.setattr(dependencies, "_PROVIDERS", {})
    monkeypatch.setattr(services, "RETIREMENT_GUARDS", [dependencies.retirement_guard])
    return dependencies._PROVIDERS


def broken(asset, version):
    raise RuntimeError("database went away")


def blocking(source):
    return lambda asset, version: [Usage(source, f"{source}_dependency", "row 1", True)]


def retired(asset) -> bool:
    asset.refresh_from_db()
    return asset.status == AssetStatus.RETIRED


# --- classification ----------------------------------------------------------------------------


def test_a_source_is_unclassified_unless_it_says_otherwise(registry):
    register_usage_provider("plain", lambda a, v: [])
    assert dependencies.check_class("plain") is CheckClass.UNCLASSIFIED


@pytest.mark.parametrize("check_class", [CheckClass.AUTHORITATIVE, CheckClass.UNCLASSIFIED])
def test_authoritative_and_unclassified_failures_refuse(registry, caplog, check_class):
    register_usage_provider("source", broken, check_class=check_class)
    asset = make_definition("guarded")
    with caplog.at_level(logging.ERROR, logger="lai.assets"):
        with pytest.raises(AssetActionRefused) as refused:
            services.retire_asset(asset)
    assert refused.value.code == "dependency_check_failed"
    assert refused.value.details == {"source": "source", "check_class": check_class.value}
    assert not retired(asset)
    assert "database went away" not in caplog.text  # the error type only, never its message


def test_an_unclassified_failure_refuses_a_version_too(registry):
    register_usage_provider("source", broken)
    asset = make_definition("guarded-version")
    version = make_version(asset, status=VersionStatus.PUBLISHED)
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_version(version)
    assert refused.value.code == "dependency_check_failed"
    version.refresh_from_db()
    assert version.status == VersionStatus.PUBLISHED


def test_an_informational_failure_lets_retirement_go_ahead_and_is_reported(registry, caplog):
    register_usage_provider("artifacts", broken, check_class=CheckClass.INFORMATIONAL)
    asset = make_definition("informational")
    with caplog.at_level(logging.WARNING, logger="lai.assets"):
        with unverified_checks() as unverified:
            services.retire_asset(asset)
    assert retired(asset)
    assert unverified == ["artifacts"]
    warning = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warning) == 1 and "source=artifacts" in warning[0].getMessage()
    assert "asset=informational" in warning[0].getMessage()


def test_an_informational_failure_is_logged_even_with_no_collector(registry, caplog):
    register_usage_provider("artifacts", broken, check_class=CheckClass.INFORMATIONAL)
    asset = make_definition("uncollected")
    with caplog.at_level(logging.WARNING, logger="lai.assets"):
        services.retire_asset(asset)
    assert retired(asset)
    assert "dependency check unverified" in caplog.text


def test_an_informational_failure_never_hides_an_authoritative_blocker(registry):
    register_usage_provider("artifacts", broken, check_class=CheckClass.INFORMATIONAL)
    register_usage_provider("npcs", blocking("npcs"), check_class=CheckClass.AUTHORITATIVE)
    asset = make_definition("still-blocked")
    with unverified_checks() as unverified:
        with pytest.raises(AssetActionRefused) as refused:
            services.retire_asset(asset)
    assert refused.value.code == "npcs_dependency"
    assert not retired(asset)
    assert unverified == ["artifacts"]


def test_an_informational_failure_never_hides_an_authoritative_failure(registry):
    register_usage_provider("artifacts", broken, check_class=CheckClass.INFORMATIONAL)
    register_usage_provider("regions", broken, check_class=CheckClass.AUTHORITATIVE)
    asset = make_definition("both-broken")
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(asset)
    assert refused.value.details["source"] == "regions"
    assert not retired(asset)


def test_a_blocking_usage_blocks_whatever_its_source_class(registry):
    register_usage_provider("odd", blocking("odd"), check_class=CheckClass.INFORMATIONAL)
    asset = make_definition("blocked-anyway")
    with pytest.raises(AssetActionRefused):
        services.retire_asset(asset)
    assert not retired(asset)


def test_reports_do_not_leak_between_blocks(registry):
    register_usage_provider("artifacts", broken, check_class=CheckClass.INFORMATIONAL)
    with unverified_checks() as first:
        services.retire_asset(make_definition("one"))
    with unverified_checks() as second:
        pass
    assert first == ["artifacts"] and second == []


def test_usages_for_still_fails_closed_for_an_informational_source(registry):
    """Listing is not retirement: a caller asking for every usage learns the check failed."""
    register_usage_provider("artifacts", broken, check_class=CheckClass.INFORMATIONAL)
    with pytest.raises(dependencies.DependencyCheckFailed):
        usages_for(make_definition("listing"))


def test_reclassifying_a_registered_source_is_refused(registry):
    def provider(asset, version):
        return []

    register_usage_provider("src", provider, check_class=CheckClass.AUTHORITATIVE)
    register_usage_provider("src", provider, check_class=CheckClass.AUTHORITATIVE)  # no-op
    with pytest.raises(ValueError):
        register_usage_provider("src", provider, check_class=CheckClass.INFORMATIONAL)


def test_an_unknown_class_is_refused(registry):
    with pytest.raises(ValueError):
        register_usage_provider("src", lambda a, v: [], check_class="optional")


def test_every_real_source_has_the_class_the_policy_gives_it():
    """ASSET_LIBRARY.md s. 25.9 (catalog: Agent 4's decision, 2026-11-25)."""
    expected = {
        "regions": CheckClass.AUTHORITATIVE,
        "audio": CheckClass.AUTHORITATIVE,
        "npcs": CheckClass.AUTHORITATIVE,
        "avatars": CheckClass.AUTHORITATIVE,
        "artifacts": CheckClass.INFORMATIONAL,
        "catalog": CheckClass.INFORMATIONAL,
        # LAI-ENV-02: a failed check could hide a published material that draws the texture.
        "materials": CheckClass.AUTHORITATIVE,
    }
    assert {s: dependencies.check_class(s) for s in dependencies.registered_sources()} == expected


@pytest.mark.parametrize("module", ["apps.assets.artifact_usage", "apps.catalog.dependencies"])
def test_only_sources_whose_usages_never_block_are_informational(module):
    """An informational source must never return a blocking usage."""
    import importlib

    source = open(importlib.import_module(module).__file__, encoding="utf-8").read()
    assert "blocks_retirement=True" not in source and "blocks_retirement=False" in source


# --- admin reporting ---------------------------------------------------------------------------


def _request(user):
    request = RequestFactory().post("/")
    request.user = user
    request.session = {}
    request._messages = FallbackStorage(request)
    return request


@pytest.fixture
def superuser():
    from apps.catalog.tests.helpers import staff_user

    return staff_user()


def test_the_version_admin_warns_when_an_informational_check_failed(registry, superuser):
    from apps.assets.admin import AssetVersionAdmin

    register_usage_provider("artifacts", broken, check_class=CheckClass.INFORMATIONAL)
    version = make_version(make_definition("admin-version"), status=VersionStatus.PUBLISHED)
    request = _request(superuser)
    AssetVersionAdmin(AssetVersion, AdminSite()).retire_versions(
        request, AssetVersion.objects.filter(pk=version.pk)
    )
    found = [(m.level, m.message) for m in messages.get_messages(request)]
    assert any(level == messages.SUCCESS for level, _ in found)
    warnings = [text for level, text in found if level == messages.WARNING]
    assert len(warnings) == 1 and "artifacts" in warnings[0]
    version.refresh_from_db()
    assert version.status == VersionStatus.RETIRED


def test_the_asset_admin_warns_per_asset_when_an_informational_check_failed(registry, superuser):
    from apps.catalog.admin import ContentAssetAdmin

    register_usage_provider("artifacts", broken, check_class=CheckClass.INFORMATIONAL)
    asset = make_definition("admin-asset")
    request = _request(superuser)
    ContentAssetAdmin(ContentAsset, AdminSite()).retire_assets(
        request, ContentAsset.objects.filter(pk=asset.pk)
    )
    warnings = [m.message for m in messages.get_messages(request) if m.level == messages.WARNING]
    assert any(text.startswith("admin-asset: Retired, but") for text in warnings)
    assert retired(asset)


def test_the_admin_shows_no_warning_when_every_check_ran(registry, superuser):
    from apps.assets.admin import AssetVersionAdmin

    register_usage_provider("artifacts", lambda a, v: [], check_class=CheckClass.INFORMATIONAL)
    version = make_version(make_definition("admin-clean"), status=VersionStatus.PUBLISHED)
    request = _request(superuser)
    AssetVersionAdmin(AssetVersion, AdminSite()).retire_versions(
        request, AssetVersion.objects.filter(pk=version.pk)
    )
    assert not [m for m in messages.get_messages(request) if m.level == messages.WARNING]


def test_an_authoritative_failure_in_the_admin_is_an_error_not_a_warning(registry, superuser):
    from apps.assets.admin import AssetVersionAdmin

    register_usage_provider("regions", broken, check_class=CheckClass.AUTHORITATIVE)
    version = make_version(make_definition("admin-refused"), status=VersionStatus.PUBLISHED)
    request = _request(superuser)
    AssetVersionAdmin(AssetVersion, AdminSite()).retire_versions(
        request, AssetVersion.objects.filter(pk=version.pk)
    )
    found = [(m.level, m.message) for m in messages.get_messages(request)]
    assert [level for level, _ in found] == [messages.ERROR]
    version.refresh_from_db()
    assert version.status == VersionStatus.PUBLISHED


# --- unsaved assets ----------------------------------------------------------------------------


def test_an_unsaved_asset_has_no_usages_and_no_provider_is_asked(registry):
    asked = []
    register_usage_provider("spy", lambda a, v: asked.append(a) or [])
    register_usage_provider("broken", broken)
    unsaved = ContentAsset(asset_id="not-yet", kind="prop", category="prop")
    assert usages_for(unsaved) == []
    assert usages_by_source(unsaved) == [SourceUsages("spy"), SourceUsages("broken")]
    assert asked == []


def test_an_unsaved_version_has_no_usages(registry):
    register_usage_provider("broken", broken)
    asset = make_definition("saved")
    assert usages_for(asset, AssetVersion(asset=asset, number=7)) == []


def test_an_unsaved_asset_has_no_usages_with_the_real_providers():
    """LAI 01's finding: the catalog provider needed a primary key and failed closed."""
    unsaved = ContentAsset(asset_id="draft-form", kind="prop", category="prop")
    assert usages_for(unsaved) == []
    assert all(not entry.failed and not entry.usages for entry in usages_by_source(unsaved))


def test_a_saved_asset_is_still_asked(registry):
    register_usage_provider("broken", broken)
    with pytest.raises(dependencies.DependencyCheckFailed):
        usages_for(make_definition("asked"))


# --- keyword-only fields -----------------------------------------------------------------------


def test_historical_and_later_fields_are_keyword_only():
    with pytest.raises(TypeError):
        Usage("npcs", "code", "label", False, True)  # historical passed by position
    with pytest.raises(TypeError):
        Usage("npcs", "code", "label", False, False, "/admin/")
    usage = Usage("npcs", "code", "label", True, historical=False, admin_url="/admin/npcs/7/")
    assert usage.blocks_retirement and usage.admin_url == "/admin/npcs/7/"
    keyword_only = [f.name for f in dataclasses.fields(Usage) if f.kw_only]
    assert keyword_only == ["historical", "admin_url", "details"]
