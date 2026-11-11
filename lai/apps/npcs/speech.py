"""NPC voice (LAI-NPC-026 to 028, ADR-049, ADR-053 section 8). Owner: Workstream E.

Two jobs, both on top of the existing speech app (no second Polly client, no second cache):

- `published_node(...)` reads one authored dialogue node from the named ACTIVE release snapshot
  for the speech reference kind `npcDialogueNode` (contract 5.4). Draft rows are never read; a
  retired, superseded or unknown release, character, dialogue or node is simply not found.
- `pregenerate_release_speech(release, client=None)` synthesizes every spoken node of every voiced
  character in a release into the shared (non-child) speech cache, so the first child to hear a
  line does not wait for Polly. Already-cached clips are skipped (cache key over text, voice,
  engine, language and rate), so re-running after an unchanged publish makes no Polly call.
  It never raises: failures are counted and logged by key, never with text.

Publishing (foundation-owned) does not call this yet. The integrator hooks it after a publish
with `schedule_pregeneration(release)` (runs on commit), or staff run
`manage.py npc_pregenerate_speech`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from django.db import DatabaseError, transaction

from apps.speech import services as speech
from apps.speech.models import ClipScope, VoiceProfile
from apps.speech.polly import PollyClient, SpeechError

from . import published
from .models import NpcRelease
from .vocabulary import ReleaseStatus

logger = logging.getLogger("lai.npcs.speech")


@dataclass(frozen=True)
class PublishedNode:
    npc_id: str
    release: int
    dialogue_key: str
    node_key: str
    text: str
    voice_profile: str
    #: Age bands that must all admit the child (character, dialogue, node); empty = every band.
    age_bands: tuple[tuple[str, ...], ...]

    def admits(self, age_band: str) -> bool:
        return all(not bands or age_band in bands for bands in self.age_bands)

    @property
    def label(self) -> str:
        """A log-safe reference: keys only, never text."""
        return f"npcDialogueNode:{self.npc_id}:{self.release}:{self.dialogue_key}:{self.node_key}"


def _nodes(snapshot: dict, release_number: int, npc_id: str | None = None):
    """Every spoken node of every voiced character in a snapshot (or one character's)."""
    characters = snapshot.get("characters") or {}
    for character_id, character in sorted(characters.items()):
        if npc_id is not None and character_id != npc_id:
            continue
        profile_id = character.get("voiceProfile")
        if not profile_id:
            continue
        for dialogue in character.get("dialogues") or []:
            for node in dialogue.get("nodes") or []:
                text = node.get("text") or ""
                if not text.strip():
                    continue
                yield (
                    node,
                    PublishedNode(
                        npc_id=character_id,
                        release=release_number,
                        dialogue_key=dialogue.get("dialogueKey", ""),
                        node_key=node.get("nodeKey", ""),
                        text=text,
                        voice_profile=profile_id,
                        age_bands=(
                            tuple(character.get("ageBands") or ()),
                            tuple(dialogue.get("ageBands") or ()),
                            tuple(node.get("ageBands") or ()),
                        ),
                    ),
                )


def published_node(
    npc_id: str, release: int, dialogue_key: str, node_key: str
) -> PublishedNode | None:
    """The node a speech reference names, from the ACTIVE release only; None when not served."""
    try:
        active = published.current()
    except published.NoActiveRelease:
        return None
    if active.number != release:
        return None  # a superseded, retired or unknown release is never spoken to a child
    for _node, found in _nodes(active.snapshot, active.number, npc_id):
        if found.dialogue_key == dialogue_key and found.node_key == node_key:
            return found
    return None


# --- pre-generation -------------------------------------------------------------------------------


@dataclass
class PregenerationReport:
    release: int
    enabled: bool = True
    synthesized: int = 0
    cached: int = 0
    recorded: int = 0  # nodes with a recorded audio asset: nothing to synthesize
    skipped: int = 0  # unusable voice profile or text the output rules refuse
    failed: int = 0
    characters_synthesized: int = 0
    stopped: str = ""  # why it stopped early (speech off, daily cap), or ""
    problems: list[str] = field(default_factory=list)  # keys and codes only, never text

    def as_dict(self) -> dict:
        return {
            "release": self.release,
            "enabled": self.enabled,
            "synthesized": self.synthesized,
            "cached": self.cached,
            "recorded": self.recorded,
            "skipped": self.skipped,
            "failed": self.failed,
            "charactersSynthesized": self.characters_synthesized,
            "stopped": self.stopped,
            "problems": list(self.problems),
        }


def pregenerate_release_speech(
    release: NpcRelease, client: PollyClient | None = None
) -> PregenerationReport:
    """Fill the shared speech cache for a release. Never raises; see the module docstring."""
    report = PregenerationReport(release=release.number)
    try:
        _pregenerate(release, client, report)
    except Exception:  # noqa: BLE001 - must never break a publish; logged without text
        logger.exception("npc speech pre-generation stopped (release %s)", release.number)
        report.stopped = report.stopped or "error"
    return report


def _pregenerate(release: NpcRelease, client: PollyClient | None, report: PregenerationReport):
    if not speech.speech_enabled():
        report.enabled = False
        report.stopped = "speech_disabled"
        return
    if release.status == ReleaseStatus.RETIRED:
        report.stopped = "release_retired"
        return
    profiles: dict[str, VoiceProfile | None] = {}
    for node, found in _nodes(release.snapshot, release.number):
        if node.get("audio"):
            report.recorded += 1
            continue
        if found.voice_profile not in profiles:
            profiles[found.voice_profile] = VoiceProfile.objects.filter(
                profile_id=found.voice_profile, enabled=True
            ).first()
        profile = profiles[found.voice_profile]
        if profile is None:
            report.skipped += 1
            report.problems.append(f"{found.label}: voice profile unavailable")
            continue
        if speech.text_problem(found.text):
            report.skipped += 1
            report.problems.append(f"{found.label}: refused by the output rules")
            continue
        resolved = speech.Resolved(found.text, profile, ClipScope.AUTHORED, found.label)
        try:
            synthesized = speech.prepare_shared_clip(resolved, client=client)
        except SpeechError as error:
            if error.code == "daily_cap":
                report.stopped = "daily_cap"
                return
            report.failed += 1
            report.problems.append(f"{found.label}: {error.code}")
            logger.warning("npc speech pre-generation failed: %s (%s)", found.label, error.code)
            continue
        except DatabaseError:
            report.failed += 1
            report.problems.append(f"{found.label}: database")
            logger.exception("npc speech pre-generation failed: %s", found.label)
            continue
        if synthesized:
            report.synthesized += 1
            report.characters_synthesized += len(found.text)
        else:
            report.cached += 1


def schedule_pregeneration(release: NpcRelease) -> None:
    """Pre-generate after the surrounding transaction commits (call it right after a publish).

    A failure can never undo or block the publish: it runs after commit and never raises.
    """
    transaction.on_commit(lambda: pregenerate_release_speech(release))
