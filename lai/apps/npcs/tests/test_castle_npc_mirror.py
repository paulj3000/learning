"""The castle characters' Django lines and spots stay in step with the client (SC-R05).

Keeper Quill's and Professor Orion's NPC Manager dialogues carry lines from the client catalog
(`react/src/features/npc/content/islandNpcs.ts`) word for word, and Orion's and Ember's
placements stand where the castle region says (`storykeeperCastleRegion.ts`). Changing one side
alone fails here. No database: these read source files only.
"""

import math
import re
from pathlib import Path

import pytest

from apps.npcs import ember_content, orion_content, quill_content

REACT = Path(__file__).resolve().parents[4] / "react/src/features"
CATALOG = REACT / "npc/content/islandNpcs.ts"
REGION = REACT / "island-map/three/storykeeperCastleRegion.ts"
PLATFORMS = REACT / "island-map/three/runtime/manifests/castleRooms/castlePlatforms.ts"
EM_DASH = "—"


def _node_texts(npc_id: str) -> dict[str, str]:
    """`{node id: text}` for one NPC of the client catalog (single- or double-quoted strings)."""
    source = CATALOG.read_text()
    start = source.index(f"id: '{npc_id}',")
    following = re.search(r"\n  \{\n    id: '", source[start + 1 :])
    block = source[start : start + 1 + following.start()] if following else source[start:]
    found: dict[str, str] = {}
    pattern = re.compile(
        r"id: '(?P<id>[a-z0-9-]+)',(?:(?!\n      "
        r"\{).)*?\btext:\s*(?P<q>['\"])(?P<text>.*?)(?<!\\)(?P=q)",
        re.S,
    )
    for match in pattern.finditer(block):
        found[match["id"]] = match["text"].replace("\\'", "'").replace('\\"', '"')
    return found


def _spot(name: str) -> tuple[float, float]:
    match = re.search(
        rf"export const {name}: EntitySpot = \{{[^}}]*x: (-?[\d.]+), z: (-?[\d.]+) \}}",
        REGION.read_text(),
    )
    assert match, f"{name} not found in {REGION}"
    return float(match[1]), float(match[2])


@pytest.mark.parametrize(
    ("npc_id", "lines"),
    [
        (quill_content.NPC_ID, quill_content.LEGACY_LINES),
        (orion_content.NPC_ID, orion_content.LEGACY_LINES),
    ],
)
def test_django_lines_match_the_client_catalog_word_for_word(npc_id, lines):
    client = _node_texts(npc_id)
    for node_id, text in lines.items():
        assert node_id in client, f"{npc_id}: client node {node_id} is missing"
        assert client[node_id] == text, f"{npc_id}/{node_id} differs from the client"


def test_every_legacy_line_is_really_said_in_django():
    for content in (quill_content, orion_content):
        said = {node.text for dialogue in content.dialogues() for node in dialogue.nodes}
        for node_id, text in content.LEGACY_LINES.items():
            assert text in said, f"{content.NPC_ID}: {node_id} is not in any dialogue"


def test_quill_carries_the_storybook_premise_and_restored_lines():
    keys = {dialogue.key for dialogue in quill_content.dialogues()}
    assert {"the-damaged-book", "storybook-restored"} <= keys


def test_the_client_ember_greeting_is_unchanged():
    # Ember's castle lines are new and Django-only; her sanctuary greeting stays word for word.
    assert _node_texts("ember-dragon")["ember-greeting"] == (
        "You are the one who helped me. I remember. This sanctuary is yours to visit anytime."
    )


def test_orion_and_ember_stand_where_the_castle_region_says():
    assert _spot("PROFESSOR_ORION_SPOT") == pytest.approx(orion_content.SPOT[:2])
    assert _spot("EMBER_CASTLE_SPOT") == pytest.approx(ember_content.SPOT[:2])
    # Both face into their rooms: Orion the tower's middle, Ember the hall's.
    x, z, yaw = orion_content.SPOT
    assert yaw == pytest.approx(math.atan2(7.5 - x, 7.5 - z))
    x, z, yaw = ember_content.SPOT
    assert yaw == pytest.approx(math.atan2(-3 - x, 0 - z))


def test_orion_stands_clear_of_the_moved_star_stone():
    match = re.search(r"key: 's2', x: (-?[\d.]+), z: (-?[\d.]+)", PLATFORMS.read_text())
    assert match
    stone_x, stone_z = float(match[1]), float(match[2])
    x, z, _ = orion_content.SPOT
    # The stone is 0.8 m square; Orion's collider is 0.24 m half side; keep 0.15 m between.
    assert abs(x - stone_x) >= 0.4 + 0.24 + 0.15 or abs(z - stone_z) >= 0.4 + 0.24 + 0.15


def test_castle_copy_has_no_em_dash_and_fits():
    for content in (quill_content, orion_content, ember_content):
        for dialogue in content.dialogues():
            for node in dialogue.nodes:
                assert EM_DASH not in node.text and len(node.text) <= 400
                for choice in node.choices:
                    assert EM_DASH not in choice.label and len(choice.label) <= 80
