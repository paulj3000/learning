"""Discoveries on the server (SC-R04-00): the authoritative record that a child found a secret.

This is the Django form of the client's `recordDiscovery` (`react/src/features/discovery/api.ts`).
Until now Django had a `WorldState.discovered_objects` column and nothing that wrote it, so a
discovery made in Django mode lived only in the Amplify client's row, and the server could not
prove one. Everything that must be provable on the server (the Secret Chamber's access, and the
Great Storybook's page recovery) depends on this.

**No new model.** The record is `WorldState.discovered_objects` (already there, one row per
child). The definitions are the verified content export's `discoveries` collection, read with
`catalog.importer.read_export` (the same digest-checked bundle `load_content` uses), so there is
no second source of discovery content. A discovery's world change goes through the existing
idempotent `record_world_change`, and its rewards through the existing `grant_reward_rule`.

**Idempotent and concurrency-safe.** The child's `WorldState` row is locked for the whole write,
so of two simultaneous finds exactly one is `FOUND_NOW`, writes the world change, and fires the
reward rules. A replay changes nothing and grants nothing.

Only the requirement types the export's schema allows are evaluated (ALWAYS, WORLD_CHANGE_PRESENT,
ITEM_OWNED, DISCOVERY_PRESENT). An unknown type is treated as not met, so the server never opens
a secret it cannot prove.
"""

from dataclasses import dataclass, field
from functools import lru_cache

from django.db import transaction
from django.utils import timezone

from apps.catalog.importer import read_export
from apps.catalog.models import RewardRule
from apps.inventory.services import grant_reward_rule, owned_item_ids
from apps.progression.models import WorldState
from apps.progression.services import record_world_change, world_change_keys

FOUND_NOW = "FOUND_NOW"
ALREADY_FOUND = "ALREADY_FOUND"
LOCKED = "LOCKED"

SOURCE_PREFIX = "discovery:"


class UnknownDiscovery(ValueError):
    """The id is not in the content export."""


@dataclass(frozen=True)
class DiscoveryOutcome:
    discovery_id: str
    status: str
    #: The authored line a child sees when it is locked; empty otherwise (the client has the
    #: reveal copy, and the server never repeats authored copy it does not need to).
    locked_message: str = ""
    reward_messages: tuple[str, ...] = field(default=())
    new_item_ids: tuple[str, ...] = field(default=())


@lru_cache(maxsize=1)
def definitions() -> dict[str, dict]:
    """Discovery id -> definition, from the digest-verified content export (read once)."""
    return {d["id"]: d for d in read_export().collections["discoveries"]}


def discovery_ids() -> tuple[str, ...]:
    return tuple(definitions())


def _met(requirement: dict, *, changes: set[str], items: set[str], found: set[str]) -> bool:
    kind = requirement.get("type")
    if kind == "ALWAYS":
        return True
    if kind == "WORLD_CHANGE_PRESENT":
        return requirement.get("changeKey") in changes
    if kind == "ITEM_OWNED":
        return requirement.get("itemId") in items
    if kind == "DISCOVERY_PRESENT":
        return requirement.get("discoveryId") in found
    return False  # a type the server cannot prove is never treated as met


def discovered_ids(child) -> list[str]:
    """The discovery ids this child has found, in the content's own order.

    Ids the export does not know are left out, so a stale row can never name something that is
    not a discovery.
    """
    state = WorldState.objects.for_child(child).first()
    found = set(state.discovered_objects) if state else set()
    return [d for d in discovery_ids() if d in found]


def record_discovery(child, discovery_id: str, *, now=None) -> DiscoveryOutcome:
    """Record that `child` found `discovery_id`, if they may. Raises `UnknownDiscovery`."""
    definition = definitions().get(discovery_id)
    if definition is None:
        raise UnknownDiscovery(discovery_id)
    now = now or timezone.now()
    with transaction.atomic():
        # `get_or_create` is the race-safe way to make the one row; the lock below serialises
        # every later write to it.
        WorldState.objects.get_or_create(child=child, defaults={"updated_at": now})
        state = WorldState.objects.select_for_update().get(child=child)
        found = set(state.discovered_objects)
        if discovery_id in found:
            return DiscoveryOutcome(discovery_id, ALREADY_FOUND)
        met = all(
            _met(
                requirement,
                changes=world_change_keys(child),
                items=owned_item_ids(child),
                found=found,
            )
            for requirement in definition.get("requirements", [])
        )
        if not met:
            return DiscoveryOutcome(
                discovery_id, LOCKED, locked_message=definition.get("lockedMessage", "")
            )

        # 1. The record that makes it found. Everything below is a consequence of it.
        state.discovered_objects = [*state.discovered_objects, discovery_id]
        state.updated_at = now
        state.save(update_fields=["discovered_objects", "updated_at"])

        # 2. What the island shows.
        change = definition.get("worldChange")
        if change:
            record_world_change(
                child,
                location_slug=change["locationSlug"],
                change_type=change["changeType"],
                change_key=change["changeKey"],
                source_session_id=f"{SOURCE_PREFIX}{discovery_id}",
                now=now,
            )

        # 3. What finding it owes, through the existing reward service: one fire per rule.
        messages: list[str] = []
        new_items: list[str] = []
        rules = RewardRule.objects.filter(
            trigger__type="DISCOVERY", trigger__discoveryKey=discovery_id
        ).order_by("rule_id")
        for rule in rules:
            grant = grant_reward_rule(child, rule)
            if grant.granted:
                if rule.message:
                    messages.append(rule.message)
                new_items.extend(grant.new_item_ids)
        return DiscoveryOutcome(
            discovery_id,
            FOUND_NOW,
            reward_messages=tuple(messages),
            new_item_ids=tuple(new_items),
        )
