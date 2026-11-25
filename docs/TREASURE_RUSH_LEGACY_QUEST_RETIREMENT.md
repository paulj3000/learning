# Treasure Rush: retiring the legacy `treasure-rush-cove` quest

Status: **prepared, not executed** (LAI 01, 2026-11-25, `main` `05b54d8a`). The owner decided
to retire the quest after the release playthrough, and only on their explicit authorization.
Nothing in this document has been run against any environment. All historical player progress,
scoring, quest attempts and learning evidence must be kept.

## 1. What the quest is

`treasure-rush-cove` ("Treasure Rush", giver `pirate-pip`) is the first Treasure Cove quest, from
`content/exported/quests.json`. Pip's Missing Treasure (`pips-missing-treasure`) replaced it.
`upgrade_pips_treasure` (`lai/apps/regions/pips_treasure_seed.py`) already removed it from the
cove's offered quests, so no child is offered it today. It stays `active=True` in the catalog so
that a child who started it keeps their progress
(`docs/engine/TREASURE_RUSH_SCORING_INVENTORY.md` section 3.1).

The quest id is the same string as the 3D Area id (`treasure-rush-cove`). This procedure changes
the **catalog quest** only, never the 3D Area.

## 2. What retiring does (and does not) change

Retiring means setting the catalog field `active` to false. Checked against the code on
`05b54d8a`:

| Area | Effect of `active=False` | Code |
|---|---|---|
| Quest progress rows | **Kept.** Nothing deletes or edits them. | `QuestProgress.quest` is `on_delete=PROTECT` |
| Child's quest log API | **Unchanged.** It lists every progress row, active or not. | `apps/quests/views.py` `QuestListView` |
| Quest Journal page | **Unchanged.** It shows bundled quest definitions, and this quest is not one of them. | `react/src/routes/QuestJournal.tsx` |
| Treasure Cove quest panel and Pip | **Unchanged.** The cove lists offered, active quests, and this one is no longer offered. | `play_state.py` `region.offered_quests.filter(active=True)` |
| A child who never started it | Can no longer accept it. It already isn't offered anywhere. | `play_state.published_quest`, `quests.services.start_quest` |
| A child with it in progress | The row stays ACTIVE and still advances when they open the landing chest. No reward is attached to it, so nothing is granted. | `refresh_active_quests` (not filtered by `active`) |
| A child who completed it | Stays COMPLETED with its dates. | |
| Rewards, items, world changes | **Unchanged.** The quest has no completion reward rule. The landing chest's doubloon belongs to the chest. | scoring inventory section 3.1 |
| Learning evidence (`SkillEvidence`), challenge attempts | **Unchanged.** They belong to chests, not to this quest. | `apps/game_sessions/play.py` |
| Scoring and XP | **No change.** The collector already skips inactive quests, and `DEV_SUPPRESSIONS` already suppresses this one. Scoring is off by default (`LAI_SCORING_ENABLED`). | `apps/scoring/collectors.py`, `apps/scoring/fixtures.py` |
| Realm Explorer | **No change.** Treasure Cove completes on `pips-missing-treasure` only. | `apps/scoring/realms.py` |
| Catalog quest list API | The quest is no longer listed. | `apps/game_sessions/content_reads.py` |
| NPC dialogue validation | No change. No NPC dialogue names this quest. | `apps/npcs/validation/dialogue.py` |

**Never delete the quest.** Django Admin offers Delete, but Django refuses it while any
progress row exists (`PROTECT`). Where no row exists, deleting would still lose the record that
the quest existed. Deactivate only.

## 3. Procedure (run per environment, only after the owner authorizes it)

`load_content` creates a missing quest as active and never touches `active` on an existing row.
Every environment (each developer database, staging, production) is therefore retired
separately. A database created later from the export starts with the quest active again, so
repeat step 3 there.

### Step 1: record the state before (read-only)

```bash
cd lai
../.venv/bin/python manage.py shell -c "
from django.db.models import Count
from apps.catalog.models import Quest
from apps.quests.models import QuestProgress
q = Quest.objects.get(slug='treasure-rush-cove')
print('active:', q.active, '| offered in:', list(q.offered_in_regions.values_list('region_id', flat=True)))
print('progress by status:', dict(QuestProgress.objects.filter(quest=q).values_list('status').annotate(n=Count('id'))))
"
```

Expected: `active: True | offered in: []`. Write down the progress counts. If `offered in` is
not empty, stop: that environment has not run `upgrade_pips_treasure` (`seed_treasure_rush`),
and retiring would remove a quest children are being offered.

On a deployed environment, take a database snapshot first, through the normal approved
release process. That is an owner action; agents make no AWS calls.

### Step 2: deactivate in Django Admin

1. Sign in to Django Admin as staff with catalog edit rights.
2. **Game content catalog, Quests**, search `treasure-rush-cove`, and open the row titled "Treasure Rush" whose
   giver is `pirate-pip`.
3. Untick **Active**. Change nothing else. **Save**.

### Step 3: check the state after (read-only)

Run step 1's command again. Expected: `active: False`, the same `offered in: []`, and the
**same progress counts** as before. Then, as a parent with a child who played the cove:

- Treasure Cove still offers Pip's Missing Treasure or Pirate's Leap as before, and the cove
  plays the same.
- The child's backpack, badges and quest journal look as they did before.
- The parent dashboard's skills view shows the same evidence as before.

### Rollback

Tick **Active** again and save. Nothing else changed, so nothing else needs restoring.

## 4. Not in scope

- The 3D Area `treasure-rush-cove`, its chests and its placements.
- Removing the quest from `content/exported/quests.json`. That would only stop it being created
  in new databases, and it is a content export change for a later decision.
- Any change to scoring suppressions: they stay in place, so a reactivated quest still cannot
  pay twice.
