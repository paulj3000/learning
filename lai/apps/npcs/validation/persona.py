"""Release validation: persona (workstream F, LAI-NPC-031).

Called by `apps.npcs.validation.release_problems` with the built snapshot; returns problems in
words staff can act on, never raises, never queries child data. The Django Admin persona form
runs the same rules (`persona_problems`) so staff see them at save time.

Per character:
- HYBRID or AI dialogue needs an APPROVED persona in the release.
- A node that allows an AI hint needs a HYBRID or AI character and an `allowedTopic` that is one
  of the persona's permitted topics (the topic list is closed).

Per persona:
- `personalityPrompt`: trusted staff text, but still bounded. Not empty, at most 1500 characters,
  no web address, and it must not tell the model to claim to be human, to ask for personal
  information, to keep secrets, to grant rewards, or to drop its rules.
- `permittedTopics`: a non-empty, closed list of short, distinct topics.
- `ageBands`: known bands, each once, and within the character's bands.
- `maxResponseChars`: 40 to 400 and no more than the AI limit of every band the persona serves
  (`apps.ai.limits.MAX_SPOKEN_LENGTH_BY_AGE_BAND`); the hint route also clamps per band.
- `fallbackLines`: at least one, at most 10; each is child copy: not empty, within the same
  length, readable aloud (no markup, symbols or emoji), no em dash, no web address, and nothing
  the AI output rules would refuse.
"""

from __future__ import annotations

import re

from apps.ai.content_safety import (
    boundary_violations,
    contains_url,
    requests_personal_information,
)
from apps.ai.jscompat import js_regex
from apps.ai.limits import MAX_SPOKEN_LENGTH_BY_AGE_BAND
from apps.ai.services.safety import _MASTERY_OR_REWARD, _PROMPT_INJECTION, _SECRECY
from apps.users.models import AgeBand

from ..vocabulary import DialogueMode

EM_DASH = "—"
MAX_PROMPT_CHARS = 1500
MAX_TOPICS = 20
MAX_TOPIC_CHARS = 80
MAX_FALLBACK_LINES = 10
MIN_RESPONSE_CHARS = 40
MAX_RESPONSE_CHARS = 400
HINT_MODES = (DialogueMode.HYBRID, DialogueMode.AI)

# A persona telling the model to pass as a person ("you are a real person", "say you're human").
_CLAIMS_HUMAN = js_regex(
    r"\b(you are|you're|act as|acting as|pretend(ing)? (to be|you are|you're)|say (that )?"
    r"(you are|you're)|claim(ing)? to be|tell (them|the child|children|kids) (that )?"
    r"(you are|you're))\b[^.!?]{0,30}\b(human|a person|a real person|a living|alive|conscious"
    r"|a (real )?(boy|girl|man|woman|kid|child|grown-?up))\b"
    r"|\bnot (an? )?(ai|robot|computer|character)\b"
)
# A persona telling the model to ask for personal information.
_ASKS_PERSONAL = js_regex(
    r"\b(ask|asks|asking|find out|learn|collect|request|get)\b[^.!?]{0,40}\b(their|the child'?s"
    r"|children'?s|kids'?|your|his|her) (full |real |last |home |school )?(name|address|phone"
    r"|school|birthday|age|location|photo|picture|password|email|parents?)\b"
    r"|\bwhere (they|the child|you) li(ve|ves)\b"
)
# Readable aloud: no markup, code or decoration characters.
_NOT_READABLE = re.compile(r"[<>{}\[\]*_#|`~^\\@=+]")
_EMOJI_OR_CONTROL = re.compile(r"[\u0000-\u0008\u000b-\u001f\u007f←-⯿\U0001f000-\U0010ffff]")
_LETTER = re.compile(r"[^\W\d_]")


def problems(snapshot: dict) -> list[str]:
    found: list[str] = []
    for npc_id, character in (snapshot.get("characters") or {}).items():
        found.extend(character_problems(npc_id, character))
    return found


def character_problems(npc_id: str, character: dict) -> list[str]:
    found: list[str] = []
    persona = character.get("persona")
    mode = character.get("dialogueMode")
    if mode in HINT_MODES and not isinstance(persona, dict):
        found.append(
            f"{npc_id} uses {mode} dialogue but has no approved persona; approve one or set the "
            "dialogue mode to AUTHORED"
        )
    if isinstance(persona, dict):
        found.extend(
            persona_problems(persona, character.get("ageBands") or [], f"{npc_id} persona")
        )
    topics = {t.strip().lower() for t in _topics(persona)}
    for dialogue in character.get("dialogues") or []:
        for node in dialogue.get("nodes") or []:
            if not node.get("allowAiHint"):
                continue
            at = f"{npc_id} dialogue {dialogue.get('dialogueKey')} node {node.get('nodeKey')}"
            topic = (node.get("allowedTopic") or "").strip()
            if mode not in HINT_MODES:
                found.append(
                    f"{at} allows an AI hint but the character's dialogue mode is {mode}; use "
                    "HYBRID or AI, or turn the hint off"
                )
            if not topic:
                found.append(f"{at} allows an AI hint but has no allowed topic")
            elif isinstance(persona, dict) and topic.lower() not in topics:
                found.append(
                    f"{at} allowed topic {topic!r} is not one of the persona's permitted topics"
                )
    return found


