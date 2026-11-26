"""Cross-system regression: asset library operations must not change quest identities, puzzle
attempts, scoring, XP, rewards, progression or parent learning evidence.

Scenario: a child plays (Heart of Firepeak puzzles; Treasure Cove crow's nest chest), then staff
change asset versions, retire versions, try to retire in-use assets, rely on bundled fallback,
and republish content. The child's records must be identical afterwards, reconcile must award
nothing new, and a second child playing after the changes must get the same shape of records.
"""

import io
from collections import Counter

import pytest
from django.core.management import call_command
from django.test import override_settings

from apps.assets import services as assets
from apps.assets.services import AssetActionRefused
from apps.assets.tests.conftest import fresh_asset_storage, storage  # noqa: F401 - fixtures
from apps.assets.tests.helpers import glb_bytes
from apps.catalog import authoring
from apps.catalog.models import ContentAsset
from apps.catalog.tests.helpers import publish_edit
from apps.education.models import SkillEvidence, SkillProgress
from apps.education.tests.test_puzzle_evidence import heart, play_all  # noqa: F401 - fixture
from apps.game_sessions.models import ChallengeAttempt, PuzzleAttempt
from apps.game_sessions.play_state import practice_summary, region_catalog
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import WorldChange
from apps.quests.models import QuestProgress
from apps.regions import firepeak_heart_seed as seed
from apps.regions.models import AreaPuzzle, TreasureChest, WorldRegion
from apps.scoring import ledger, reconcile
from apps.scoring.models import AwardLedgerEntry

from .test_realms import answer_leap_chest

pytestmark = [pytest.mark.postgres, pytest.mark.django_db, pytest.mark.usefixtures("storage")]


def snapshot(child) -> dict:
    """Everything a child earned, without row ids, sessions or timestamps."""
    return {
        "puzzles": sorted(
            PuzzleAttempt.objects.filter(child=child).values_list(
                "region_id", "puzzle_key", "correct", "attempt_number", "age_band"
            )
        ),
        "puzzle_links": PuzzleAttempt.objects.filter(child=child, area_puzzle=None).count(),
        "chests": sorted(
            ChallengeAttempt.objects.filter(child=child).values_list(
                "region_id", "target_entity_id", "skill_id", "status", "correctness"
            )
        ),
        "evidence": sorted(
            SkillEvidence.objects.filter(child=child).values_list(
                "learning_objective_code", "evidence_type", "result", "support_level"
            )
        ),
        "skills": sorted(
            SkillProgress.objects.filter(child=child).values_list(
                "learning_objective_code",
                "exposure_count",
                "independent_success_count",
                "supported_success_count",
                "recent_level",
            )
        ),
        "world": sorted(
            WorldChange.objects.filter(child=child).values_list("location_slug", "change_key")
        ),
        "quests": sorted(
            (q.quest.slug, q.status, tuple(q.completed_stage_ids), tuple(q.completed_objective_ids))
            for q in QuestProgress.objects.filter(child=child).select_related("quest")
        ),
        "items": sorted(
            InventoryItem.objects.filter(child=child).values_list("item__item_id", flat=True)
        ),
        "rules": sorted(GrantedRule.objects.filter(child=child).values_list("rule_id", flat=True)),
        "awards": Counter(
            AwardLedgerEntry.objects.filter(child=child).values_list(
                "source_kind", "currency", "amount", "entry_kind"
            )
        ),
        "totals": ledger.ledger_totals(child),
        "practice": sorted(
            (r["objective_code"], r.get("attempts"), r.get("correct"))
            for r in practice_summary(child)
        ),
    }


def own_keys(child):
    return sorted(
        AwardLedgerEntry.objects.filter(child=child).values_list("idempotency_key", flat=True)
    )


def publish_new_version(asset: ContentAsset, *, depth: float):
    """A distinct valid GLB per depth, so the library never refuses it as a duplicate."""
    clips = tuple(asset.clips or ("Idle",))
    data = glb_bytes(clips=clips, half_size=(0.5, 1.0, depth))
    version = assets.upload_version(asset, io.BytesIO(data), original_filename="m.glb")
    return assets.publish_version(version)


