"""Eligibility and the default event (SC-R08-01), pure and Python-owned (ADR-065).

These rules used to be held to a TypeScript port by golden vectors. The client no longer picks
events (it keeps one quiet default line per room), so the Python rules are the only ones and
these tests carry the former vectors. No database: the functions take plain dicts.
"""

import pytest

from apps.regions import castle_events, castle_rooms

BANDS = ["SPROUT", "PATHFINDER", "EXPLORER"]


def make(event_id, **overrides):
    return {
        "id": event_id,
        "status": "PUBLISHED",
        "version": 1,
        "room": "story-hall",
        "bands": BANDS,
        "requires": [],
        "repeat": {"maxShows": None, "minVisitGap": 0},
        "weight": 2,
        "npcId": None,
        "lines": {"SPROUT": ["a"], "PATHFINDER": ["b"], "EXPLORER": ["c"]},
        "visual": {"kind": "dust-motes"},
        "fallback": False,
        "secret": True,
        **overrides,
    }


def state(**overrides):
    return {
        "ageBand": "PATHFINDER",
        "roomId": "story-hall",
        "conditions": {"worldChanges": [], "questStatuses": {}, "relationshipLevels": {}},
        "shownCounts": {},
        "lastShownVisit": {},
        "currentVisitIndex": 5,
        **overrides,
    }


QUIET = make("quiet", weight=1, fallback=True)
FIXTURE = [
    QUIET,
    make("draft", status="DRAFT", weight=5),
    make("retired", status="RETIRED", weight=5),
    make("sprouts-only", bands=["SPROUT"], weight=4),
    make("library", room="great-library", weight=5),
    make("anywhere", room="ANY", weight=3),
    make(
        "story-told",
        weight=4,
        requires=[
            {"type": "WORLD_CHANGE", "key": "FIRST_STORY_TOLD", "place": "storykeeper-castle"}
        ],
    ),
    make(
        "quest-done",
        weight=4,
        requires=[{"type": "QUEST_STATUS", "quest": "q1", "status": "COMPLETED"}],
    ),
    make(
        "quill-friend",
        weight=4,
        npcId="keeper-quill",
        requires=[{"type": "RELATIONSHIP_AT_LEAST", "level": "FRIEND"}],
    ),
    make("twice", weight=4, repeat={"maxShows": 2, "minVisitGap": 0}),
    make("gap-two", weight=4, repeat={"maxShows": None, "minVisitGap": 2}),
    make("unknown-condition", weight=5, requires=[{"type": "LOCAL_FLAG", "flag": "x"}]),
]
MET = {
    "worldChanges": [{"place": "storykeeper-castle", "key": "FIRST_STORY_TOLD"}],
    "questStatuses": {"q1": "COMPLETED"},
    "relationshipLevels": {"keeper-quill": "TRUSTED_FRIEND"},
}
ELSEWHERE = {
    "worldChanges": [{"place": "elsewhere", "key": "FIRST_STORY_TOLD"}],
    "questStatuses": {},
    "relationshipLevels": {"keeper-quill": "ACQUAINTANCE"},
}
PLAIN = ["gap-two", "twice", "anywhere", "quiet"]


def ids(events):
    return [e["id"] for e in events]


@pytest.mark.parametrize(
    ("catalog", "given", "expected"),
    [
        (FIXTURE, state(), PLAIN),
        (
            FIXTURE,
            state(ageBand="SPROUT"),
            ["gap-two", "sprouts-only", "twice", "anywhere", "quiet"],
        ),
        (FIXTURE, state(roomId="great-library"), ["library", "anywhere"]),
        (
            FIXTURE,
            state(conditions=MET),
            ["gap-two", "quest-done", "quill-friend", "story-told", "twice", "anywhere", "quiet"],
        ),
        (FIXTURE, state(conditions=ELSEWHERE), PLAIN),
        (FIXTURE, state(shownCounts={"twice": 2}), ["gap-two", "anywhere", "quiet"]),
        (FIXTURE, state(shownCounts={"twice": 1}), PLAIN),
        (FIXTURE, state(lastShownVisit={"gap-two": 4}), ["twice", "anywhere", "quiet"]),
        (FIXTURE, state(lastShownVisit={"gap-two": 3}), PLAIN),
        (list(reversed(FIXTURE)), state(), PLAIN),
        ([QUIET], state(shownCounts={"quiet": 50}), ["quiet"]),
        (
            [make("quiet", weight=1, fallback=True, repeat={"maxShows": 1, "minVisitGap": 0})],
            state(shownCounts={"quiet": 1}),
            [],
        ),
        ([], state(), []),
    ],
    ids=[
        "plain",
        "sprout",
        "library",
        "conditions-met",
        "other-place",
        "max-shows-spent",
        "max-shows-one-short",
        "gap-not-reached",
        "gap-reached",
        "catalog-order",
        "fallback-only",
        "fallback-spent",
        "empty",
    ],
)
def test_eligible_events(catalog, given, expected):
    assert ids(castle_events.eligible_events(catalog, given)) == expected


