"""The usage registry and its aggregate retirement guard (LAI-07 W2-1, ASSET_LIBRARY.md s. 25).

Stand-in providers keep these independent of which consumer apps register real ones.
"""

import json
import logging

import pytest
from django.core.management import CommandError, call_command

from apps.assets import dependencies, services
from apps.assets.dependencies import Usage, register_usage_provider, usages_for
from apps.assets.models import VersionStatus
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import make_definition, make_version
from apps.catalog.models import AssetStatus

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def registry(monkeypatch):
    """An empty registry, with the aggregate guard as the only retirement guard."""
    monkeypatch.setattr(dependencies, "_PROVIDERS", {})
    monkeypatch.setattr(services, "RETIREMENT_GUARDS", [dependencies.retirement_guard])
    return dependencies._PROVIDERS


def blocking(source, code, label, **details):
    return Usage(source, code, label, blocks_retirement=True, details=details)


def listed(source, label):
    return Usage(source, "", label)


def test_the_aggregate_guard_is_registered_by_the_app():
    assert dependencies.retirement_guard in services.RETIREMENT_GUARDS


def test_the_npc_and_avatar_guards_are_now_usage_providers():
    """W2-4b: the NPC and avatar guards moved to usage providers on the registry, with the
    owner's approval (ASSET_LIBRARY.md s. 25.7)."""
    from apps.avatars import dependencies as avatar_dependencies
    from apps.npcs import dependencies as npc_dependencies

    # W2-4b: both moved to usage providers; only the aggregate guard is registered.
    assert npc_dependencies.retirement_guard not in services.RETIREMENT_GUARDS
    assert avatar_dependencies.retirement_guard not in services.RETIREMENT_GUARDS
    assert {"npcs", "avatars"} <= set(dependencies.registered_sources())
    assert services.RETIREMENT_GUARDS == [dependencies.retirement_guard]


def test_running_ready_again_registers_nothing_twice():
    """`ready()` can run more than once (tests); each source and the guard stay registered once."""
    from django.apps import apps as django_apps

    sources = dependencies.registered_sources()
    for label in ("assets", "npcs", "avatars", "regions", "catalog"):
        django_apps.get_app_config(label).ready()
    assert dependencies.registered_sources() == sources
    assert len(sources) == len(set(sources))
    assert services.RETIREMENT_GUARDS == [dependencies.retirement_guard]


def test_with_no_providers_retirement_is_unchanged(registry):
    asset = make_definition("free")
    services.retire_asset(asset)
    asset.refresh_from_db()
    assert asset.status == AssetStatus.RETIRED


def test_listed_usages_never_block(registry):
    register_usage_provider("catalog", lambda asset, version: [listed("catalog", "Place harbor")])
    asset = make_definition("listed")
    services.retire_asset(asset)
    asset.refresh_from_db()
    assert asset.status == AssetStatus.RETIRED


def test_one_blocking_source_keeps_its_own_code_and_message(registry):
    def refusal(asset, version, usages):
        return AssetActionRefused("npc_release_dependency", "Exact NPC wording.", details={"r": 7})

    register_usage_provider(
        "npcs",
        lambda asset, version: [blocking("npcs", "npc_release_dependency", "NPC release 7")],
        refusal=refusal,
    )
    asset = make_definition("npc-pip")
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(asset)
    assert (refused.value.code, refused.value.message) == (
        "npc_release_dependency",
        "Exact NPC wording.",
    )
    assert refused.value.details == {"r": 7}
    asset.refresh_from_db()
    assert asset.status == AssetStatus.ACTIVE


