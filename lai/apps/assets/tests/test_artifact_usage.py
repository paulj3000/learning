"""LAI-07 W2-5: derived artifacts are an informational usage source and never block retirement."""

import pytest

from apps.assets import artifact_usage, dependencies, services
from apps.assets.models import ArtifactState, VersionStatus
from apps.assets.services import AssetActionRefused
from apps.assets.tests.artifact_usage_helpers import make_artifact
from apps.assets.tests.helpers import make_definition, make_version
from apps.catalog.models import AssetStatus

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def asset():
    definition = make_definition("palm")
    v1 = make_version(definition, 1, status=VersionStatus.PUBLISHED)
    v2 = make_version(definition, 2, status=VersionStatus.PUBLISHED)
    definition.default_version = v1
    definition.save()
    return definition, v1, v2


def artifact_usages(definition, version=None):
    return [u for u in dependencies.usages_for(definition, version) if u.source == "artifacts"]


def test_the_provider_is_registered_once_after_the_existing_guards():
    sources = dependencies.registered_sources()
    assert sources.count("artifacts") == 1
    assert dependencies._PROVIDERS["artifacts"].provider is artifact_usage.artifact_usages


def test_registering_twice_is_a_no_op():
    before = dict(dependencies._PROVIDERS)
    artifact_usage.register()
    artifact_usage.register()
    assert dependencies._PROVIDERS == before
    assert dependencies.registered_sources().count("artifacts") == 1


@pytest.mark.parametrize("state", list(ArtifactState))
@pytest.mark.parametrize("hold", [False, True])
def test_no_artifact_ever_blocks(asset, state, hold):
    definition, v1, v2 = asset
    make_artifact(v1, state=state, promoted_version=v2, retention_hold=hold)
    related = (None, v1, v2) if state == ArtifactState.PROMOTED else (None, v1)
    for version in related:
        found = artifact_usages(definition, version)
        assert found
        assert not any(u.blocks_retirement for u in found)
        assert {u.code for u in found} == {"derived_artifact"}


def test_an_asset_used_only_by_an_artifact_retires(asset):
    definition, v1, _ = asset
    make_artifact(v1, state=ArtifactState.PROMOTED, promoted_version=asset[2], retention_hold=True)
    assert artifact_usages(definition)
    services.retire_asset(definition)
    definition.refresh_from_db()
    assert definition.status == AssetStatus.RETIRED


@pytest.mark.parametrize(
    ("state", "historical"),
    [
        (ArtifactState.PENDING_REVIEW, False),
        (ArtifactState.ACCEPTED, False),
        (ArtifactState.PROMOTED, False),
        (ArtifactState.SUPERSEDED, False),
        (ArtifactState.REJECTED, True),
        (ArtifactState.EXPIRED, True),
        (ArtifactState.DELETED, True),
    ],
)
def test_expired_and_rejected_artifacts_are_historical(asset, state, historical):
    make_artifact(asset[1], state=state, promoted_version=asset[2])
    (usage,) = artifact_usages(asset[0])
    assert usage.historical is historical
    assert usage.details["status"] == state


def test_the_label_names_content_ids_and_the_details_carry_kind_and_status(asset):
    artifact = make_artifact(asset[1], state=ArtifactState.PROMOTED, promoted_version=asset[2])
    (usage,) = artifact_usages(asset[0])
    assert usage.label == (
        f"Derived artifact {str(artifact.pk)[:8]} (meshopt) from version 1, promoted to version 2"
    )
    assert usage.details == {
        "artifact": str(artifact.pk),
        "kind": "model.optimized",
        "status": "promoted",
        "sourceVersion": 1,
        "promotedVersion": 2,
    }
    assert usage.admin_url == f"/admin/assets/derivedartifact/{artifact.pk}/change/" or (
        usage.admin_url.endswith(f"/assets/derivedartifact/{artifact.pk}/change/")
    )


def test_an_exact_version_sees_only_its_own_artifacts(asset):
    definition, v1, v2 = asset
    from_v1 = make_artifact(v1, logical_id="a")
    from_v2 = make_artifact(v2, logical_id="b")
    promoted_into_v2 = make_artifact(
        v1, logical_id="c", state=ArtifactState.PROMOTED, promoted_version=v2
    )
    ids = lambda version: {u.details["artifact"] for u in artifact_usages(definition, version)}  # noqa: E731
    assert ids(None) == {str(a.pk) for a in (from_v1, from_v2, promoted_into_v2)}
    assert ids(v1) == {str(from_v1.pk), str(promoted_into_v2.pk)}
    assert ids(v2) == {str(from_v2.pk), str(promoted_into_v2.pk)}


def test_another_assets_artifacts_are_not_listed(asset):
    other = make_definition("rock")
    make_artifact(make_version(other, 1, status=VersionStatus.PUBLISHED))
    assert artifact_usages(asset[0]) == []


def test_a_failing_provider_is_isolated_for_display_but_retirement_still_fails_closed(
    asset, monkeypatch
):
    definition, v1, _ = asset
    make_artifact(v1)

    def broken(asset, version):
        raise RuntimeError("secret database detail")

    boom = dependencies._Registration(broken, None)
    monkeypatch.setattr(dependencies, "_PROVIDERS", {"broken": boom, **dependencies._PROVIDERS})

    entries = dependencies.usages_by_source(definition)
    assert entries[0].source == "broken" and entries[0].failed and entries[0].usages == ()
    by_source = {e.source: e for e in entries}
    assert by_source["artifacts"].failed is False and by_source["artifacts"].usages

    with pytest.raises(dependencies.DependencyCheckFailed):
        dependencies.usages_for(definition)
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(definition)
    assert refused.value.code == "dependency_check_failed"
    assert refused.value.details == {"source": "broken", "check_class": "unclassified"}
    assert "secret" not in refused.value.message
    definition.refresh_from_db()
    assert definition.status != AssetStatus.RETIRED
