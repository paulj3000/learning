# Math Mayhem Multiplayer: Phase 0 Baseline

_2026-10-12, branch `feature/math-mayhem-multiplayer-foundation`, from `main` at `df2bcd3`._

Phase 0 of [`../MATH_MAYHEM_MULTIPLAYER_ROADMAP.md`](../MATH_MAYHEM_MULTIPLAYER_ROADMAP.md).
No production code was changed. The architecture decision this phase asks
for is ADR-026 in [`../DECISIONS.md`](../DECISIONS.md) (status: Proposed).

## 1. Automated baseline

Run on Node 24.14.0, npm 11.9.0.

| Command | Result |
|---|---|
| `npm ci --dry-run` | exit 0 (lockfile consistent) |
| `npm run typecheck` | exit 0 (app, `amplify/`, `scripts/`) |
| `npm run lint` | exit 0, no errors; pre-existing warnings only (mostly `jsx-a11y/prefer-tag-over-role`) |
| `npm test` | **249 files, 2,567 tests passed**, 0 failed (236 s) |
| `npm run build` | exit 0; pre-existing "chunk larger than 500 kB" warning |

The counts match `docs/engine/ENGINE_OVERVIEW.md` exactly, so the documented
baseline still describes HEAD.

## 2. Browser rendering check (automated, not a human playtest)

A throwaway harness (`.tmp-verify/harness/engine.html`, untracked) mounted
every manifest from `sourceLocationManifestRepository` through the real
`createLocationEngine` with `DEFAULT_LOCATION_ENGINE_DEPS` and the
registered extensions, in headless Chromium (SwiftShader WebGL, 1024x640).
For each region it took a screenshot at spawn, held `W` for 1.5 s, then
held `D` and `ArrowLeft`.

| Region | Mounted | Page / in-scene errors | Forward walk changed view | Semantic events seen |
|---|---|---|---|---|
| welcome-harbor | yes | none | 21% of pixels | `PlayerEnteredZone` dock |
| pirate-builder-bay | yes | none | 41% | zones dock, bridge-approach, broken bridge; `NpcApproached pirate-pip` |
| wonderwild-forest | yes | none | 43% | zones harbor-path |
| clockwork-harbor | yes | none | 30% | zone harbor-entrance |
| dragons-sanctuary | yes | none | 8% | zones gate, valley |
| storykeeper-castle | yes | none | 47% | zone entrance |

Every region rendered recognisable geometry (sky, ground, buildings, NPC
placeholders), every model request resolved through the catalogue with no
failed requests, and walking fired the expected zone events.

Two "no change" readings in the `D` + `ArrowLeft` step were a harness
mistake, not a defect: `ArrowLeft` strafes left, cancelling `D`
(`pointerControls.ts:136-137`).

**What this does not cover:** NPC conversation panels, collectible pickup,
checkpoint persistence and navigation all need the React view, a signed-in
parent and the sandbox backend. No parent test credentials are available
in this session, so those were **not** exercised in a browser. They remain
covered by the jsdom suites (`*Parity.test.tsx`, `ThreeLocationWorldView.test.tsx`).

## 3. Manual playtest: not done

Engine overview gap 1 still stands: **no person has played any region since
the engine migration**, on desktop or tablet. This phase did not change
that, and it must not be reported as passed. The roadmap makes it a Phase 0
task; it needs a human with a browser and, ideally, a tablet.

Suggested script (about 10 minutes per region): sign in, pick a child,
open `/island/<childId>/explore/<regionId>`, walk, look around (mouse and
touch), talk to one NPC, pick up one collectible, leave and re-enter to
confirm the checkpoint, use "Things to do here" and the non-graphical exit.

## 4. Findings that matter for multiplayer

### 4.1 Already exists

