"""The scoring API: shape, scoping, cursor, erasure and the absence of any write route."""

import json
import uuid

import pytest

from apps.catalog.models import CollectibleSet, ItemDefinition
from apps.inventory.models import InventoryItem
from apps.scoring import ledger, policies, reconcile
from apps.scoring.contracts import Currency, SourceKind
from apps.scoring.models import AwardLedgerEntry, ProgressionProjection
from apps.scoring.projections import FEED_LIMIT

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def url(child, tail=""):
    return f"/api/v1/children/{child.pk}/scoring/{tail}"


SUMMARY_KEYS = {
    "enabled",
    "contractVersion",
    "policy",
    "totals",
    "level",
    "achievements",
    "trophies",
    "adventures",
    "subjects",
    "recentAwards",
}
AWARD_KEYS = {
    "id",
    "entryKind",
    "currency",
    "amount",
    "sourceKind",
    "sourceRef",
    "scopeKey",
    "recordedAt",
}


# --- Off --------------------------------------------------------------------------------------


def test_the_summary_is_just_the_flag_while_scoring_is_off(families, api, dev_policy):
    response = api(families.a).get(url(families.a1))
    assert response.status_code == 200
    assert response.json() == {"enabled": False, "contractVersion": 1}


def test_no_policy_also_reads_as_off(families, api, enable_scoring):
    assert api(families.a).get(url(families.a1)).json() == {"enabled": False, "contractVersion": 1}


def test_the_feed_is_empty_while_off(families, api, dev_policy, settings):
    assert api(families.a).get(url(families.a1, "awards/")).json() == {
        "awards": [],
        "cursor": None,
        "hasMore": False,
    }
    # even a leftover entry is not served while the engine is off
    settings.LAI_SCORING_ENABLED = True
    settings.LAI_SCORING_ALLOW_UNAPPROVED = True
    grant_one(families.a1, dev_policy)
    settings.LAI_SCORING_ENABLED = False
    assert api(families.a).get(url(families.a1, "awards/")).json()["awards"] == []


def grant_one(child, policy, ref="q", amount=10, currency=Currency.XP):
    from django.utils.timezone import now

    from apps.scoring.contracts import ScoringFact, Trust, idempotency_key
    from apps.scoring.rules import AwardDecision

    fact = ScoringFact(SourceKind.QUEST_COMPLETED, ref, Trust.SERVER_BOUNDED, now(), scope_key="s")
    decision = AwardDecision(
        "quest-completion",
        currency,
        amount,
        "g",
        idempotency_key(fact.source_kind, ref, currency, "g"),
    )
    return ledger.record_awards(child, policy, [ledger.Planned(fact, decision)])


# --- Summary shape ----------------------------------------------------------------------------


def test_the_summary_has_exactly_the_documented_shape(families, api, scoring):
    grant_one(families.a1, scoring, "one", 600)
    body = api(families.a).get(url(families.a1)).json()
    assert set(body) == SUMMARY_KEYS
    assert body["enabled"] is True and body["contractVersion"] == 1
    assert body["policy"] == {"key": "default", "version": 1, "provisional": True}
    assert body["totals"] == {"xp": 600, "learningPoints": 0, "coins": 0, "stars": 0}
    assert set(body["level"]) == {"level", "xp", "levelFloorXp", "nextLevelXp"}
    [award] = body["recentAwards"]
    assert set(award) == AWARD_KEYS
    assert (award["entryKind"], award["amount"], award["currency"]) == ("AWARD", 600, "XP")
    [adventure] = body["adventures"]
    assert set(adventure) == {
        "scopeKey",
        "xp",
        "learningPoints",
        "coins",
        "stars",
        "maxStars",
        "personalBest",
    }
    assert adventure["scopeKey"] == "s" and adventure["maxStars"] == 3
    assert adventure["personalBest"] is None  # no session-linked XP