def churn_assets(region: WorldRegion) -> dict:
    """Staff operations on every library asset the published Area uses.

    Returns counts of what was done, so the test can prove it actually exercised something."""
    ids = set(region.placements.exclude(asset_id="").values_list("asset_id", flat=True))
    ids.update(region.chests.exclude(asset_id="").values_list("asset_id", flat=True))
    done = Counter()
    for asset in ContentAsset.objects.filter(asset_id__in=ids).order_by("asset_id"):
        # 1. Version change: publish v1, then v2, switch the default to v2.
        try:
            v1 = publish_new_version(asset, depth=0.25)
            v2 = publish_new_version(asset, depth=0.3)
        except AssetActionRefused as refused:
            done[f"skipped:{refused.code}"] += 1
            continue
        assets.set_default_version(v2)
        done["version_switch"] += 1
        # 2. Retire the old, non-default version.
        assets.retire_version(v1)
        done["version_retired"] += 1
        # 3. Retirement protection: the published Area must block retiring the asset.
        try:
            assets.retire_asset(asset)
        except AssetActionRefused as refused:
            done[f"retire_refused:{refused.code}"] += 1
        else:
            done["retire_ALLOWED"] += 1
            assets.reactivate_asset(asset)
        asset.refresh_from_db()
    return dict(done)


def retirements(done: dict) -> list[str]:
    return [key for key in done if key.startswith("retire_")]


def bundled_fallback(region: WorldRegion) -> int:
    """Strip library versions from one used asset that ships a bundled file: it must stay
    deliverable through the bundled path (no progress impact either way)."""
    catalog = {a["assetId"]: a for a in region_catalog(region)["assets"]}
    bundled = [a for a in ContentAsset.objects.filter(asset_id__in=catalog) if a.bundled_path]
    for asset in bundled:
        ContentAsset.objects.filter(pk=asset.pk).update(default_version=None)
    after = {a["assetId"]: a for a in region_catalog(region)["assets"]}
    assert all(after[a.asset_id]["deliverable"] for a in bundled)
    return len(bundled)


def republish_content():
    """Content publishing: a staff revision of every Area puzzle's text, then the seed and
    publish commands rerun (as a deploy would)."""
    changed = 0
    for puzzle in AreaPuzzle.objects.filter(region__region_id=seed.REGION_ID):
        body = authoring.current_body(puzzle)
        body = {**body, "title": f"{body.get('title') or puzzle.puzzle_id} (revised)"}
        publish_edit(puzzle, body, note="asset churn regression")
        changed += 1
    with override_settings(DEBUG=True):
        call_command("seed_firepeak_heart", stdout=None)
        call_command("publish_firepeak_heart", stdout=None)
    return changed


def test_heart_progress_survives_asset_churn_and_republishing(heart, api, scoring):  # noqa: F811
    families = heart
    child, later = families.a1, families.a2
    region = WorldRegion.objects.get(region_id=seed.REGION_ID)
    puzzles = AreaPuzzle.objects.filter(region=region)
    puzzle_ids = sorted(puzzles.values_list("puzzle_id", flat=True))

    play_all(api(families.a), child)
    reconcile.reconcile_child(child)
    before, keys = snapshot(child), own_keys(child)
    assert before["puzzles"] and before["evidence"] and before["awards"], before

    done = churn_assets(region)
    assert done.get("version_switch"), "the Heart uses no library asset; nothing was exercised"
    assert set(retirements(done)) == {"retire_refused:region_placement_dependency"}, done
    assert bundled_fallback(region)
    revised = republish_content()
    assert revised

    # Stable identities.
    assert (
        sorted(AreaPuzzle.objects.filter(region=region).values_list("puzzle_id", flat=True))
        == puzzle_ids
    )

    # Nothing about the child changed, and reconcile pays nothing again.
    reconcile.reconcile_child(child)
    reconcile.reconcile_child(child)
    assert snapshot(child) == before
    assert own_keys(child) == keys
    assert ledger.projection_matches_ledger(child)

    # A child playing after the changes earns the same shape of records.
    play_all(api(families.a), later)
    reconcile.reconcile_child(later)
    assert snapshot(later) == before


def test_treasure_chest_survives_asset_churn(treasure, scoring):
    families = treasure.families
    child, later = families.a1, families.a2
    outcome = answer_leap_chest(treasure, child)
    assert outcome
    reconcile.reconcile_child(child)
    before, keys = snapshot(child), own_keys(child)
    assert before["chests"] and before["awards"], before
    chests = sorted(
        TreasureChest.objects.filter(region=treasure.region).values_list(
            "entity_id", "world_change_key"
        )
    )

    done = churn_assets(treasure.region)
    assert done.get("version_switch"), "the cove uses no library asset; nothing was exercised"
    assert set(retirements(done)) == {"retire_refused:region_placement_dependency"}, done
    assert bundled_fallback(treasure.region)

    assert (
        sorted(
            TreasureChest.objects.filter(region=treasure.region).values_list(
                "entity_id", "world_change_key"
            )
        )
        == chests
    )
    reconcile.reconcile_child(child)
    assert snapshot(child) == before
    assert own_keys(child) == keys
    assert ledger.projection_matches_ledger(child)

    answer_leap_chest(treasure, later)
    reconcile.reconcile_child(later)
    assert snapshot(later) == before
