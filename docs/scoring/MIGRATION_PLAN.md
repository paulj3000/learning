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

## 5. Realm compatibility adapters

There's no adapter code per realm. Every realm's chests, pickups, puzzles, quests, discoveries
and granted reward rules are read by the core collectors. A realm is integrated by policy
selectors (for example `REWARD_RULE_GRANTED` with selector `fh-badge-*` or `attribute_equals`
`{"itemCategory": "KEEPSAKE"}`), authored from the realm owners' mapping tables:

| Realm | Mapping source | Status |
|---|---|---|
| Firepeak, North Pole | `docs/firepeak/SCORING_INTEGRATION_AUDIT.md` (feature/firepeak-volcano-adventure @ `3e2b513c`) | received; selectors authored at integration, when the content is on the integration branch |
| Treasure Rush, Pirate's Leap | `docs/engine/TREASURE_RUSH_SCORING_INVENTORY.md` (feature/treasure-rush-palm-trees) | corrections received; document pending |
| Storykeeper Castle | `feature/storykeeper-castle-completion` | no scoring change needed; quest proofs raise trust once merged |

At integration, add a content-drift test that loads `content/exported/` and fails if a mapped
rule id or key disappears (Firepeak owner's suggestion).

## 6. Data protection

Ledger rows hold content ids and amounts only: no names, free text or audio. A parent's
`DELETE children/{id}/scoring/` erases the child's scoring record, and child deletion cascades
it. Logs and commands print counts and exception types only.
