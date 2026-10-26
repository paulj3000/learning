"""Server-side discoveries (LAI-0605). The Django form of the client's `recordDiscovery`.

A child reaching a secret is reported by the client: the server cannot see where a child
stands, so being there is trusted (documented trust boundary). Everything else is decided here,
from server records, with the golden-vector port in `discovery_rules`:
- the discovery must be published;
- its requirements must hold (items owned, world changes, earlier discoveries);
- it is found once.

Finding it applies, in the client's order and in one transaction:
1. the discovery is recorded (`WorldState.discovered_objects`);
2. its authored world change;
3. its DISCOVERY rewards (LAI-0604);
4. its quest is started (if one is authored and available to this child), and active quests are
   refreshed, since a DISCOVER objective may now hold.

A locked or already-found secret writes nothing and grants nothing.
"""

from dataclasses import dataclass, field

from django.db import transaction
from django.utils import timezone

from apps.catalog.models import ContentRelease, DiscoveryDefinition, Quest
from apps.inventory import services as inventory
from apps.inventory.services import owned_item_ids
from apps.quests.services import QuestUnavailable, refresh_active_quests, start_quest

from . import discovery_rules
from .models import WorldState
from .services import record_world_change, world_change_keys


class DiscoveryNotVisible(Exception):
    """Unknown, inactive or not in the latest content release: a 404."""


@dataclass
class DiscoveryResult:
    outcome: dict
    world_change_key: str | None = None
    started_quest_id: str | None = None
    quest_updates: list = field(default_factory=list)
    rewards: list = field(default_factory=list)


def _latest_release():
    return ContentRelease.objects.order_by("-imported_at", "-id").first()


def visible_discovery(discovery_id: str) -> DiscoveryDefinition:
    definition = DiscoveryDefinition.objects.filter(
        discovery_id=discovery_id, active=True, last_seen_release=_latest_release()
    ).first()
    if definition is None:
        raise DiscoveryNotVisible
    return definition


def discovered_ids(child) -> list[str]:
    state = WorldState.objects.for_child(child).first()
    return list(state.discovered_objects) if state else []


def _locked_world_state(child, at) -> WorldState:
    state = WorldState.objects.select_for_update().filter(child=child).first()
    if state is None:
        WorldState.objects.get_or_create(child=child, defaults={"updated_at": at})
        state = WorldState.objects.select_for_update().get(child=child)
    return state


@transaction.atomic
def discover(child, discovery_id: str, *, now=None) -> DiscoveryResult:
    definition = visible_discovery(discovery_id)
    at = now or timezone.now()
    state = _locked_world_state(child, at)  # serialises concurrent finds for this child
    context = {
        "worldChangeKeys": sorted(world_change_keys(child)),
        "ownedItemIds": sorted(owned_item_ids(child)),
        "discoveredIds": list(state.discovered_objects),
    }
    outcome = discovery_rules.resolve_discovery(definition.source, context)
    if outcome["status"] != "FOUND_NOW":
        return DiscoveryResult(outcome=outcome)

    state.discovered_objects = [*state.discovered_objects, definition.discovery_id]
    state.updated_at = at
    state.save(update_fields=["discovered_objects", "updated_at"])

    result = DiscoveryResult(outcome=outcome)
    change = definition.source.get("worldChange")
    if isinstance(change, dict) and all(
        isinstance(change.get(k), str) and change.get(k)
        for k in ("locationSlug", "changeType", "changeKey")
    ):
        record_world_change(
            child,
            location_slug=change["locationSlug"],
            change_type=change["changeType"],
            change_key=change["changeKey"],
            source_session_id=f"discovery:{definition.discovery_id}",
            now=at,
        )
        result.world_change_key = change["changeKey"]
    result.rewards += inventory.grant_for_trigger(
        child, {"type": "DISCOVERY", "discoveryKey": definition.discovery_id}
    )
    if definition.starts_quest_slug:
        quest = Quest.objects.filter(
            slug=definition.starts_quest_slug, active=True, last_seen_release=_latest_release()
        ).first()
        if quest is not None:
            try:
                _, created = start_quest(child, quest, now=at)
            except QuestUnavailable:
                created = False  # not for this child yet: the secret is still found
            if created:
                result.started_quest_id = quest.slug
    result.quest_updates = refresh_active_quests(child)
    result.rewards += [grant for update in result.quest_updates for grant in update.rewards]
    return result