def test_the_default_refusal_names_every_blocking_usage_of_the_source(registry):
    register_usage_provider(
        "audio",
        lambda asset, version: [
            blocking("audio", "sound_release_dependency", "Sound release 12, cue sfx.a", n=12),
            blocking("audio", "sound_release_dependency", "Sound release 12, cue sfx.b", n=12),
            listed("audio", "Cue sfx.c (working copy)"),
        ],
    )
    asset = make_definition("chime", kind="audio", category="sound")
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(asset)
    assert refused.value.code == "sound_release_dependency"
    assert refused.value.message == (
        '"chime" is used by: Sound release 12, cue sfx.a; Sound release 12, cue sfx.b. '
        "It cannot be retired until those no longer use it."
    )
    assert "sfx.c" not in refused.value.message
    assert refused.value.details == {"usages": [{"n": 12}, {"n": 12}]}


def test_several_blocking_sources_are_all_named_in_one_refusal(registry):
    register_usage_provider(
        "npcs", lambda asset, version: [blocking("npcs", "npc_release_dependency", "NPC rel 7")]
    )
    register_usage_provider("catalog", lambda asset, version: [listed("catalog", "Place harbor")])
    register_usage_provider(
        "regions",
        lambda asset, version: [blocking("regions", "region_placement", "3D Area cove", r="cove")],
    )
    asset = make_definition("crate", kind="prop", category="prop")
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(asset)
    assert refused.value.code == "asset_in_use"
    assert refused.value.message.startswith('"crate" cannot be retired while it is in use. ')
    assert "NPC rel 7" in refused.value.message and "3D Area cove" in refused.value.message
    assert "Place harbor" not in refused.value.message
    assert refused.value.details == {
        "blockers": {
            "npcs": {"code": "npc_release_dependency", "usages": [{}]},
            "regions": {"code": "region_placement", "usages": [{"r": "cove"}]},
        }
    }


def test_a_provider_is_asked_about_the_exact_version(registry):
    asked = []

    def provider(asset, version):
        asked.append((asset.asset_id, version.number if version else None))
        return [blocking("audio", "sound_release_dependency", "Sound release 3")]

    register_usage_provider("audio", provider)
    asset = make_definition("chime", kind="audio", category="sound")
    make_version(asset, 1, status=VersionStatus.PUBLISHED)
    spare = make_version(asset, 2, status=VersionStatus.PUBLISHED)
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_version(spare)
    assert asked == [("chime", 2)]
    assert refused.value.message.startswith('Version 2 of "chime" is used by: ')
    spare.refresh_from_db()
    assert spare.status == VersionStatus.PUBLISHED


def test_a_failing_provider_fails_closed_and_logs_ids_only(registry, caplog):
    def broken(asset, version):
        raise RuntimeError("secret detail that must not be logged")

    register_usage_provider("audio", broken)
    asset = make_definition("chime", kind="audio", category="sound")
    with caplog.at_level(logging.ERROR, logger="lai.assets"):
        with pytest.raises(AssetActionRefused) as refused:
            services.retire_asset(asset)
    assert refused.value.code == "dependency_check_failed"
    assert refused.value.details == {"source": "audio"}
    asset.refresh_from_db()
    assert asset.status == AssetStatus.ACTIVE
    logged = " ".join(record.getMessage() for record in caplog.records)
    assert "source=audio asset=chime" in logged and "RuntimeError" in logged
    assert "secret detail" not in logged


def test_a_guard_not_yet_moved_to_a_provider_keeps_its_exact_refusal(registry, monkeypatch):
    def legacy(asset, version):
        raise AssetActionRefused("npc_release_dependency", "Legacy wording.", details={"r": 1})

    monkeypatch.setattr(services, "RETIREMENT_GUARDS", [dependencies.retirement_guard, legacy])
    register_usage_provider(
        "regions", lambda asset, version: [blocking("regions", "region_placement", "3D Area")]
    )
    asset = make_definition("both")
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(asset)
    assert (refused.value.code, refused.value.message, refused.value.details) == (
        "npc_release_dependency",
        "Legacy wording.",
        {"r": 1},
    )
    monkeypatch.setattr(services, "RETIREMENT_GUARDS", [dependencies.retirement_guard])
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(asset)  # once moved, the provider's own refusal applies
    assert refused.value.code == "region_placement"


