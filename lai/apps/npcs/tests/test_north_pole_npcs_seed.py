"""The North Pole NPCs (`seed_npc_north_pole`): skips cleanly without prerequisites, create-only
and idempotent, placements derived from the Area, Snowball's three escort placements, OFFER_QUEST
values, DRAFT until the model is live, publishing with the fake speech provider, and child safe
copy for every age band."""

import re
from io import StringIO

import pytest
from django.core.management import call_command

from apps.catalog.models import AssetOrigin, ContentAsset, NpcDefinition, Quest
from apps.core.content_status import ContentStatus
from apps.npcs import north_pole_content as np
from apps.npcs.management.commands.seed_npc_north_pole import seed_north_pole
from apps.npcs.models import (
    NpcBehaviorProfile,
    NpcCharacter,
    NpcDialogue,
    NpcDialogueChoice,
    NpcDialogueNode,
    NpcPlacement,
    NpcRelease,
)
from apps.npcs.publishing import active_release, preview
from apps.npcs.tests.helpers import content_release, make_place
from apps.npcs.vocabulary import ANIMATION_STATES, CharacterStatus, Emotion
from apps.speech.models import VoiceProfile

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

EXPECTED_NPCS = {
    "santa-claus",
    "mrs-claus",
    "jingle",
    "tinker",
    "peppermint",
    "frosty",
    "noel",
    "ginger",
    "polaris",
    "snowball",
}
ASSET_IDS = {
    "north-pole-santa",
    "north-pole-mrs-claus",
    "north-pole-elf-jingle",
    "north-pole-elf-tinker",
    "north-pole-elf-peppermint",
    "north-pole-elf-frosty",
    "north-pole-elf-noel",
    "north-pole-elf-ginger",
    "north-pole-elf-polaris",
    "north-pole-reindeer-calf",
}
VOICES = {
    "santa-claus": "Matthew",
    "mrs-claus": "Joanna",
    "jingle": "Ivy",
    "tinker": "Justin",
    "peppermint": "Salli",
    "frosty": "Kevin",
    "noel": "Brian",
    "ginger": "Emma",
    "polaris": "Amy",
}
#: Contract section 6: who offers which quest.
OFFERS = {
    ("jingle", "np-q01-welcome"),
    ("jingle", "np-q07-snowflake-mountain"),
    ("tinker", "np-q02-toy-workshop"),
    ("peppermint", "np-q03-candy-cane-forest"),
    ("frosty", "np-q04-frozen-lake"),
    ("noel", "np-q05-missing-reindeer"),
    ("ginger", "np-q06-gingerbread-mystery"),
    ("polaris", "np-q08-restore-the-star"),
    ("santa-claus", "np-q09-christmas-eve"),
}
#: Placement entity ids the layout gives the Area (contract section 7), with a spot each.
AREA_NPC_SPOTS = {
    "np-santa": ("santa-claus", 0.0, 90.0),
    "np-mrs-claus": ("mrs-claus", -46.0, -40.0),
    "np-jingle": ("jingle", 4.0, 88.0),
    "np-jingle-mountain": ("jingle", -34.0, -72.0),
    "np-tinker": ("tinker", -44.0, 60.0),
    "np-peppermint": ("peppermint", 44.0, 60.0),
    "np-frosty": ("frosty", -44.0, 12.0),
    "np-noel": ("noel", 44.0, 20.0),
    "np-ginger": ("ginger", -40.0, -30.0),
    "np-polaris": ("polaris", 30.0, -84.0),
    "np-snowball": ("snowball", 50.0, -40.0),
}
PLACEMENTS = {
    "np-santa",
    "np-mrs-claus",
    "np-jingle",
    "np-jingle-mountain",
    "np-tinker",
    "np-peppermint",
    "np-frosty",
    "np-noel",
    "np-ginger",
    "np-polaris",
    "np-snowball-lost",
    "np-snowball-follow",
    "np-snowball-home",
}
BANDS = ("SPROUT", "PATHFINDER", "EXPLORER")


def run(*args) -> str:
    out = StringIO()
    call_command("seed_npc_north_pole", *args, stdout=out)
    return out.getvalue()