def test_the_level_matches_the_policy_thresholds(families, api, scoring):
    client = api(families.a)
    assert client.get(url(families.a1)).json()["level"] == {
        "level": 1,
        "xp": 0,
        "levelFloorXp": 0,
        "nextLevelXp": 500,
    }
    grant_one(families.a1, scoring, "one", 800)
    assert client.get(url(families.a1)).json()["level"] == {
        "level": 2,
        "xp": 800,
        "levelFloorXp": 500,
        "nextLevelXp": 1500,
    }
    grant_one(families.a1, scoring, "two", 30000)
    top = client.get(url(families.a1)).json()["level"]
    assert top["level"] == 10 and top["nextLevelXp"] is None


def test_an_approved_policy_is_not_provisional(families, api, settings):
    from apps.core.tests.test_django_admin import make_admin
    from apps.scoring.models import AwardRule, ScoringPolicy

    settings.LAI_SCORING_ENABLED = True
    policy = ScoringPolicy.objects.create(version=1, title="Real", level_thresholds=[0, 100])
    AwardRule.objects.create(
        policy=policy,
        rule_key="q",
        source_kind=SourceKind.QUEST_COMPLETED,
        currency=Currency.XP,
        amount=5,
    )
    policies.record_economy_approval(policy, make_admin("api-root", superuser=True)[0])
    policies.activate(policy)
    body = api(families.a).get(url(families.a1)).json()
    assert body["policy"]["provisional"] is False


def test_achievements_list_keepsakes_and_trophies_list_owned_set_completions(
    treasure, api, scoring
):
    child = treasure.families.a1
    keepsake = ItemDefinition.objects.get(item_id="golden-doubloon")
    ItemDefinition.objects.filter(pk=keepsake.pk).update(category="KEEPSAKE")
    other = ItemDefinition.objects.get(item_id="old-brass-key")
    ItemDefinition.objects.filter(pk=other.pk).update(category="QUEST_ITEM")
    InventoryItem.objects.create(child=child, item=keepsake)
    InventoryItem.objects.create(child=child, item=other)
    owned_set = CollectibleSet.objects.create(
        set_id="api-set",
        display_name="Api set",
        completion_item=other,
        last_seen_release=keepsake.last_seen_release,
        source={},
    )
    CollectibleSet.objects.create(
        set_id="api-unowned",
        display_name="Unowned",
        completion_item=ItemDefinition.objects.exclude(pk__in=[keepsake.pk, other.pk]).first(),
        last_seen_release=keepsake.last_seen_release,
        source={},
    )
    body = api(treasure.families.a).get(url(child)).json()
    assert [a["itemId"] for a in body["achievements"]] == ["golden-doubloon"]
    assert set(body["achievements"][0]) == {"itemId", "displayName", "description", "acquiredAt"}
    assert [t["setId"] for t in body["trophies"]] == [owned_set.set_id]
    assert body["trophies"][0]["itemId"] == "old-brass-key"
    assert set(body["trophies"][0]) == {"setId", "displayName", "itemId", "acquiredAt"}
    # a sibling owns neither
    sibling = api(treasure.families.a).get(url(treasure.families.a2)).json()
    assert sibling["achievements"] == [] and sibling["trophies"] == []


def test_adventures_group_by_scope_with_a_personal_best(treasure, api, scoring):
    from apps.game_sessions import play

    child = treasure.families.a1
    session, _ = play.start_or_resume_region_session(child, treasure.region)
    reconcile.reconcile_child(child)
    body = api(treasure.families.a).get(url(child)).json()
    [adventure] = [a for a in body["adventures"] if a["scopeKey"] == "treasure-rush-cove"]
    assert adventure["xp"] == 50
    assert adventure["personalBest"] == {"xpInOneVisit": 50}
    assert session.pk


