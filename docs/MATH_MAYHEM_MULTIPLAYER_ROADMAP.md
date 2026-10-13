# Math Mayhem: Multiplayer-First Implementation Roadmap

**For Claude Code**  
**Baseline:** Generic 3D Location Engine, documented 2026-10-12, commit `d344c0f`  
**Objective:** Deliver the smallest playable cooperative Three.js experience using the existing engine, then expand it into Math Mayhem Island.

## Instructions to Claude

1. Inspect the actual repository before editing. Treat `engine_overview.md` as the documented baseline, not proof that every implementation detail still matches HEAD. Read `CLAUDE.md`, `docs/DECISIONS.md` (especially ADR-008 and ADR-025), `docs/IMPLEMENTATION_STATUS.md`, the phase plan and acceptance tests. Check the current branch and git status; do not discard existing changes.
2. Make an implementation branch such as `feature/math-mayhem-multiplayer-foundation`. Work in the existing app. Do **not** create a separate Three.js application, duplicate the location engine, or introduce region-specific branches in shared runtime code.
3. Preserve the separation: `createLocationEngine` renders and emits semantic events; the view and existing Adventure, Quest, Discovery, NPC, Rewards, and World State layers interpret and persist outcomes. The multiplayer server must validate shared actions and rewards, but must not move educational grading into the Three.js renderer.
4. Implement and test **one phase at a time**. After each phase, report files changed, migrations/configuration, test results, manual verification, and remaining blockers. Do not start the next phase until the current phase's acceptance criteria pass or the user explicitly approves proceeding with a documented blocker.
5. Prefer additive changes, dependency injection, feature flags, and registered extensions. Maintain backward compatibility for all six existing regions and their non-multiplayer behavior.
6. Do not assume multiplayer, math adaptation, third-person avatars, or published database manifests already exist. Inspect first and document any verified existing capability.

## Architecture constraints from engine overview

- One route: `/island/:childId/explore/:regionId`, via `LocationWorldPage`.
- One shared view: `runtime/ThreeLocationWorldView.tsx`.
- One runtime: `runtime/createLocationEngine.ts`.
- Region content: `ThreeLocationManifest` v1, validated by `validateLocationManifest`, loaded by `LocationManifestRepository`.
- Extensions: scene `WorldExtension` and view `LocationViewExtension`, registered in their registries; assets declared via `assetIds`.
- Semantic event bus: `WorldEngineEventBus`; manifest interactions and `adventureBindings` determine meaning.
- Asset IDs resolve through the existing asset catalogue/resolver; no hard-coded S3/CloudFront/Amplify URLs.
- Source-controlled checkpoints remain authoritative until the published checkpoint catalogue gap is resolved.
- Admin authoring phases 11–15 are unfinished; they are **not prerequisites** for this prototype.
- The 2D Phaser routes remain separate; do not remove them.

## Target architecture

```text
Existing React / ThreeLocationWorldView
  -> Existing createLocationEngine (Three.js)
  -> Multiplayer client adapter (new, reusable)
       -> authenticated WebSocket transport
            -> authoritative room server (new)
                 -> room membership / positions / events
                 -> cooperative objective state
                 -> authoritative spawn and claim decisions
                 -> validated reward transaction boundary
  -> Existing Adventure / Quest / Rewards / Inventory services
  -> Existing manifest repository and registered extensions
```

**Technology decision:** Evaluate Colyseus (Node.js/TypeScript) as the room server and ECS/Fargate as a possible deployment, but record the decision and trade-offs before adding dependencies. An equivalent solution is acceptable if it better fits existing infrastructure. The room server is separate from the Three.js render loop; do not write every position update to DynamoDB.

## Phase 0 — Verify the existing engine before changing it

**Goal:** Establish a known-good human-played baseline.

Tasks:
- Read engine documentation and inspect the six shipped manifests and `runtime/testing/testExplorerCove.ts`.
- Run install/build/typecheck/lint/tests using repository-standard commands; record exact results.
- Manually run at least one existing region in a desktop browser and one supported touch/tablet configuration if available. Verify movement, camera, NPC interaction, collectibles, checkpoint persistence, and navigation. If physical testing is unavailable, document the gap and do not claim it passed.
- Confirm current auth, child profile, identity/permissions, inventory, reward APIs, and adventure session semantics.
- Write a short architecture decision covering multiplayer transport, server hosting, world instance ownership, player identity, and persistent rewards.