def catalog_npcs() -> None:
    """What `load_content` gives: the ten catalog NPC rows and the nine quests."""
    for npc in np.NPCS:
        NpcDefinition.objects.get_or_create(
            npc_id=npc.npc_id,
            defaults={
                "display_name": npc.name,
                "home_location_slug": np.PLACE_SLUG,
                "origin": AssetOrigin.DJANGO,
            },
        )
    for slug in np.QUESTS.values():
        Quest.objects.get_or_create(
            slug=slug,
            defaults={
                "title": slug,
                "age_bands": list(BANDS),
                "source": {"stages": []},
                "last_seen_release": content_release(),
            },
        )


def model_assets(*, live: bool = True) -> None:
    """The character ContentAssets `seed_north_pole` declares (live: with a bundled file)."""
    for npc in np.NPCS:
        ContentAsset.objects.get_or_create(
            asset_id=npc.asset_id,
            defaults={
                "kind": "character",
                "category": npc.asset_category,
                "bundled_path": f"/models/{npc.asset_id}.glb" if live else "",
                "clips": list(npc.clips),
                "origin": AssetOrigin.EXPORT,
                "last_seen_release": content_release(),
            },
        )


def area(*, entities=None):
    """The `north-pole-village` Area with its NPC placements (what the layout seed gives)."""
    from apps.regions.models import PlacementKind, WorldObjectPlacement, WorldRegion

    _world, place = make_place("north-pole", np.PLACE_SLUG)
    region = WorldRegion.objects.create(
        region_id=np.REGION_ID, location=place, title="North Pole", status=ContentStatus.PUBLISHED
    )
    for entity_id, (npc_id, x, z) in AREA_NPC_SPOTS.items():
        if entities is not None and entity_id not in entities:
            continue
        WorldObjectPlacement.objects.create(
            region=region,
            kind=PlacementKind.NPC,
            entity_id=entity_id,
            npc=NpcDefinition.objects.get(npc_id=npc_id),
            asset_id="",
            x=x,
            z=z,
            rotation_y=3.14,
        )
    return region


@pytest.fixture
def ready():
    catalog_npcs()
    model_assets()
    area()


# --- prerequisites ------------------------------------------------------------------------------


def test_missing_prerequisites_skip_with_messages_and_never_crash():
    out = run()
    assert "unchanged" in out
    assert "does not exist yet: placements skipped" in out
    for npc_id in EXPECTED_NPCS:
        assert f"{npc_id} skipped: missing catalog NPC" in out
    assert not NpcCharacter.objects.exists()
    assert not VoiceProfile.objects.exists()


def test_missing_model_assets_skip_only_those_characters():
    catalog_npcs()
    model_assets()
    ContentAsset.objects.filter(asset_id="north-pole-elf-polaris").delete()
    out = run()
    assert "polaris skipped: missing character asset north-pole-elf-polaris" in out
    assert set(NpcCharacter.objects.values_list("definition__npc_id", flat=True)) == (
        EXPECTED_NPCS - {"polaris"}
    )


def test_a_missing_quest_skips_the_quest_giver():
    catalog_npcs()
    model_assets()
    Quest.objects.filter(slug="np-q05-missing-reindeer").delete()
    out = run()
    assert "noel skipped: missing quest np-q05-missing-reindeer" in out
    assert not NpcCharacter.objects.filter(definition__npc_id="noel").exists()
    assert NpcCharacter.objects.filter(definition__npc_id="snowball").exists()


# --- creation, idempotence --------------------------------------------------------------------


def test_creates_everything_once_and_a_rerun_creates_nothing(ready):
    first = run()
    assert "North Pole NPCs: created" in first and "Validation: no problems." in first
    assert set(NpcCharacter.objects.values_list("definition__npc_id", flat=True)) == EXPECTED_NPCS
    assert set(NpcPlacement.objects.values_list("placement_key", flat=True)) == PLACEMENTS
    for character in NpcCharacter.objects.all():
        assert character.status == CharacterStatus.READY
        assert character.age_bands == list(BANDS)
        assert character.personas.filter(status="APPROVED").count() == 1
        variant = character.variants.get()
        assert set(variant.animation_map) <= set(ANIMATION_STATES)
    assert seed_north_pole() == ([], [])
    second = run()
    assert "unchanged" in second and "Validation: no problems." in second
    assert NpcRelease.objects.count() == 0  # validating never publishes