| Capability | Where | Relevance |
|---|---|---|
| Household co-op sessions | `CoopSession` model, `src/features/coop/`, `claimCoopSlot` Lambda (Phase 17, ADR-006) | Same-parent children share one adventure instance; presence is join/leave only, carried on AppSync `onUpdate` subscriptions |
| Server-side ownership re-check pattern | `ChildProfile.ownerSub`, used by `claimCoopSlot`, `submitAdventureAnswer`, `getNextLearningActivity` | The room server should re-derive child ownership the same way |
| Server-authoritative answer grading | `submitAdventureAnswer` (ADR-012) | Reusable for vault challenges; grading already lives off the client |
| Adaptive selection | `getNextLearningActivity` Lambda, `src/features/director/`, `SkillProgress` | Phase 5 should reuse it, not build a second progress system |
| Idempotent rewards | `grantRewards` (`src/features/rewards/api.ts`), idempotent per child per rule id via `ChildInventory.grantedRuleIds` | "Exactly once per child" already has a key; the write is client-side, though |
| Item rarity field | `ItemDefinition.rarity` | Descriptive only; deliberately never weights anything |
| Parent auth | Cognito email login, groups `Admins` and `Superusers` only | No child identities (ADR-001) |
| Budget alarms | `amplify/backend.ts` (Bedrock monthly budget) | Pattern to copy for a room-server cost alarm |

### 4.2 Does not exist

- Any WebSocket, room server, Colyseus or socket dependency.
- Remote player rendering, avatars of other players, or third-person camera.
- A feature-flag system (only two `VITE_*` numeric config reads in `src/features/assets/config.ts`).
- Any friend or cross-family relationship model.
- Any Math Mayhem region, manifest, checkpoints or dragon-egg vault content.
- Server-authoritative reward granting (ADR-013 part C lists it as open backlog).

### 4.3 Conflicts with existing decisions (need a product decision)

1. **Cross-family play.** ADR-006 limits co-presence to children of the
   **same parent account**, and calls cross-family pairing "a separate,
   larger decision". CLAUDE.md section 12 puts social networking and
   child-to-child messaging out of scope. Roadmap Phase 3 ("two approved
   test accounts") reads as two different families. Under the current
   decisions, the first playable MVP should be two children of one
   household, possibly on two devices.
2. **Continuous presence.** ADR-006 v1 excludes "continuous
   cursor/telemetry-level presence". Phase 2 (synchronised movement) needs
   that exclusion amended. ADR-026 proposes doing so, with no communication
   surface added.
3. **Random spawns and rarity tiers.** Roadmap Phase 6 asks for rarity
   tiers and rare random drops. ADR-013 part A, `rewardTable.ts` ("no
   randomness anywhere") and CLAUDE.md pillar 7 (no loot-box mechanics)
   rule that out today. Phase 6 needs either a redesign (random place and
   time, deterministic and non-scarce reward) or an explicit ADR-013
   amendment.
4. **"Stealing" and trading.** Already deferred by the roadmap; also
   blocked by ADR-013 (no trading).

### 4.4 Pre-existing issues noticed (not multiplayer)

- **No keyboard turning.** Looking around needs mouse pointer lock or
  touch; arrow keys strafe. A keyboard-only player cannot turn. The
  non-graphical route still works, so this is an accessibility gap, not a
  dead end.
- Lint has a backlog of `prefer-tag-over-role` warnings.
- `.tmp-verify/harness/{bay,castle,forest,harbor,tide}.ts` import scene
  modules removed in Phase 16 and no longer build. They are untracked
  scratch files.

## 5. Recommendation

Proceed to Phase 1 **after** the reviewer:

1. accepts, amends or rejects ADR-026 (transport, hosting, identity, rooms, rewards);
2. decides the party scope for the MVP (household-only is the recommendation);
3. acknowledges that the human playtest is still outstanding, and either
   runs it or approves proceeding with it documented as a blocker.

Phase 1 adds dependencies (see ADR-026), so it should not start without
that approval.
