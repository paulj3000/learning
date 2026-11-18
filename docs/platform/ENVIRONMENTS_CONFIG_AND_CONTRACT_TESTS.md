# Environments, Generated Config, and Cross-Platform Contract Tests (Phase 42)

Covers `docs/android/android.md` Phase 19 ("Environment Strategy"), Phase
20 ("Generated Client Configuration"), and Phase 21 ("Cross-Platform
Contract Tests"), scoped per ADR-017 in `docs/DECISIONS.md`. **No
production code, CI, or deployment configuration changes this phase.**
Creating or deploying an environment is an infrastructure action with
real AWS cost and access-control consequences — the kind of change this
project's own operating rules reserve for an explicit, human-authorized
decision, not something to take unilaterally while documenting a roadmap
phase. This document records what exists, what is genuinely missing, and
what a human would need to decide before any of it is built.

**Updated for the current platform.** The environment and configuration
model below is the Django + CDK one (`docs/ARCHITECTURE.md`, "Environment
strategy"; `docs/infrastructure/deployment-design.md`).

## 1. Environment strategy: CDK stages, not branches

`docs/android/android.md` Phase 19 wants development/staging/production
environments, mapped so a development build can never reach production
data. The environments are AWS CDK stages in `infra/`: `infra/bin/app.ts`
accepts exactly two names, `dev` and `prod` (`npm run infra:synth:dev`,
`npm run infra:synth:prod`), and each stage gets its own stacks
(`LaiDjangoEc2-<env>`, `LaiAssetStorage-<env>`, `LaiChildPhotos-<env>`,
`LaiAiGuardrail-<env>`, `LaiFrontend-<env>`), its own PostgreSQL database
and its own S3 buckets. Local development runs React (Vite) against Django
and PostgreSQL in Docker with fake AI and speech providers. The low-cost
development environment is ADR-055's; production keeps ADR-037.

| android.md environment | This repo's mechanism |
|---|---|
| `development` | Local Docker stack, and the CDK `dev` stage (deployed only with owner approval) |
| `staging` | Not defined. `infra/bin/app.ts` refuses any stage other than `dev` or `prod`; adding one is an owner decision |
| `production` | The CDK `prod` stage (deployed only with owner approval) |

Infrastructure code existing is not the same as deployed: which stages
are live, and whether a `staging` stage is ever added, are
deployment-topology decisions for the owner, not something a
documentation pass can decide on their behalf.

## 2. Client configuration: build-time variables, no generated file

`docs/android/android.md` Phase 20 wants clients to avoid hand-maintained
duplicated identifiers. The web client reads three build-time variables:
`VITE_COGNITO_USER_POOL_ID` and `VITE_COGNITO_CLIENT_ID`
(`react/src/lib/cognito/config.ts`; the region is the pool id's prefix)
and `VITE_DJANGO_API_BASE` (`react/src/api/apiBase.ts`; empty means
same-origin, otherwise an `https://` origin, refused at build time if
invalid). The site release workflow supplies them per environment. There
is no generated configuration file and no S3 bucket name in the client:
every bucket is reached only through Django.

An Android client needs the same three values for its environment (the
Cognito pool and app client it signs in with, and the Django API origin);
the API itself is the `/api/v1/` contract in `docs/ARCHITECTURE.md`
("Django API conventions") and `docs/android/ANDROID_API_CONTRACT.md`.

## 3. Cross-platform contract tests: nothing to test yet; largely already covered in spirit by Phase 40's audit

`docs/android/android.md` Phase 21 wants release-blocking integration
tests proving a write on one client is visible on the other, across auth,
child profiles, learning, inventory, quests, and world unlocks. None can
be written today — there is no second client. But the *underlying claim*
these tests would check ("a write through the backend API is visible to any
other authenticated caller reading the same owner-scoped data") is the
same claim `docs/platform/DEVICE_SYNC_AND_OFFLINE_SAFETY.md` (Phase 40)
already audited for cross-device sync, structurally: every model is
already `SHARED_DATA` with zero client-side caching, so *any* two callers
authenticated as the same parent already see consistent state on their
next read, regardless of what client either of them is. A future
Android contract-test suite would be exercising that same, already-true
structural property against a real second client for the first time — not
discovering a new one.

Target test list, for whenever a real second client exists to write it
against (this table doubles as the "web-writes-Android-reads and the
reverse" pairing android.md's own Phase 21 asks for):

| Area | Would exercise |
|---|---|
| Authentication | A Cognito account created via one client signs in successfully via the other; the resolved identity (`sub`) matches |
| Child profiles | `ChildProfile.create()` on one client is visible via `.list()`/`.get()` on the other; an update to a permitted field (nickname, etc.) propagates |
| Learning | `submitAdventureAnswer` (Phase 37) called from one client advances `AdventureSession.currentStepId`, visible to the other on its next read |
| Inventory | `ChildInventory.ownedItemIds`, granted via `grantRewards` on one client, is visible on the other |
| Quests | `ChildQuestState` status/stage, advanced via `syncQuestProgress` on one client, is visible on the other |
| World unlocks | A `WorldChange` row written on one client is visible on the other, and `isLocationUnlocked`/`reachableWorldSlugs` (pure functions, already shared) compute the same unlock state from it regardless of which client reads it |

**Not written this phase**: any of the above, since there is no Android
client (or even a second web session under automated control) to run them
against. `docs/TESTING_STRATEGY.md`'s existing "Backend tests" invariants
and `docs/AUTHORIZATION_REVIEW.md` section 5's live-backend checklist
already cover the single-client version of most of these; extending them
to a genuine second-client pairing is real, valuable follow-up work for
whenever Phase 45's Android Readiness Gate is actually approached, not
before.

## 4. What this document does not do

- It does not create or deploy any environment or AWS resource.
- It does not change `infra/` or any workflow under `.github/workflows/`.
- It does not write any cross-platform contract test, since none can run
  without a second client.
- It does not decide branch-naming or environment-promotion conventions —
  those are deployment-topology decisions for whoever operates the real
  AWS account.