def test_never_overwrites_a_row_staff_changed(ready):
    run()
    node = NpcDialogue.objects.get(
        character__definition__npc_id="tinker", dialogue_key="fallback"
    ).nodes.get()
    node.text = "Hello from staff!"
    node.save()
    behavior = NpcBehaviorProfile.objects.get(key="np-snowball-follow")
    behavior.parameters = {**behavior.parameters, "speed": 4}
    behavior.save()
    run()
    node.refresh_from_db()
    behavior.refresh_from_db()
    assert node.text == "Hello from staff!"
    assert behavior.parameters["speed"] == 4


def test_placements_wait_for_the_area_and_are_derived_from_it_later():
    catalog_npcs()
    model_assets()
    assert "placements skipped" in run()
    assert not NpcPlacement.objects.exists()
    area()
    run()
    assert set(NpcPlacement.objects.values_list("placement_key", flat=True)) == PLACEMENTS
    santa = NpcPlacement.objects.get(placement_key="np-santa")
    assert (santa.x, santa.z, santa.rotation_y) == (0.0, 90.0, 3.14)
    assert santa.region.region_id == "north-pole-village"
    assert NpcPlacement.objects.get(placement_key="np-jingle-mountain").z == -72.0
    assert seed_north_pole() == ([], [])


def test_a_spot_without_an_area_placement_is_skipped_not_invented():
    catalog_npcs()
    model_assets()
    area(entities=PLACEMENTS_WITHOUT_TINKER)
    out = run()
    assert "np-tinker skipped: the Area has no NPC placement np-tinker" in out
    assert not NpcPlacement.objects.filter(placement_key="np-tinker").exists()


PLACEMENTS_WITHOUT_TINKER = set(AREA_NPC_SPOTS) - {"np-tinker"}


# --- voices -----------------------------------------------------------------------------------


def test_voice_profiles_use_the_contract_polly_voices_and_snowball_has_none(ready):
    run()
    assert set(VoiceProfile.objects.values_list("profile_id", flat=True)) == set(VOICES)
    for profile_id, voice in VOICES.items():
        profile = VoiceProfile.objects.get(profile_id=profile_id)
        assert profile.polly_voice_id == voice
        assert profile.character_id == profile_id
        assert NpcCharacter.objects.get(definition__npc_id=profile_id).voice_profile == profile
    assert NpcCharacter.objects.get(definition__npc_id="snowball").voice_profile is None


def test_an_existing_voice_profile_is_reused_untouched(ready):
    VoiceProfile.objects.create(
        profile_id="tinker", display_name="Staff Tinker", polly_voice_id="Ivy", enabled=True
    )
    run()
    profile = VoiceProfile.objects.get(profile_id="tinker")
    assert (profile.display_name, profile.polly_voice_id) == ("Staff Tinker", "Ivy")
    assert NpcCharacter.objects.get(definition__npc_id="tinker").voice_profile == profile


# --- status, publishing ---------------------------------------------------------------------


def test_draft_until_the_model_is_live_then_promote():
    catalog_npcs()
    model_assets(live=False)
    area()
    out = run()
    assert "is DRAFT" in out and "Validation: skipped" in out
    assert "Publish: skipped" in run("--publish")
    assert set(NpcCharacter.objects.values_list("status", flat=True)) == {CharacterStatus.DRAFT}
    ContentAsset.objects.filter(asset_id__startswith="north-pole-").update(
        bundled_path="/models/x.glb"
    )
    assert "Promote:" in run("--promote")
    assert set(NpcCharacter.objects.values_list("status", flat=True)) == {CharacterStatus.READY}