**Acceptance:** Existing regions are not regressed; baseline findings and blockers are documented. No new island features required.

## Phase 1 — Reusable multiplayer room foundation

**Goal:** Two authenticated test clients can connect to the same room without changing the existing single-player engine behavior.

Tasks:
- Add a reusable multiplayer client service with connect/disconnect/reconnect, room join/leave, transport abstraction, typed events, and connection states.
- Add an authoritative room server proof of concept with room IDs, region IDs, instance capacity (initial target 12), presence, heartbeats, disconnection cleanup, and server-side authorization.
- Validate identity using the existing Cognito/Amplify authentication flow; never trust a childId, display name, or room membership supplied only by the client.
- Provide isolated development configuration and secure production configuration. Document allowed origins, TLS, token expiration, reconnect behavior, and rate limits.
- Keep rooms in memory for the prototype; specify what is and is not persisted. Do not accidentally persist sensitive player telemetry.
- Gate all multiplayer behavior behind a feature flag. Existing regions default to single-player.

**Acceptance:** Two independent browser sessions join one room; one leaving updates presence; unauthorized connections fail; reconnect does not create duplicate player entities; existing region tests still pass.

## Phase 2 — Render and synchronize remote players in Three.js

**Goal:** Children see other players moving inside the existing generic 3D engine.

Tasks:
- Introduce a generic remote-player presentation adapter or registered scene extension; no `if (regionId === 'math-mayhem')` checks in core runtime.
- Send bounded, rate-limited movement inputs or state updates to the authoritative server; validate positions, speed, and world bounds. Choose and document the movement authority model.
- Replicate position, rotation, basic animation state, joins, and departures. Smooth remote motion through interpolation; avoid excessive network updates.
- Use placeholder avatars if modular character models are not ready. Resolve all assets through the existing catalogue.
- Ensure remote players cannot trigger local NPC interactions, checkpoints, collectible pickups, or quest progress merely by appearing nearby.
- Add graceful handling for latency, disconnects, and missing avatar assets.

**Acceptance:** Two clients see each other moving in the same Three.js scene, without duplicate models or movement-triggered reward exploits. Existing single-player controls still work.

## Phase 3 — Safe world joining and parties

**Goal:** Players can deliberately join a cooperative session.

Tasks:
- Implement private invite-only rooms first, using approved-friend relationships only if the repository already supports them; otherwise implement a safe parent/tester-controlled invite mechanism and document the dependency.
- Add party creation, join/leave, party leader transfer, room capacity, and reconnect grace period.
- Define a future public matchmaking interface, but **do not enable public child matchmaking by default** without privacy, moderation, parental control, and abuse-response review.
- Expose predefined signals/emotes only; no unrestricted text or voice chat in this milestone.
- Prevent real names, contact details, precise location, and sensitive profile fields from being sent to other clients.

**Acceptance:** Two approved test accounts can join the same private party; unauthorized users cannot join; party state survives brief reconnects according to documented rules.

## Phase 4 — First cooperative quest: Dragon Egg Vault

**Goal:** Ship a complete playable cooperative loop before building a large island.

Scenario:
1. Two to four players enter a small source-controlled test region (or a compact Math Mayhem region).
2. They see one shared dragon egg vault and two to four crystals.
3. Each player activates a crystal and completes a challenge or assistance interaction.
4. The server confirms all required contributions and broadcasts the vault-opening event.
5. Every eligible participant receives one individual reward, exactly once.

Tasks:
- Add a source-controlled region manifest and its checkpoints; register it in `SOURCE_LOCATION_MANIFESTS`. Reuse existing assets where possible.
- Implement the cooperative vault as a registered scene/view extension, using the engine's semantic events and existing adventure bindings.
- Represent cooperative state on the server with a deterministic state machine: WAITING -> ACTIVE -> COMPLETE (plus ABORTED/EXPIRED if needed).
- Support solo fallback with NPC assistance and dynamic scaling for two to four players; do not strand a child if a teammate leaves.
- Validate contributions on the server. Ensure idempotent, authorized rewards through the existing Rewards/Inventory services and durable transaction identifiers.
- Keep grading and durable progression out of the Three.js runtime.

**Acceptance:** Two clients cooperate to open the vault, both receive exactly one persistent prize, reconnect/replay cannot duplicate rewards, and solo fallback works.

