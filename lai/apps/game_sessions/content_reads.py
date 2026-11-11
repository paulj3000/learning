"""Published content reads for a child (LAI-0503, ADR-047 K).

Every read serves only published, active content for the child's age band, and every response
carries the published revision id and number of what it served, so a client can cache and
support can explain exactly what a child saw. Drafts, submitted and returned versions are never
visible: a row's content is its published revision (`authoring`), and a row without one is
treated as absent. Nothing here reads or returns child progress except an NPC's conditioned
dialogue, which uses the same rules as the 3D Area bootstrap.
"""

from apps.adventures.public import public_step
from apps.catalog.models import (
    Adventure,
    ItemDefinition,
    LearningObjective,
    NpcDefinition,
    Quest,
    RewardRule,
    Story,
)

MAX_LIST = 200


class ContentNotVisible(LookupError):
    """Unknown, unpublished, inactive, or not for this child's age band: all look the same."""


def revision_ref(row) -> dict | None:
    revision = row.published_revision
    return None if revision is None else {"id": str(revision.pk), "number": revision.number}


def _published(queryset):
    return queryset.filter(published_revision__isnull=False).select_related("published_revision")


# --- Adventures ----------------------------------------------------------------------------------


def _adventures(child):
    return _published(
        Adventure.objects.filter(active=True, age_bands__contains=[child.age_band])
    ).order_by("sort_order", "slug")


def visible_adventure(child, slug: str) -> Adventure:
    """The published, active adventure for this child's band, or `ContentNotVisible`."""
    adventure = _adventures(child).filter(slug=slug).first()
    if adventure is None:
        raise ContentNotVisible
    return adventure


def adventure_summary(adventure: Adventure) -> dict:
    return {
        "slug": adventure.slug,
        "title": adventure.title,
        "locationSlug": adventure.location_slug,
        "ageBands": list(adventure.age_bands),
        "skillDomain": adventure.skill_domain or None,
        "revision": revision_ref(adventure),
    }


def adventure_list(child) -> list[dict]:
    return [adventure_summary(a) for a in _adventures(child)[:MAX_LIST]]


def adventure_detail(child, slug: str) -> dict:
    adventure = visible_adventure(child, slug)
    steps = list(_published(adventure.steps.all()).order_by("position"))
    body = adventure.source
    return {
        **adventure_summary(adventure),
        "entryStepId": body.get("entryStepId"),
        "steps": [{**public_step(step.source), "revision": revision_ref(step)} for step in steps],
    }


# --- Quests ---------------------------------------------------------------------------------------


def _quests(child):
    return _published(
        Quest.objects.filter(active=True, age_bands__contains=[child.age_band])
    ).order_by("sort_order", "slug")


def quest_summary(quest: Quest) -> dict:
    return {
        "id": quest.slug,
        "title": quest.title,
        "summary": quest.summary,
        "giverNpcId": quest.giver_npc_id or None,
        "ageBands": list(quest.age_bands),
        "revision": revision_ref(quest),
    }


def quest_list(child) -> list[dict]:
    return [quest_summary(q) for q in _quests(child)[:MAX_LIST]]


def quest_detail(child, slug: str) -> dict:
    quest = _quests(child).filter(slug=slug).first()
    if quest is None:
        raise ContentNotVisible
    body = quest.source
    return {
        **quest_summary(quest),
        "entryStageId": body.get("entryStageId"),
        "stages": body.get("stages", []),
        "adventureSlugs": list(quest.adventures.values_list("slug", flat=True)),
    }


# --- Items, reward rules, learning objectives -----------------------------------------------------


def item_list(child) -> list[dict]:
    items = (
        _published(ItemDefinition.objects.filter(hidden=False))
        .select_related("collectible_set")
        .order_by("item_id")[:MAX_LIST]
    )
    return [
        {
            "id": i.item_id,
            "displayName": i.display_name,
            "description": i.description,
            "category": i.category,
            "rarity": i.rarity,
            "setId": i.collectible_set.set_id if i.collectible_set_id else None,
            "revision": revision_ref(i),
        }
        for i in items
    ]