def test_publish_carries_the_ten_characters_and_a_rerun_is_unchanged(ready):
    assert "NPC release 1 is ACTIVE" in run("--publish")
    assert "Publish: unchanged" in run("--publish")
    snapshot = active_release().snapshot
    assert set(snapshot["characters"]) == EXPECTED_NPCS
    assert {p["placementKey"] for p in snapshot["placements"]} == PLACEMENTS
    for npc in np.NPCS:
        character = snapshot["characters"][npc.npc_id]
        variant = character["variants"][0]
        assert variant["model"]["assetId"] == npc.asset_id
        assert set(variant["animationMap"]) <= set(ANIMATION_STATES)
        assert character["voiceProfile"] == (npc.npc_id if npc.voice else None)
        assert len(character["persona"]["fallbackLines"]) >= 3
        assert character["ageBands"] == list(BANDS)


def test_publish_then_speech_pregenerates_with_the_fake_provider_only(ready, settings):
    from apps.npcs.speech import pregenerate_release_speech
    from apps.speech.polly import FakePollyClient, set_polly_client
    from apps.speech.storage import reset_speech_storage_cache

    settings.LAI_SPEECH_PROVIDER = "fake"
    set_polly_client(None)
    reset_speech_storage_cache()
    try:
        run("--publish")
        fake = FakePollyClient()
        report = pregenerate_release_speech(active_release(), client=fake)
        assert report.synthesized > 0 and report.failed == 0
        assert {call["voice_id"] for call in fake.calls} == set(VOICES.values())
    finally:
        set_polly_client(None)
        reset_speech_storage_cache()


# --- quests -----------------------------------------------------------------------------------


def test_offer_quest_values_are_the_contract_quest_ids(ready):
    run()
    offers = {
        (c.node.dialogue.character.slug, c.action_value)
        for c in NpcDialogueChoice.objects.filter(action="OFFER_QUEST")
    }
    assert offers == OFFERS
    assert set(np.QUEST_OFFERS) == OFFERS
    assert {q for _n, q in OFFERS} == set(np.QUESTS.values())
    # Every offer is conditioned on the quest being not started and (but Q01) its prerequisite.
    for dialogue in NpcDialogue.objects.filter(dialogue_key__startswith="offer-"):
        kinds = [c["type"] for c in dialogue.conditions]
        assert "QUEST_STATUS" in kinds and "AGE_BAND" in kinds
    prerequisites = {
        d.dialogue_key.rsplit("-", 1)[0]: [
            c["key"] for c in d.conditions if c["type"] == "WORLD_CHANGE"
        ]
        for d in NpcDialogue.objects.filter(dialogue_key__startswith="offer-")
    }
    assert prerequisites["offer-np-q01-welcome"] == []
    assert prerequisites["offer-np-q02-toy-workshop"] == ["NORTH_POLE_WELCOME_LOOKED"]
    assert prerequisites["offer-np-q09-christmas-eve"] == ["NORTH_POLE_STAR_RESTORED"]
    assert prerequisites["offer-np-q07-snowflake-mountain"] == ["NORTH_POLE_GINGER_REPAIRED"]


# --- Snowball ---------------------------------------------------------------------------------


def test_snowball_escort_placements_and_conditions(ready):
    run()
    lost = NpcPlacement.objects.get(placement_key="np-snowball-lost")
    follow = NpcPlacement.objects.get(placement_key="np-snowball-follow")
    home = NpcPlacement.objects.get(placement_key="np-snowball-home")
    assert lost.spawn_conditions == [
        {"type": "WORLD_CHANGE", "key": "NORTH_POLE_SNOWBALL_FOUND", "present": False}
    ]
    assert follow.spawn_conditions == [
        {"type": "WORLD_CHANGE", "key": "NORTH_POLE_SNOWBALL_FOUND", "present": True},
        {"type": "WORLD_CHANGE", "key": "NORTH_POLE_SNOWBALL_HOME", "present": False},
    ]
    assert home.spawn_conditions == [
        {"type": "WORLD_CHANGE", "key": "NORTH_POLE_SNOWBALL_HOME", "present": True}
    ]
    assert lost.behavior.behavior_type == "stationary"
    assert follow.behavior.behavior_type == "follow"
    assert follow.behavior.parameters["stopDistance"] == 2
    assert follow.behavior.parameters["speed"] == 3
    assert follow.behavior.parameters["giveUpDistance"] == 40
    assert follow.behavior.parameters["boundsRadius"] >= 60
    assert home.behavior.behavior_type == "stationary"
    # Lost and following start in Pine Hollow (the Area's np-snowball); the stable is a fallback.
    assert (lost.x, lost.z) == (follow.x, follow.z) == (50.0, -40.0)
    assert (home.x, home.z) == np.SNOWBALL_STABLE_FALLBACK
    assert {p.character.slug for p in (lost, follow, home)} == {"snowball"}
    character = lost.character
    assert character.role == "COMPANION"
    assert character.variants.get().model_asset.category == "creature"


