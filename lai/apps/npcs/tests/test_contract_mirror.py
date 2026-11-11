"""The TypeScript vocabulary mirrors the Python one exactly (contract v1)."""

import re
from pathlib import Path

from apps.npcs import vocabulary as v

TS = Path(__file__).resolve().parents[4] / "react/src/features/npc-manager/contracts/vocabulary.ts"


def _ts_list(name: str) -> list[str]:
    source = TS.read_text()
    match = re.search(rf"export const {name} = \[(.*?)\] as const;", source, re.S)
    assert match, f"{name} not found in {TS}"
    return re.findall(r"'([^']+)'", match.group(1))


def test_vocabularies_match():
    pairs = {
        "NPC_ROLES": v.NpcRole.values,
        "DIALOGUE_MODES": v.DialogueMode.values,
        "ANIMATION_STATES": list(v.ANIMATION_STATES),
        "TRIGGERS": list(v.TRIGGERS),
        "ADVENTURE_EVENTS": list(v.ADVENTURE_EVENTS),
        "DIALOGUE_EVENTS": list(v.DIALOGUE_EVENTS),
        "EMOTIONS": v.Emotion.values,
        "CHOICE_ACTIONS": v.ChoiceAction.values,
        "BEHAVIOR_TYPES": v.BehaviorType.values,
        "VARIANT_ASSET_ROLES": v.VariantAssetRole.values,
        "ERROR_CODES": list(v.ERROR_CODES),
    }
    for name, python in pairs.items():
        assert _ts_list(name) == list(python), name


def test_contract_version_matches():
    assert f"export const CONTRACT_VERSION = {v.CONTRACT_VERSION};" in TS.read_text()


def test_fallbacks_match():
    source = TS.read_text()
    block = re.search(r"ANIMATION_FALLBACKS[^=]*= \{(.*?)\};", source, re.S).group(1)
    ts = {
        state: re.findall(r"'([^']+)'", items)
        for state, items in re.findall(r"(\w+): \[(.*?)\]", block)
    }
    assert ts == {state: list(chain) for state, chain in v.ANIMATION_FALLBACKS.items()}
