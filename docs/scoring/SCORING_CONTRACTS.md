# Scoring Contracts (GE-101)

- **Status:** Development contract v1, frozen for consumers. **Proposed economy; not owner-approved** (see [ADR draft](ADR_DRAFT_SCORING_ECONOMY.md)).
- **Owner:** GE-100 scoring lead (`core/ge-scoring`)
- **Last reviewed:** 2026-11-18
- **Canonical sources:** [`lai/apps/scoring/contracts.py`](../../lai/apps/scoring/contracts.py), [`lai/apps/scoring/rules.py`](../../lai/apps/scoring/rules.py), [`react/src/features/scoring/types.ts`](../../react/src/features/scoring/types.ts)

A change to anything in this document is a contract change: it goes back through GE-101, and
consumers (realm branches, the Game Engine Core adapter, the React scoring feature) are told
on the GE-100 card first.

## 1. Model

Awards are **derived, never claimed**. Collectors read records that Django wrote after
deciding something itself and turn each into a fact. The active policy turns facts into
awards. The ledger stores each award once.

```text
server records --collectors--> ScoringFact --rules.decide(policy)--> AwardDecision --ledger--> AwardLedgerEntry
                                                                                       \--> ProgressionProjection (cache)
```

The client never sends an amount, a currency or a total, and there is no write route for
awards. Gameplay events from the engine are claims that Django joins to its own records (see
[TRUST_BOUNDARY.md](TRUST_BOUNDARY.md)).

## 2. Vocabulary

| Concept | Where it lives | Notes |
|---|---|---|
| XP (`XP`) | ledger currency | Exploration and adventure progress. Drives character level. |
| Learning Points (`LEARNING_POINTS`) | ledger currency | Learning only: graded answers, learning challenges, mastery milestones. Separate from XP. |
| Coins (`COINS`) | ledger currency | Earn-only. No sink, shop, purchase, trade, real-money value or loot box. |
| Stars (`STAR`) | ledger currency, per scope | 0 to 3 per 3D Area from exploration goals. Never lost. |
| Character level | derived | `rules.level_for(xp, policy.level_thresholds)`. Has a top level. |
| Adventure score | derived | Ledger totals grouped by `scope_key`. |
| Personal best | derived | Most XP earned in one visit (session) of a scope. Private. Never time-based. |
| Achievements | existing `KEEPSAKE` items | `InventoryItem` with `ItemDefinition.category == "KEEPSAKE"` (FPV-18). No new model. |
| Trophies | existing set completion items | Owned `CollectibleSet.completion_item`. No new model. |
| Collectibles | existing inventory | Unchanged. `RewardRule`/`GrantedRule` stay the source of truth. |
| Subject mastery | existing `SkillProgress` | Grouped by `LearningObjective.domain`. Thresholds stay in the shared mastery modules. |
| Exploration milestones | ledger | `LOCATION_FIRST_VISIT`, `SECRET_DISCOVERED`, `REALM_MILESTONE` facts. |

## 3. Source kinds and trust

Trust tiers (`contracts.Trust`, ordered):

| Tier | Meaning | Authoritative |
|---|---|---|
| `SERVER_GRADED` (2) | Django decided the outcome | yes |
| `SERVER_BOUNDED` (1) | the child's claim, accepted only for an authored, published thing, once, from a finite set | yes (policy may raise a rule's floor to 2) |
| `CLIENT_REPORTED` (0) | only the client says so | **never**; a database constraint and `rules.decide` both refuse it |

| `SourceKind` | `source_ref` | Server record | Trust |
|---|---|---|---|
| `ANSWER_CORRECT` | `<adventure>/<step>` | `AdventureAction` ANSWER, CORRECT, ADVENTURE session | GRADED |
| `LEARNING_CHALLENGE` | `<region>/<chest>` | `ChallengeAttempt` correct, non-REPLAY chest | GRADED |
| `MASTERY_MILESTONE` | `<objective>/<PROFICIENT\|MASTERED>` | `SkillProgress.recent_level` | GRADED |
| `LOCATION_FIRST_VISIT` | `<region>` | first REGION `AdventureSession` | BOUNDED |
| `SECRET_DISCOVERED` | `<discovery>` | `WorldState.discovered_objects` (requirements checked) | GRADED |
| `SECRET_DISCOVERED` | `<region>/<pickup key>` | an authored pickup whose reward grants an item authored `hidden` (GE-109) | BOUNDED |
| `PICKUP_COLLECTED` | `<region>/<pickup key>` | `WorldChange` COLLECTIBLE_FOUND whose key is an authored placement's | BOUNDED |
| `PUZZLE_SOLVED` | `<region>/<puzzle>` | `PuzzleAttempt` correct | GRADED for graded kinds, else BOUNDED |
| `QUEST_COMPLETED` | `<quest>` | `QuestProgress` COMPLETED | BOUNDED |
| `ADVENTURE_COMPLETED` | `<adventure>` | ADVENTURE `AdventureSession` COMPLETED | GRADED |
| `ADVENTURE_COMPLETED` | `<3D adventure>` | its quests COMPLETED and every BUILD key proven by a server record (`realms.py`, GE-109) | BOUNDED |
| `REALM_MILESTONE` | `<world>` | every active, age-appropriate quest of the world completed, or every listed adventure of the realm proven (`realms.py`); same ref, so it pays once | BOUNDED |
| `REWARD_RULE_GRANTED` | `<rule id>` | `GrantedRule` (every realm's keepsakes, badges, sets) | BOUNDED |
| `ADVENTURE_STAR` | `<region>/<n>` | goals done in the area (puzzles, chests, pickups) | BOUNDED |
| `JUMP_CHALLENGE` | `<challenge>` | none: no server record of a jump exists | deferred (client only) |
| `PLATFORM_COURSE` | `<course>` | the course's completion quest COMPLETED with every BUILD key proven by a server record (Pirate's Leap: the crow's nest chest's graded challenge). Never movement claims | BOUNDED |

