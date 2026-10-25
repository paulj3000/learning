"""Load the exported source content into the catalog tables (LAI-0304, `manage.py load_content`).

- Every file is validated against the content schema first; one bad file loads nothing.
- Idempotent: rows are matched by their exported id or slug and updated in place, in one
  transaction, so running it twice changes nothing the second time.
- `status` is set only when a row is created. An administrator who retires exported content
  keeps it retired across reloads (ADR-031: the admin catalog overlays source content).
- Rows that are not in the export (admin-authored Treasure Rush content) are never touched.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path

from django.conf import settings
from django.db import transaction

from apps.adventures.models import AdventureTemplate
from apps.core.content_schema import validate_file
from apps.education.models import LearningObjective
from apps.inventory.models import CollectibleSet, ItemDefinition, RewardRule
from apps.islands.models import Island, IslandLocation, NpcDefinition, NpcDialogueNode
from apps.quests.models import QuestDefinition

LOADED_FILES = (
    "adventures.json",
    "islands.json",
    "locations.json",
    "npcs.json",
    "quests.json",
    "rewards.json",
)


@dataclass
class LoadReport:
    created: dict[str, int] = field(default_factory=dict)
    updated: dict[str, int] = field(default_factory=dict)

    def record(self, label: str, created: bool) -> None:
        bucket = self.created if created else self.updated
        bucket[label] = bucket.get(label, 0) + 1

    def total(self, label: str) -> int:
        return self.created.get(label, 0) + self.updated.get(label, 0)


def read_exported(content_dir: Path | None = None, schema: dict | None = None) -> dict:
    """Parse and schema-validate every file the loader uses. Raises `ContentSchemaError`."""
    exported = (content_dir or settings.CONTENT_DIR) / "exported"
    files = {}
    for name in LOADED_FILES:
        data = json.loads((exported / name).read_text(encoding="utf-8"))
        validate_file(name, data, schema)
        files[name] = data
    return files


@transaction.atomic
def load_content(content_dir: Path | None = None, schema: dict | None = None) -> LoadReport:
    files = read_exported(content_dir, schema)
    report = LoadReport()

    def upsert(model, label: str, lookup: dict, values: dict):
        row, created = model.objects.update_or_create(**lookup, defaults=values)
        report.record(label, created)
        return row

    adventures = files["adventures.json"]
    objectives = {}
    for raw in adventures["learningObjectives"]:
        objectives[raw["code"]] = upsert(
            LearningObjective,
            "learning_objectives",
            {"code": raw["code"]},
            {"domain": raw["domain"], "title": raw["title"]},
        )

    islands = {}
    for raw in files["islands.json"]["islands"]:
        islands[raw["slug"]] = upsert(
            Island,
            "islands",
            {"slug": raw["slug"]},
            {
                "title": raw["title"],
                "tagline": raw["tagline"],
                "description": raw["description"],
                "is_home": raw.get("isHome", False),
                "supported_age_bands": raw["supportedAgeBands"],
                "pack": raw["pack"],
                "arrival": raw.get("arrival"),
                "travel_requirement": raw.get("travelRequirement"),
            },
        )

    locations = {}
    for raw in files["locations.json"]["locations"]:
        locations[raw["slug"]] = upsert(
            IslandLocation,
            "locations",
            {"slug": raw["slug"]},
            {
                "island": islands[raw["worldSlug"]],
                "title": raw["title"],
                "tagline": raw["tagline"],
                "description": raw["description"],
                "decoration": raw["decoration"],
                "skills": raw["skills"],
                "unlock_requirement": raw.get("unlockRequirement"),
            },
        )

    rewards = files["rewards.json"]
    sets = {}
    for raw in rewards["collectibleSets"]:
        sets[raw["id"]] = upsert(
            CollectibleSet,
            "collectible_sets",
            {"set_id": raw["id"]},
            {"display_name": raw["displayName"], "completion_message": raw["completionMessage"]},
        )
    items = {}
    for raw in rewards["items"]:
        items[raw["id"]] = upsert(
            ItemDefinition,
            "items",
            {"item_id": raw["id"]},
            {
                "display_name": raw["displayName"],
                "description": raw["description"],
                "category": raw["category"],
                "rarity": raw["rarity"],
                "cosmetic_slot": raw.get("cosmeticSlot", ""),
                "hidden": raw.get("hidden", False),
                "collectible_set": sets[raw["setId"]] if "setId" in raw else None,
            },
        )
    for raw in rewards["collectibleSets"]:
        completion = raw.get("completionItemId")
        collectible_set = sets[raw["id"]]
        collectible_set.completion_item = items[completion] if completion else None
        collectible_set.save(update_fields=["completion_item"])
    for raw in rewards["rewardRules"]:
        rule = upsert(
            RewardRule,
            "reward_rules",
            {"rule_id": raw["id"]},
            {"trigger": raw["trigger"], "message": raw["message"]},
        )
        rule.items.set(items[item_id] for item_id in raw["itemIds"])

    npcs = {}
    for raw in files["npcs.json"]["npcs"]:
        npc = upsert(
            NpcDefinition,
            "npcs",
            {"npc_id": raw["id"]},
            {
                "display_name": raw["displayName"],
                "role": raw["role"],
                "home_location": locations[raw["homeLocationSlug"]],
                "interaction_id": raw["interactionId"],
                "schedule": raw["schedule"],
                "quest_offers": raw["questOffers"],
            },
        )
        npcs[raw["id"]] = npc
        for order, node in enumerate(raw["dialogue"]):
            upsert(
                NpcDialogueNode,
                "dialogue_nodes",
                {"npc": npc, "node_id": node["id"]},
                {
                    "sort_order": order,
                    "text": node["text"],
                    "conditions": node["conditions"],
                    "choices": node["choices"],
                    "sets_memory_flags": node.get("setsMemoryFlags", []),
                    "awards_relationship_points": node.get("awardsRelationshipPoints", 0),
                    "follow_up_only": node.get("followUpOnly", False),
                    "narration": node.get("narration"),
                },
            )
        npc.dialogue.exclude(node_id__in=[node["id"] for node in raw["dialogue"]]).delete()

    for raw in adventures["adventures"]:
        adventure = upsert(
            AdventureTemplate,
            "adventures",
            {"slug": raw["slug"]},
            {
                "version": raw["version"],
                "title": raw["title"],
                "location_slug": raw["locationSlug"],
                "age_bands": raw["ageBands"],
                "entry_step_id": raw["entryStepId"],
                "steps": raw["steps"],
                "skill_domain": raw.get("skillDomain", ""),
                "skill_level": raw.get("skillLevel"),
            },
        )
        codes = {code for step in raw["steps"] for code in step.get("objectiveIds", [])}
        adventure.learning_objectives.set(objectives[code] for code in sorted(codes))

    for raw in files["quests.json"]["quests"]:
        giver = raw.get("giverNpcId")
        upsert(
            QuestDefinition,
            "quests",
            {"quest_id": raw["id"]},
            {
                "title": raw["title"],
                "summary": raw["summary"],
                "age_bands": raw["ageBands"],
                "giver_npc": npcs[giver] if giver else None,
                "prerequisites": raw["prerequisites"],
                "entry_stage_id": raw["entryStageId"],
                "stages": raw["stages"],
                "completion": raw["completion"],
            },
        )
    return report