## Phase 5 — Adaptive math challenges

**Goal:** Make math integral to the quest without creating unfair competition.

Tasks:
- Inspect existing skill/adventure engines for adaptive difficulty; reuse verified capabilities rather than inventing a second progress system.
- Implement validated arithmetic/pattern question templates, deterministic answer checking, hints, and accessible input controls.
- Select questions per player using their existing skill progression where available. Avoid exposing skill level to other players.
- Allow retry/hints without forfeiting the core cooperative reward. Use server-side validation and anti-replay controls.
- Track meaningful learning progress through the existing domain services, not per-frame game state.
- Test multiple skill levels contributing to the same vault.

**Acceptance:** A beginner and advanced player complete equivalent cooperative roles using different appropriate problems; both receive the same guaranteed core reward; incorrect answers cannot be forged into successes.

## Phase 6 — Shared dynamic collectible spawning

**Goal:** Introduce exciting, server-authoritative world events reusable by all islands.

Tasks:
- Add a reusable spawn service and extension with spawn tables, rarity tiers, active limits, expiration, deterministic IDs, and region-specific placement configuration.
- Server decides when an item spawns and who may claim it; clients only render spawn/despawn and submit interaction requests.
- Add common, uncommon, rare, and special-event collectibles, with explicit rarity configuration and fairness constraints.
- Add reveal animations, effects, inventory updates, and replay-safe claims.
- Keep the main learning path independent of extremely rare random drops.

**Acceptance:** Two players see the same spawn at the same place; conflicting claims are resolved once; rewards persist exactly once; configuration can be reused in a second test region without engine branching.

## Phase 7 — Expand into Math Mayhem Island

**Goal:** Turn the validated prototype into an explorable, replayable island.

Tasks:
- Author the full Math Mayhem manifest, using the existing location/region taxonomy and navigation conventions.
- Add Central Plaza, Dragon Vault, Treasure Forest, Player Bases (initially display-only), and Obstacle Tower.
- Add at least two more adventures using the same quest, reward, multiplayer, and spawn infrastructure.
- Consider an **optional** third-person camera as a separate generic engine capability; do not block the multiplayer MVP on it.
- Add performance budgets, asset streaming/LOD, and mobile/touch testing before increasing room size.
- Defer open trading, permanent stealing of possessions, open chat, and monetization.

**Acceptance:** Math Mayhem runs on the standard route and generic engine; no duplicate runtime or special region branches; its shared mechanics are configurable for Pirate Bay or Dragon's Sanctuary.

## Cross-cutting tests and quality gates

- Maintain existing manifest validation, JSON round-trip, extension asset declarations, and `noLocationBranching` checks.
- Unit-test room state transitions, auth rejection, movement validation, event idempotency, quest contribution, reward issuance, and spawn conflict resolution.
- Integration-test two clients joining, moving, completing the vault, reconnecting, and leaving.
- Test high latency, dropped connections, duplicate events, stale sessions, and server restarts.
- Ensure keyboard, touch, readable text, audio alternatives, calm-stop, and non-graphical exit remain available.
- Keep child safety and privacy as release gates; do not silently expose public multiplayer.
- Track room capacity, latency, message rate, memory usage, and server costs with minimal, privacy-preserving telemetry.

## Explicitly out of scope for first playable milestone

- Full island art production and dozens of quests.
- Admin authoring phases 11–15.
- Replacing the manifest repository with database publishing.
- Rewriting Adventure/Quest/Rewards/World State engines.
- Public matchmaking, open chat/voice, player-to-player trading, permanent stealing.
- Mandatory third-person mode.
- Production scaling to thousands of concurrent users.

## Definition of first playable MVP

Two authenticated, approved players open the same existing-engine Three.js region, see each other's avatars, approach a shared dragon egg vault, complete individually appropriate challenges, watch the same vault opening, and each receive a persistent dragon collectible once. One player can disconnect without corrupting the other player's quest. Existing six regions still function.

## Required Claude output after each phase

1. Brief architecture/implementation summary.
2. Exact files changed and any configuration or infrastructure added.
3. Commands run and results (tests, lint, typecheck, build).
4. Manual steps to verify in two browser sessions.
5. Security/privacy implications and unresolved blockers.
6. Recommendation whether to proceed to the next phase.

**Start now with Phase 0 only.** Do not implement later phases until Phase 0 findings are reviewed.