def test_usages_are_reported_in_registration_order(registry):
    register_usage_provider("npcs", lambda asset, version: [listed("npcs", "draft")])
    register_usage_provider("audio", lambda asset, version: [listed("audio", "cue")])
    asset = make_definition("pip")
    assert [u.source for u in usages_for(asset)] == ["npcs", "audio"]
    assert dependencies.registered_sources() == ["npcs", "audio"]


def test_registering_the_same_provider_twice_keeps_one(registry):
    def provider(asset, version):
        return []

    register_usage_provider("audio", provider)
    register_usage_provider("audio", provider)
    assert list(registry) == ["audio"]


def test_a_second_provider_for_a_source_is_refused(registry):
    register_usage_provider("audio", lambda asset, version: [])
    with pytest.raises(ValueError):
        register_usage_provider("audio", lambda asset, version: [])


# --- manage.py asset_usage -----------------------------------------------------------------


def run(*args):
    from io import StringIO

    out = StringIO()
    call_command("asset_usage", *args, stdout=out)
    return out.getvalue()


def test_the_command_lists_blocking_and_listed_usages(registry):
    register_usage_provider(
        "npcs",
        lambda asset, version: [
            Usage(
                "npcs", "npc_release_dependency", "NPC release 7", True, admin_url="/admin/npcs/7/"
            ),
            listed("npcs", "pip variant default (model)"),
        ],
    )
    make_definition("npc-pip")
    output = run("npc-pip")
    assert "npc-pip: 2 usage(s), 1 blocking retirement (checked: npcs)." in output
    assert "  [BLOCKS] npcs: NPC release 7 /admin/npcs/7/" in output
    assert "  [listed] npcs: pip variant default (model)" in output


def test_the_command_reports_json_for_one_version(registry):
    seen = []

    def provider(asset, version):
        seen.append(version.number)
        return [blocking("audio", "sound_release_dependency", "Sound release 3", release=3)]

    register_usage_provider("audio", provider)
    asset = make_definition("chime", kind="audio", category="sound")
    make_version(asset, 1, status=VersionStatus.PUBLISHED)
    report = json.loads(run("chime", "--number", "1", "--json"))
    assert seen == [1]
    assert report["blocksRetirement"] is True
    assert report["usages"] == [
        {
            "source": "audio",
            "code": "sound_release_dependency",
            "label": "Sound release 3",
            "blocksRetirement": True,
            "historical": False,
            "adminUrl": "",
            "details": {"release": 3},
        }
    ]


def test_the_command_says_when_nothing_is_registered(registry):
    make_definition("lonely")
    assert run("lonely") == "lonely: no usage providers are registered.\n"


@pytest.mark.parametrize("args", [("missing",), ("npc-pip", "--number", "9")])
def test_the_command_refuses_an_unknown_asset_or_version(registry, args):
    make_definition("npc-pip")
    with pytest.raises(CommandError):
        run(*args)


def test_the_command_fails_when_a_provider_fails(registry):
    def broken(asset, version):
        raise RuntimeError("boom")

    register_usage_provider("audio", broken)
    make_definition("chime", kind="audio", category="sound")
    with pytest.raises(CommandError, match="audio dependency check failed"):
        run("chime")


def test_a_refused_retirement_with_a_replacement_keeps_the_default(registry):
    asset = make_definition("chime", kind="audio", category="sound")
    current = make_version(asset, 1, status=VersionStatus.PUBLISHED)
    spare = make_version(asset, 2, status=VersionStatus.PUBLISHED)
    asset.default_version = current
    asset.save(update_fields=["default_version"])

    def provider(asset, version):
        pinned = version is not None and version.pk == current.pk
        return [blocking("audio", "sound_release_dependency", "Sound release 3")] if pinned else []

    register_usage_provider("audio", provider)
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_version(current, replacement=spare)
    assert refused.value.code == "sound_release_dependency"
    asset.refresh_from_db()
    current.refresh_from_db()
    assert asset.default_version_id == current.pk
    assert current.status == VersionStatus.PUBLISHED