def test_the_summary_never_includes_the_nickname_or_free_text(treasure, api, scoring):
    child = treasure.families.a1
    reconcile.reconcile_child(child)
    grant_one(child, scoring, "r", 10)
    raw = api(treasure.families.a).get(url(child)).content.decode()
    assert child.nickname not in raw
    assert treasure.families.a2.nickname not in raw
    assert "Secret-Interest" not in raw
    assert str(child.pk) not in raw


# --- Scoping ----------------------------------------------------------------------------------


def test_another_familys_child_is_a_404_on_every_route(families, api, scoring):
    grant_one(families.b1, scoring)
    client = api(families.a)
    entry = AwardLedgerEntry.objects.get(child=families.b1)
    for response in (
        client.get(url(families.b1)),
        client.get(url(families.b1, "awards/")),
        client.get(url(families.b1, f"awards/?after={entry.pk}")),
        client.delete(url(families.b1)),
    ):
        assert response.status_code == 404
    assert AwardLedgerEntry.objects.filter(child=families.b1).count() == 1
    unknown = client.get(f"/api/v1/children/{uuid.uuid4()}/scoring/")
    assert unknown.status_code == 404
    assert unknown.json()["error"] == client.get(url(families.b1)).json()["error"]


def test_unauthenticated_callers_get_401(families, api, scoring):
    grant_one(families.a1, scoring)
    anonymous = api()
    for response in (
        anonymous.get(url(families.a1)),
        anonymous.get(url(families.a1, "awards/")),
        anonymous.delete(url(families.a1)),
    ):
        assert response.status_code == 401
    assert AwardLedgerEntry.objects.filter(child=families.a1).count() == 1


def test_a_siblings_awards_are_not_in_the_feed(families, api, scoring):
    grant_one(families.a1, scoring, "mine")
    grant_one(families.a2, scoring, "theirs")
    refs = [
        a["sourceRef"] for a in api(families.a).get(url(families.a1, "awards/")).json()["awards"]
    ]
    assert refs == ["mine"]


# --- Feed -------------------------------------------------------------------------------------


def test_the_feed_is_oldest_first_and_pages_by_cursor(families, api, scoring):
    for n in range(3):
        grant_one(families.a1, scoring, f"r{n}", 10 + n)
    client = api(families.a)
    feed = client.get(url(families.a1, "awards/")).json()
    assert [a["sourceRef"] for a in feed["awards"]] == ["r0", "r1", "r2"]
    assert feed["hasMore"] is False and feed["cursor"] == feed["awards"][-1]["id"]
    assert set(feed["awards"][0]) == AWARD_KEYS
    after_first = client.get(url(families.a1, f"awards/?after={feed['awards'][0]['id']}")).json()
    assert [a["sourceRef"] for a in after_first["awards"]] == ["r1", "r2"]
    at_end = client.get(url(families.a1, f"awards/?after={feed['cursor']}")).json()
    assert at_end == {"awards": [], "cursor": feed["cursor"], "hasMore": False}


def test_a_feed_page_is_capped_and_says_there_is_more(families, api, scoring):
    from django.utils.timezone import now

    base = now()
    AwardLedgerEntry.objects.bulk_create(
        [
            AwardLedgerEntry(
                child=families.a1,
                idempotency_key=f"k{n}",
                currency="XP",
                amount=1,
                source_kind="QUEST_COMPLETED",
                source_ref=f"r{n}",
                trust=1,
                occurred_at=base,
                recorded_at=base,
            )
            for n in range(FEED_LIMIT + 5)
        ]
    )
    client = api(families.a)
    page = client.get(url(families.a1, "awards/")).json()
    assert len(page["awards"]) == FEED_LIMIT and page["hasMore"] is True
    rest = client.get(url(families.a1, f"awards/?after={page['cursor']}")).json()
    assert len(rest["awards"]) == 5 and rest["hasMore"] is False
    seen = {a["id"] for a in page["awards"]} | {a["id"] for a in rest["awards"]}
    assert len(seen) == FEED_LIMIT + 5  # same timestamp: the id tiebreak loses nothing