def test_snowball_uses_the_stable_placement_when_the_layout_has_one(ready):
    from apps.regions.models import PlacementKind, WorldObjectPlacement

    WorldObjectPlacement.objects.create(
        region=area_region(),
        kind=PlacementKind.NPC,
        entity_id="np-snowball-stable",
        npc=NpcDefinition.objects.get(npc_id="snowball"),
        x=40.0,
        z=14.0,
    )
    run()
    home = NpcPlacement.objects.get(placement_key="np-snowball-home")
    assert (home.x, home.z) == (40.0, 14.0)


def area_region():
    from apps.regions.models import WorldRegion

    return WorldRegion.objects.get(region_id=np.REGION_ID)


def test_snowball_has_a_dialogue_for_each_escort_state(ready):
    run()
    by_key = {
        d.dialogue_key: d
        for d in NpcDialogue.objects.filter(character__definition__npc_id="snowball")
    }
    assert {"snowball-lost", "snowball-following", "snowball-home"} <= set(by_key)
    assert by_key["snowball-lost"].conditions[0]["present"] is False
    assert not any(d.nodes.filter(allow_ai_hint=True).exists() for d in by_key.values())


# --- dialogue ---------------------------------------------------------------------------------


def test_dialogue_validates_and_only_hint_nodes_allow_ai(ready):
    run()
    assert preview().problems == []
    for node in NpcDialogueNode.objects.filter(allow_ai_hint=True):
        assert node.node_key == "hint"
        assert node.dialogue.trigger == "on_incorrect_answer"
        persona = node.dialogue.character.personas.get()
        assert node.allowed_topic in persona.permitted_topics
        assert node.dialogue.character.dialogue_mode == "HYBRID"
        assert node.text  # the authored fallback
    hybrid = {n.npc_id for n in np.NPCS if n.ai_mode == "HYBRID"}
    assert {
        n.dialogue.character.slug for n in NpcDialogueNode.objects.filter(allow_ai_hint=True)
    } == hybrid
    assert not hybrid & {"santa-claus", "snowball"}


def test_conditions_use_the_contract_world_change_keys(ready):
    run()
    keys = {
        c["key"]
        for dialogue in NpcDialogue.objects.all()
        for c in dialogue.conditions
        if c["type"] == "WORLD_CHANGE"
    }
    assert keys
    assert all(re.fullmatch(r"NORTH_POLE_[A-Z_0-9]+", key) for key in keys)
    thanks = {
        d.character.slug: d.conditions[0]["key"]
        for d in NpcDialogue.objects.filter(dialogue_key="thanks")
    }
    assert thanks["tinker"] == "NORTH_POLE_WORKSHOP_RESTORED"
    assert thanks["peppermint"] == "NORTH_POLE_FOREST_DONE"
    assert thanks["frosty"] == "NORTH_POLE_LAKE_DONE"
    assert thanks["noel"] == "NORTH_POLE_SNOWBALL_HOME"
    assert thanks["ginger"] == "NORTH_POLE_GINGER_REPAIRED"
    assert thanks["polaris"] == "NORTH_POLE_STAR_RESTORED"
    assert thanks["santa-claus"] == "NORTH_POLE_CHRISTMAS_EVE"
    assert all(d.priority == 50 for d in NpcDialogue.objects.filter(dialogue_key="thanks"))