def reward_rule_list(child) -> list[dict]:
    """Rules whose granted items are all visible (a hidden surprise stays a surprise)."""
    rules = (
        _published(RewardRule.objects.all())
        .order_by("rule_id")
        .prefetch_related("items")[:MAX_LIST]
    )
    out = []
    for rule in rules:
        items = list(rule.items.all())
        if any(item.hidden for item in items):
            continue
        out.append(
            {
                "id": rule.rule_id,
                "message": rule.message,
                "itemIds": [item.item_id for item in items],
                "triggerType": rule.source.get("trigger", {}).get("type"),
                "revision": revision_ref(rule),
            }
        )
    return out


def objective_list(child) -> list[dict]:
    rows = _published(LearningObjective.objects.all()).order_by("code")[:MAX_LIST]
    return [
        {"code": o.code, "domain": o.domain, "title": o.title, "revision": revision_ref(o)}
        for o in rows
    ]


# --- Stories --------------------------------------------------------------------------------------

_SCENE_PUBLIC = {
    "NARRATIVE": ("id", "kind", "speaker", "text", "branches"),
    "CHOICE": ("id", "kind", "prompt", "flagKey"),
    "ADVENTURE": ("id", "kind", "templateSlug"),
}


def _scene(scene: dict) -> dict:
    kind = scene.get("kind")
    shown = {k: scene[k] for k in _SCENE_PUBLIC.get(kind, ("id", "kind")) if k in scene}
    if kind == "CHOICE":
        shown["options"] = [
            {"id": o["id"], "label": o["label"], "flagValue": o["flagValue"]}
            for o in scene.get("options", [])
        ]
    return shown


def _stories(child):
    return _published(
        Story.objects.filter(active=True, supported_age_bands__contains=[child.age_band])
    ).order_by("sort_order", "slug")


def story_summary(story: Story) -> dict:
    return {
        "slug": story.slug,
        "title": story.title,
        "description": story.description,
        "supportedAgeBands": list(story.supported_age_bands),
        "revision": revision_ref(story),
    }


def story_list(child) -> list[dict]:
    return [story_summary(s) for s in _stories(child)[:MAX_LIST]]


def story_detail(child, slug: str) -> dict:
    story = _stories(child).filter(slug=slug).first()
    if story is None:
        raise ContentNotVisible
    body = story.source
    return {
        **story_summary(story),
        "entryChapterId": story.entry_chapter_id,
        "chapters": [
            {
                "id": chapter["id"],
                "title": chapter["title"],
                "nextChapterId": chapter.get("nextChapterId"),
                "scenes": [_scene(s) for s in chapter.get("scenes", [])],
            }
            for chapter in body.get("chapters", [])
        ],
        "adventureSlugs": list(story.adventures.values_list("slug", flat=True)),
    }


# --- NPCs -----------------------------------------------------------------------------------------


def _npcs():
    return _published(NpcDefinition.objects.filter(active=True)).order_by("sort_order", "npc_id")


def npc_summary(npc: NpcDefinition) -> dict:
    return {
        "id": npc.npc_id,
        "displayName": npc.display_name,
        "role": npc.role,
        "homeLocationSlug": npc.home_location_slug,
        "revision": revision_ref(npc),
    }


def npc_list(child) -> list[dict]:
    return [npc_summary(n) for n in _npcs()[:MAX_LIST]]


def npc_detail(child, npc_id: str) -> dict:
    """The NPC and the dialogue this child's age band hears now (LAI-0817 rules, conditions
    evaluated for this child). Authored text only; no model is called."""
    from .play_state import npc_dialogue

    npc = _npcs().filter(npc_id=npc_id).first()
    if npc is None:
        raise ContentNotVisible
    return {**npc_summary(npc), "dialogue": npc_dialogue(child, None, npc)}