@pytest.mark.parametrize(
    ("catalog", "given", "expected"),
    [
        (FIXTURE, state(), "gap-two"),
        (FIXTURE, state(roomId="great-library"), "library"),
        (FIXTURE, state(lastShownVisit={"gap-two": 4}), "twice"),
        ([QUIET], state(shownCounts={"quiet": 50}), "quiet"),
        # Spent, the room's quiet fallback still answers: the repeat rules are ignored.
        (
            [make("quiet", weight=1, fallback=True, repeat={"maxShows": 1, "minVisitGap": 0})],
            state(shownCounts={"quiet": 1}),
            "quiet",
        ),
        ([], state(), None),
    ],
)
def test_default_event(catalog, given, expected):
    event = castle_events.default_event(catalog, given)
    assert (event["id"] if event else None) == expected


def test_only_published_events_count_and_an_unknown_condition_never_holds():
    got = ids(castle_events.eligible_events(FIXTURE, state()))
    assert not {"draft", "retired", "unknown-condition"} & set(got)
    assert castle_events.default_event([make("d", status="DRAFT", fallback=True)], state()) is None


def test_a_relationship_condition_without_an_npc_never_holds():
    event = make("nn", requires=[{"type": "RELATIONSHIP_AT_LEAST", "level": "STRANGER"}])
    assert castle_events.eligible_events([event], state(conditions=MET)) == []


# --- the shipped seed ----------------------------------------------------------------------------


@pytest.mark.parametrize("band", BANDS)
def test_the_seed_has_one_quiet_default_for_every_room_and_band(band):
    for room in castle_rooms.ROOM_IDS:
        fallbacks = [
            e
            for e in castle_events.SEED_CATALOG
            if e["fallback"] and e["room"] == room and band in e["bands"]
        ]
        assert len(fallbacks) == 1, (room, band)
        default = castle_events.default_event(
            castle_events.SEED_CATALOG, state(roomId=room, ageBand=band)
        )
        assert default is not None


def test_the_seed_picks_the_documented_events():
    seed = castle_events.SEED_CATALOG
    assert ids(castle_events.eligible_events(seed, state())) == [
        "lanterns-glow-brighter",
        "quill-hums-in-hall",
        "quiet-story-hall",
    ]
    after_ember = state(
        roomId="setting-tower",
        ageBand="EXPLORER",
        conditions={
            "worldChanges": [
                {"place": "dragons-sanctuary", "key": "DRAGON_OF_EMBER_MOUNTAIN_COMPLETE"},
                {"place": "storykeeper-castle", "key": "GREAT_STORYBOOK_RESTORED"},
            ],
            "questStatuses": {},
            "relationshipLevels": {},
        },
    )
    assert castle_events.default_event(seed, after_ember)["id"] == "ember-flies-past-tower"
    chamber = state(roomId="secret-chamber")
    assert castle_events.default_event(seed, chamber)["id"] == "chamber-crystals-hum"


def test_the_secret_chamber_lines_that_know_about_finds_wait_for_them():
    seed = castle_events.SEED_CATALOG
    star = "CASTLE_CHAMBER_STAR_FOUND"
    door = "CASTLE_CHAMBER_MOUSE_DOOR_FOUND"

    def at(*keys):
        conditions = {
            "worldChanges": [{"place": "storykeeper-castle", "key": k} for k in keys],
            "questStatuses": {},
            "relationshipLevels": {},
        }
        return ids(
            castle_events.eligible_events(
                seed, state(roomId="secret-chamber", conditions=conditions)
            )
        )

    assert "chamber-star-twinkles" not in at() and "chamber-finds-remembered" not in at()
    assert "chamber-star-twinkles" in at(star)
    assert "chamber-finds-remembered" in at(star, door)


def test_the_seed_is_atmosphere_only():
    allowed = castle_events.BODY_KEYS | {"status", "version", "secret"}
    for event in castle_events.SEED_CATALOG:
        assert set(event) == allowed, event["id"]
        assert event["secret"] is True and event["status"] == "PUBLISHED"