def test_behaviours_are_idle_wander_or_follow(ready):
    run()
    types = {p.placement_key: p.behavior.behavior_type for p in NpcPlacement.objects.all()}
    assert types["np-santa"] == types["np-noel"] == types["np-polaris"] == "stationary"
    for key in ("np-tinker", "np-peppermint", "np-frosty", "np-ginger"):
        assert types[key] == "wander"
        radius = NpcPlacement.objects.get(placement_key=key).behavior.parameters["radius"]
        assert radius <= 3  # stays inside the interaction radius
    assert types["np-snowball-follow"] == "follow"


def test_every_age_band_is_covered_with_a_greeting_and_a_hint(ready):
    run()
    for npc in np.NPCS:
        if npc.npc_id == "snowball":
            continue
        keys = set(
            NpcDialogue.objects.filter(character__definition__npc_id=npc.npc_id).values_list(
                "dialogue_key", flat=True
            )
        )
        for band in BANDS:
            assert f"greeting-{band.lower()}" in keys
            assert f"hint-{band.lower()}" in keys
        assert {"welcome-back", "fallback", "thanks"} <= keys
    greetings = NpcDialogue.objects.filter(dialogue_key__startswith="greeting-")
    for dialogue in greetings:
        assert dialogue.conditions[0]["type"] == "AGE_BAND"
    # Sprouts read less: the Sprout greeting is never longer than the Explorer one.
    for npc in np.NPCS:
        if npc.npc_id != "snowball":
            assert len(npc.greet[0]) <= len(npc.greet[2])


# --- safety -----------------------------------------------------------------------------------


def all_copy() -> list[str]:
    texts: list[str] = []
    for npc in np.NPCS:
        texts += [npc.persona_prompt, *npc.fallback_lines]
        for dialogue in np.dialogues(npc):
            for node in dialogue.nodes:
                texts.append(node.text)
                texts += [c.label for c in node.choices]
    return texts


def test_copy_is_child_safe():
    for text in all_copy():
        assert "—" not in text and "–" not in text
        assert text.strip()
    spoken = " ".join(node.text for npc in np.NPCS for d in np.dialogues(npc) for node in d.nodes)
    banned = (
        r"\b(your name|your age|how old|where do you live|your address|your school|your phone"
        r"|your photo|secret|don't tell|do not tell|i am (a )?(real )?(human|person|boy|girl)"
        r"|i'm (a )?(real )?(human|person)|i am alive|i am lonely|i miss you)\b"
    )
    assert not re.search(banned, spoken, re.I)
    for npc in np.NPCS:
        assert "never a person" in npc.persona_prompt
        assert "Never ask for private" in npc.persona_prompt
        assert "Never ask for secrets" in npc.persona_prompt


def test_text_limits_and_closed_vocabularies():
    for npc in np.NPCS:
        assert len(npc.persona_prompt) <= 1500
        assert 3 <= len(npc.fallback_lines) <= 10
        assert all(len(line) <= 120 for line in npc.fallback_lines)  # the Sprout AI limit
        assert 40 <= npc.max_response_chars <= 120
        assert npc.persona_topics
        for dialogue in np.dialogues(npc):
            for node in dialogue.nodes:
                assert len(node.text) <= 400
                assert node.emotion in Emotion.values
                assert node.animation == "" or node.animation in ANIMATION_STATES
                for choice in node.choices:
                    assert len(choice.label) <= 80
    assert {n.npc_id for n in np.NPCS} == EXPECTED_NPCS
    assert {n.asset_id for n in np.NPCS} == ASSET_IDS


def test_science_and_story_framing():
    by_id = {n.npc_id: n for n in np.NPCS}
    assert "Real reindeer" in " ".join(by_id["noel"].greet)
    assert "Real ice" in " ".join(by_id["frosty"].greet)
    assert "Real stars" in " ".join(by_id["polaris"].greet)
    assert "island magic" in by_id["polaris"].greet[2]
    assert "never a snowman" in by_id["frosty"].persona_prompt
    assert "snowman" not in " ".join(all_copy()).replace("never a snowman", "").lower()


def test_no_node_lacks_a_reachable_start_for_any_band(ready):
    run()
    assert [p for p in preview().problems if "no start line" in p] == []
