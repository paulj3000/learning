# Scoring Migration and Rollout Plan (GE-109)

- **Status:** Plan. Every deployed step is an owner approval; none has been done.
- **Last reviewed:** 2026-11-18

## 1. Schema

`apps.scoring` migration `0001_initial` creates four new tables (`ScoringPolicy`, `AwardRule`,
`AwardLedgerEntry`, `ProgressionProjection`). **No existing table is altered**, and no
existing migration is touched. It depends on `game_sessions 0007_merge_main` and
`users 0008_merge_amplify_exit`. Rolling back is `migrate scoring zero`, which drops only scoring
tables.

## 2. Existing child progress

Nothing is converted, moved or rewritten. Collectors only **read** inventory, quests, world
changes, sessions, attempts and mastery counters. The ledger is derived from them, so every
child's existing progress counts once, through the same path as live play.

## 3. Rollout, per environment

| Step | Command or setting | Who | Reversible |
|---|---|---|---|
| 1. Deploy code with scoring off | `LAI_SCORING_ENABLED=false` (default) | owner-approved deploy | yes |
| 2. Migrate | `manage.py migrate scoring` | owner-approved deploy | yes (`migrate scoring zero`) |
| 3. Owner accepts the scoring ADR | ADR-NNN, number reserved on `main` | owner | n/a |
| 4. Author a non-fixture policy | Django Admin: clone the fixture, or create one with approved values; `is_development_fixture` off | content designer | edit while DRAFT |
| 5. Record approval and activate | Admin actions: superuser approval, then activate | owner (superuser) | retire, or activate another version |
| 6. Dry-run backfill | `manage.py scoring_reconcile --dry-run` (counts only, no ids) | operator | read-only |
| 7. Enable | `LAI_SCORING_ENABLED=true` | owner | set it back to false |
| 8. Backfill | `manage.py scoring_reconcile` (idempotent; safe to rerun) | operator, with owner approval | erase per child, or `migrate scoring zero` |
| 9. Verify | `manage.py scoring_verify_projections` (`--rebuild` to repair) | operator | read-only, or rebuild |
| Repair a defect | `manage.py scoring_correct` (superuser, reason required; the original stays) | operator, with owner approval | a later correction can restore up to the original |

In local development: `manage.py scoring_load_dev_policy --activate` with
`LAI_SCORING_ENABLED=true` and `LAI_SCORING_ALLOW_UNAPPROVED=true`. Production settings refuse
the second.

## 4. Policy changes later

A value change is a new policy version: clone, edit the draft, approve, then activate. Award keys
leave out the version, so nothing already earned is paid again. Keep stacking group names
across versions. A wrong amount already paid is repaired with a correction
(`manage.py scoring_correct <entry> --staff <superuser> --reason ...`), never by editing or
deleting entries. The ledger is child progress, so it is not on the Django admin.

## 5. Realm compatibility adapters (GE-109)

There's no adapter code per realm. Every realm's chests, pickups, puzzles, quests, discoveries
and granted reward rules are read by the core collectors. Two things are declared as data:

- **3D adventures and courses** (`lai/apps/scoring/realms.py`, `REALM_ADVENTURES`): which quests
  prove an adventure or course complete, and which adventures make up a realm. A completion counts
  only with every BUILD key proven by a server record.
- **Secrets:** a pickup that grants an item authored `hidden` (content, no table).

| Realm | Source of the mapping | What it contributes | Verified here |
|---|---|---|---|
| Treasure Rush (Treasure Cove) | `docs/engine/TREASURE_RUSH_SCORING_INVENTORY.md` (feature/treasure-rush-palm-trees 6818f74b) | adventure `treasure-cove` from `pips-missing-treasure`; non-REPLAY chests incl. the pedestal; pickups (brass key earns no coins); legacy quest suppressed | yes: content on this branch; drift tests run |
| Pirate's Leap | same document, section 3.1 | course `pirates-leap` from its quest plus the crow's nest chest; the quest award is replaced by the course award (dev suppress rule) | yes: real chest flow tested |
| Storykeeper Castle | `feature/storykeeper-castle-completion` | nothing to declare: step adventures and server-checked discoveries use the core collectors; trophies are keepsake projections | core tests |
| Firepeak (The Volcano Awakens) | `docs/firepeak/SCORING_INTEGRATION_AUDIT.md` (feature/firepeak-volcano-adventure 3e2b513c) | adventure `firepeak-volcano`; graded puzzles | yes: drift test proves every BUILD key is an authored puzzle |
| Firepeak (Heart of Firepeak) | same, section 4 | adventure `firepeak-heart`; hidden shards are secrets (`hidden` items) | **skipped here**: content not on this branch; the drift tests run at integration |
| North Pole | same, section 4 | adventure `north-pole-village` (quests q01 to q09); ornaments and golden bells are secrets | **skipped here**, as above |

Deliberately not mapped:
- Zone-restored keys as REALM_MILESTONE. That would pay a 1,000 XP milestone per zone, while
  quests and puzzles already pay each zone.
- `NORTH_POLE_Q0N_COMPLETE` and other bare world changes.
- `SeasonalCompletion`, which is client-triggerable and yearly.

Stacking for completions: quest, adventure and realm stack as different levels. A course is the
same accomplishment as its quest, so it replaces it.

**Content drift:** `test_realms.py` fails if a mapped adventure's quests are only partly
exported, or if a mapped quest requires a key with no authored chest, puzzle or pickup. Realms
not on the branch are reported as skipped, never as passed.

## 5a. Verified guarantees

- Running backfill twice records nothing new, and existing inventory, granted rules, quests and
  world changes are unchanged.
- A new policy version with different amounts pays nothing again for earned sources.
- Concurrent reconciles, and a backfill racing live play, never duplicate (`test_concurrency.py`).
- Projections rebuild exactly from the ledger (`scoring_verify_projections`).

## 6. Data protection

Ledger rows hold content ids and amounts only: no names, free text or audio. A parent's
`DELETE children/{id}/scoring/` erases the child's scoring record, and child deletion cascades
it. Logs and commands print counts and exception types only.