def _topics(persona) -> list[str]:
    if not isinstance(persona, dict):
        return []
    topics = persona.get("permittedTopics")
    return [t for t in topics if isinstance(t, str)] if isinstance(topics, list) else []


def served_bands(persona_bands: list[str], character_bands: list[str]) -> list[str]:
    """The bands a persona speaks to: its own, else the character's, else every band."""
    return list(persona_bands or character_bands or AgeBand.values)


def length_limit(persona_bands: list[str], character_bands: list[str]) -> int:
    """The AI length limit of the youngest band served (the tightest limit)."""
    bands = [b for b in served_bands(persona_bands, character_bands) if b in AgeBand.values]
    return min(MAX_SPOKEN_LENGTH_BY_AGE_BAND[b] for b in bands or AgeBand.values)


def persona_problems(persona: dict, character_bands: list[str], where: str) -> list[str]:
    found: list[str] = []
    found.extend(_prompt_problems(persona.get("personalityPrompt"), where))
    found.extend(_topic_problems(persona.get("permittedTopics"), where))

    bands = persona.get("ageBands") or []
    if not isinstance(bands, list) or any(b not in AgeBand.values for b in bands):
        found.append(f"{where} has an unknown age band")
        bands = []
    elif len(set(bands)) != len(bands):
        found.append(f"{where} lists an age band twice")
    elif character_bands and set(bands) - set(character_bands):
        found.append(f"{where} serves age bands the character does not appear for")
    limit = length_limit(bands, character_bands)

    max_chars = persona.get("maxResponseChars")
    if not isinstance(max_chars, int) or not (
        MIN_RESPONSE_CHARS <= max_chars <= MAX_RESPONSE_CHARS
    ):
        found.append(
            f"{where} maximum response length must be {MIN_RESPONSE_CHARS} to "
            f"{MAX_RESPONSE_CHARS} characters"
        )
    elif max_chars > limit:
        found.append(
            f"{where} maximum response length {max_chars} is over the AI limit of {limit} "
            "characters for the youngest age band it serves"
        )

    found.extend(_fallback_problems(persona.get("fallbackLines"), where, limit))
    return found


def _prompt_problems(prompt: object, where: str) -> list[str]:
    if not isinstance(prompt, str) or not prompt.strip():
        return [f"{where} personality prompt is empty"]
    found = []
    if len(prompt) > MAX_PROMPT_CHARS:
        found.append(f"{where} personality prompt is longer than {MAX_PROMPT_CHARS} characters")
    if contains_url(prompt):
        found.append(f"{where} personality prompt contains a web address")
    if _CLAIMS_HUMAN.search(prompt) or "claims-humanity" in boundary_violations(prompt):
        found.append(f"{where} personality prompt asks the character to claim to be human")
    if _ASKS_PERSONAL.search(prompt):
        found.append(f"{where} personality prompt asks the character to get personal information")
    if _SECRECY.search(prompt) or "secrecy" in boundary_violations(prompt):
        found.append(f"{where} personality prompt mentions secrets or special friendship")
    if _MASTERY_OR_REWARD.search(prompt):
        found.append(f"{where} personality prompt talks about granting rewards or unlocks")
    if _PROMPT_INJECTION.search(prompt):
        found.append(f"{where} personality prompt tries to change the safety rules")
    return found


def _topic_problems(topics: object, where: str) -> list[str]:
    if not isinstance(topics, list) or not topics:
        return [f"{where} needs at least one permitted topic"]
    found = []
    if len(topics) > MAX_TOPICS:
        found.append(f"{where} has more than {MAX_TOPICS} permitted topics")
    clean = []
    for topic in topics:
        if not isinstance(topic, str) or not topic.strip():
            found.append(f"{where} has an empty permitted topic")
        elif len(topic) > MAX_TOPIC_CHARS or contains_url(topic):
            found.append(f"{where} permitted topic {topic[:40]!r} is too long or has a web address")
        else:
            clean.append(topic.strip().lower())
    if len(set(clean)) != len(clean):
        found.append(f"{where} lists a permitted topic twice")
    return found


def line_problems(line: object, where: str, limit: int) -> list[str]:
    """Child copy rules for one authored line (also used by the admin form)."""
    if not isinstance(line, str) or not line.strip():
        return [f"{where} is empty"]
    found = []
    if len(line.strip()) > limit:
        found.append(f"{where} is longer than {limit} characters")
    if EM_DASH in line:
        found.append(f"{where} contains an em dash; use a comma or a full stop")
    if contains_url(line):
        found.append(f"{where} contains a web address")
    if _NOT_READABLE.search(line) or _EMOJI_OR_CONTROL.search(line) or not _LETTER.search(line):
        found.append(f"{where} is not readable aloud (no markup, symbols or emoji)")
    if requests_personal_information(line) or boundary_violations(line):
        found.append(f"{where} breaks a child safety rule")
    return found


def _fallback_problems(lines: object, where: str, limit: int) -> list[str]:
    if not isinstance(lines, list) or not lines:
        return [f"{where} needs at least one authored fallback line"]
    found = []
    if len(lines) > MAX_FALLBACK_LINES:
        found.append(f"{where} has more than {MAX_FALLBACK_LINES} fallback lines")
    for index, line in enumerate(lines, start=1):
        found.extend(line_problems(line, f"{where} fallback line {index}", limit))
    return found
