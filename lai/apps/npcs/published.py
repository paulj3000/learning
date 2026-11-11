"""Read access to the ACTIVE release: the only NPC content children are ever served (ADR-053).

Shared by the runtime API (workstream B), dialogue (C), speech (E) and AI (F). Never reads draft
rows. The parsed release is cached per process by release id and content hash, so a publish,
rollback or retirement is seen on the next request without a per-request JSON parse.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass

from .models import NpcRelease
from .vocabulary import ReleaseStatus

#: Dialogue trees are served node by node through the interaction API, never whole.
SERVER_ONLY_CHARACTER_KEYS = ("persona", "dialogues")

_cache_lock = threading.Lock()
_cache: dict[str, PublishedRelease] = {}


class NoActiveRelease(LookupError):
    code = "no_active_release"


class NpcNotPublished(LookupError):
    code = "npc_not_found"


@dataclass(frozen=True)
class PublishedRelease:
    number: int
    content_hash: str
    snapshot: dict

    @property
    def characters(self) -> dict[str, dict]:
        return self.snapshot["characters"]

    def character(self, npc_id: str) -> dict:
        try:
            return self.characters[npc_id]
        except KeyError:
            raise NpcNotPublished(npc_id) from None

    def placements(self, *, place: str | None = None, area: str | None = None) -> list[dict]:
        """Placements in one Place (any area or none) or one 3D Area."""
        result = self.snapshot["placements"]
        if place is not None:
            result = [p for p in result if p["place"] == place]
        if area is not None:
            result = [p for p in result if p["area"] == area]
        return result

    def behavior(self, key: str | None) -> dict | None:
        return self.snapshot["behaviors"].get(key) if key else None

    def dialogue(self, npc_id: str, dialogue_key: str) -> dict | None:
        for dialogue in self.character(npc_id)["dialogues"]:
            if dialogue["dialogueKey"] == dialogue_key:
                return dialogue
        return None


def current() -> PublishedRelease:
    """The ACTIVE release, or `NoActiveRelease`."""
    row = (
        NpcRelease.objects.filter(status=ReleaseStatus.ACTIVE)
        .values("pk", "number", "content_hash")
        .first()
    )
    if row is None:
        raise NoActiveRelease
    key = f"{row['pk']}:{row['content_hash']}"
    with _cache_lock:
        cached = _cache.get(key)
    if cached is not None:
        return cached
    snapshot = NpcRelease.objects.values_list("snapshot", flat=True).get(pk=row["pk"])
    release = PublishedRelease(row["number"], row["content_hash"], snapshot)
    with _cache_lock:
        _cache.clear()  # only the active release is ever needed
        _cache[key] = release
    return release


def client_character(character: dict) -> dict:
    """A character as a client may see it: server-only keys removed."""
    return {k: v for k, v in character.items() if k not in SERVER_ONLY_CHARACTER_KEYS}


def eligible_for(character: dict, age_band: str) -> bool:
    bands = character.get("ageBands") or []
    return not bands or age_band in bands