# A fixed unknown UUID: a random one changes the test id on every collection, which parallel
# workers (pytest-xdist) refuse because they must all collect the same tests.
BAD_CURSORS = ["nonsense", "123", "5f0c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f"]


@pytest.mark.parametrize("cursor", BAD_CURSORS)
def test_an_invalid_or_unknown_cursor_is_a_400(families, api, scoring, cursor):
    grant_one(families.a1, scoring)
    response = api(families.a).get(url(families.a1, f"awards/?after={cursor}"))
    assert response.status_code == 400


@pytest.mark.parametrize("cursor", BAD_CURSORS)
def test_an_invalid_cursor_reports_the_invalid_cursor_code(families, api, scoring, cursor):
    grant_one(families.a1, scoring)
    response = api(families.a).get(url(families.a1, f"awards/?after={cursor}"))
    assert response.json()["error"]["code"] == "invalid_cursor"


def test_another_childs_cursor_is_a_400(families, api, scoring):
    [foreign] = grant_one(families.a2, scoring, "sibling")
    response = api(families.a).get(url(families.a1, f"awards/?after={foreign.pk}"))
    assert response.status_code == 400


def test_another_childs_cursor_reports_the_invalid_cursor_code(families, api, scoring):
    [foreign] = grant_one(families.a2, scoring, "sibling")
    response = api(families.a).get(url(families.a1, f"awards/?after={foreign.pk}"))
    assert response.json()["error"]["code"] == "invalid_cursor"


def test_corrections_appear_in_the_feed_but_not_in_recent_awards(families, api, scoring):
    from apps.core.tests.test_django_admin import make_admin

    [entry] = grant_one(families.a1, scoring, "c", 100)
    ledger.record_correction(entry, -30, "fix", make_admin("api-fix-staff")[0])
    client = api(families.a)
    kinds = [a["entryKind"] for a in client.get(url(families.a1, "awards/")).json()["awards"]]
    assert kinds == ["AWARD", "CORRECTION"]
    body = client.get(url(families.a1)).json()
    assert [a["entryKind"] for a in body["recentAwards"]] == ["AWARD"]
    assert body["totals"]["xp"] == 70


# --- Erasure and the absence of writes --------------------------------------------------------


def test_delete_erases_only_that_childs_scoring_and_leaves_the_backpack(treasure, api, scoring):
    f = treasure.families
    item = ItemDefinition.objects.get(item_id="golden-doubloon")
    InventoryItem.objects.create(child=f.a1, item=item)
    grant_one(f.a1, scoring, "mine")
    grant_one(f.a2, scoring, "sibling")
    response = api(f.a).delete(url(f.a1))
    assert response.status_code == 204 and not response.content
    assert not AwardLedgerEntry.objects.filter(child=f.a1).exists()
    assert not ProgressionProjection.objects.filter(child=f.a1).exists()
    assert AwardLedgerEntry.objects.filter(child=f.a2).count() == 1
    assert InventoryItem.objects.filter(child=f.a1).count() == 1
    # Erasing again is fine, and a later reconcile rebuilds from the records that remain.
    assert api(f.a).delete(url(f.a1)).status_code == 204


@pytest.mark.parametrize("tail", ["", "awards/"])
@pytest.mark.parametrize("method", ["post", "put", "patch"])
def test_there_is_no_write_route(families, api, scoring, tail, method):
    client = api(families.a)
    body = json.dumps({"amount": 9999, "currency": "XP", "totals": {"xp": 9999}})
    response = getattr(client, method)(
        url(families.a1, tail), body, content_type="application/json"
    )
    assert response.status_code == 405
    assert not AwardLedgerEntry.objects.filter(child=families.a1).exists()


def test_the_feed_route_has_no_delete(families, api, scoring):
    assert api(families.a).delete(url(families.a1, "awards/")).status_code == 405
