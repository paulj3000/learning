"""The React avatar catalogue mirrors Django's vocabulary exactly (LAI-JMP-01c)."""

import re
from pathlib import Path

from apps.avatars import vocabulary as v

REACT = Path(__file__).resolve().parents[4] / "react/src"
CATALOGUE = REACT / "features/island-map/three/playerAvatarCatalog.ts"
PROFILE = REACT / "features/child-profile/constants.ts"


def _ts_list(source: str, name: str) -> list[str]:
    match = re.search(rf"export const {name} = \[(.*?)\] as const;", source, re.S)
    assert match, f"{name} not found"
    return re.findall(r"'([^']+)'", match.group(1))


def test_states_slots_and_colour_roles_match():
    source = CATALOGUE.read_text()
    assert _ts_list(source, "PLAYER_ANIMATION_STATES") == list(v.PLAYER_ANIMATION_STATES)
    assert _ts_list(source, "ATTACHMENT_SLOTS") == list(v.ATTACHMENT_SLOTS)
    assert _ts_list(source, "COLOR_ROLES") == list(v.COLOR_ROLES)


def test_default_clip_names_match():
    source = CATALOGUE.read_text()
    block = re.search(r"PLAYER_DEFAULT_CLIPS[^=]*= \{(.*?)\};", source, re.S).group(1)
    ts = {
        state: re.findall(r"'([^']+)'", clips)
        for state, clips in re.findall(r"(\w+): \[([^\]]*)\]", block)
    }
    assert ts == {state: list(clips) for state, clips in v.DEFAULT_CLIPS.items()}


def test_avatar_keys_match_the_profile_choices():
    source = PROFILE.read_text()
    block = re.search(r"export const AVATAR_OPTIONS = \[(.*?)\] as const;", source, re.S).group(1)
    assert re.findall(r"value: '([A-Z]+)'", block) == list(v.AVATAR_KEYS)