Fact attributes a rule may match (`AwardRule.attribute_equals`): `itemCategory` and
`triggerType` on `REWARD_RULE_GRANTED`, `puzzleKind` on `PUZZLE_SOLVED`, `skillId` and `source`
on `LEARNING_CHALLENGE`, `world` on `QUEST_COMPLETED`, `objective` on `MASTERY_MILESTONE`.

**Proven keys** (`realms.proven_change_keys`): a quest's BUILD objective keys can be satisfied by
client-posted world changes, so an adventure or course counts only when each of its keys comes
from a correctly answered chest, a solved Area puzzle, or an authored pickup collected through
the play API.

## 4. Idempotency and replay

```text
v1|<SourceKind>|<source_ref>|<Currency>|<stacking group>
```

Unique per child in the database. It leaves out the policy version and the rule on purpose:
retuning values in a new policy version never pays anything again. Refs are stable authored
ids, so **a replay, a retry, a second tab, a backfill and a later policy version all find the
same key and award nothing**. There are no repeatable awards in v1. Long refs are hashed
(`#<sha256 prefix>`).

## 5. Stacking

Rules are grouped by `(stacking_group, currency)`; a rule without a group is its own group.
In a group exactly one rule applies: exact selector, then longest prefix (`abc*`), then
match-all; then higher `priority`; then lower `rule_key`. Different groups add up.

A `suppress` rule competes like any other but pays nothing when it wins. With an exact selector
it stops one source paying in that group: for example the legacy `treasure-rush-cove` quest,
still active so children keep their progress, which completes on the same chest as Pip's
quest. Retiring the quest is an owner content decision.

## 6. HTTP API (child-scoped, parent bearer auth, `ChildScopedAPIView`)

All under `/api/v1/children/{childId}/`. Another family's child is `404`. No route accepts an
amount.

### `GET scoring/`

Scoring off (the default): `{"enabled": false, "contractVersion": 1}`. The client shows no
numbers.

Scoring on:

```json
{
  "enabled": true,
  "contractVersion": 1,
  "policy": {"key": "default", "version": 3, "provisional": true},
  "totals": {"xp": 800, "learningPoints": 350, "coins": 20, "stars": 2},
  "level": {"level": 2, "xp": 800, "levelFloorXp": 500, "nextLevelXp": 1500},
  "achievements": [{"itemId": "fh-badge-lava-jumper", "displayName": "...", "description": "...", "acquiredAt": "ISO"}],
  "trophies": [{"setId": "fh-crystals", "displayName": "...", "itemId": "fh-badge-crystal-collector", "acquiredAt": "ISO"}],
  "adventures": [{"scopeKey": "treasure-rush-cove", "xp": 300, "learningPoints": 250, "coins": 20, "stars": 2, "maxStars": 3, "personalBest": {"xpInOneVisit": 300}}],
  "subjects": [{"subject": "number-sense", "objectives": 4, "proficient": 1, "mastered": 1}],
  "recentAwards": [{"id": "uuid", "entryKind": "AWARD", "currency": "XP", "amount": 50, "sourceKind": "LOCATION_FIRST_VISIT", "sourceRef": "treasure-rush-cove", "scopeKey": "treasure-rush-cove", "recordedAt": "ISO"}]
}
```

`nextLevelXp` is `null` at the top level. `personalBest` is `null` when the scope has no
session-linked XP. `provisional` is true for a development fixture or an unapproved policy.

### `GET scoring/awards/?after=<entry id>`

Ledger entries recorded after the cursor, oldest first, at most 100:
`{"awards": [award...], "cursor": "<last id>|null", "hasMore": false}`. Includes `CORRECTION`
entries (`entryKind`), which the child UI never celebrates. An unknown or other child's cursor
is `400 invalid_cursor`. When scoring is off: `{"awards": [], "cursor": null, "hasMore": false}`.

### `DELETE scoring/`

A parent's privacy erasure of the child's ledger and projection. `204`. The only deletion path.
It erases the scoring record only; the backpack, quests and world are unchanged. A later
reconcile rebuilds awards from the records that remain.

## 7. Engine events (Game Engine Core, `lai.gameplay` v1)

The engine's typed events are claims. The React adapter turns them into **pending**
notifications with no amount; the awards feed confirms them. Django's intake joins each claim
to its own record by the semantic ids it carries (`sessionRef` = the Django session id, plus
step, attempt, puzzle, chest or course ids). Falls, respawns and hints are not scoring events.
See [TRUST_BOUNDARY.md](TRUST_BOUNDARY.md).

## 8. Configuration

| Setting | Default | Meaning |
|---|---|---|
| `LAI_SCORING_ENABLED` | `false` | The whole engine. Off: nothing is awarded, `GET scoring/` says `enabled: false`. |
| `LAI_SCORING_ALLOW_UNAPPROVED` | `false` | Lets an unapproved (development fixture) active policy award. Local development and tests only. |
| `LAI_SCORING_EXCLUDED_SCOPE_PREFIXES` | `[]` | Extra prefixes, added to `playground`, `dev-`, `test-`, `engine-playground`, whose activity never awards. |
