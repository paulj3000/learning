# Game engine package build infrastructure (`game/`, `@lai/game-engine`)

- **Status:** Proposed
- **Owner:** Project owner
- **Last reviewed:** 2026-11-19
- **Related ADRs:** ADR-020 (Accepted), ADR-072 (Accepted)
- **Related tickets:** LAI-ENG-002, GE-100, LAI-2003 (APPROVAL), LAI-2101, LAI-2102
- **Canonical sources:** [DJANGO_MIGRATION_ROADMAP](../DJANGO_MIGRATION_ROADMAP.md) Phases 20 and 21, [THREEJS_ENGINE_CONVERSION](../THREEJS_ENGINE_CONVERSION.md) section 4, [architecture-rules](../engineering/architecture-rules.md), CLAUDE.md section 19

**Proposed, not in effect.** This is the build wiring offered to LAI-2003 for the owner's
review. LAI-2003 is the APPROVAL task that fixes how `game/` is built and consumed. Nothing here
creates `game/`. The engine agent (Agent 4, `core/gameengine`) owns the package contents. This
page owns only the checks and conventions around it, which already run on `main` through
`make workspace-check` and pass for the current tree.

## 0. Verified state (2026-11-19)

`game/` now exists as `@lai/game-engine` on `core/gameengine` (`219da1b2`, baseline `fc5c71cf`)
and on every branch that merged it (`core/ge-scoring`, GE-070, Firepeak, North Pole). It follows
this proposal: private, source-first `exports`, `three` as a peer at `^0.185.1` (the same range
as `react/` and the root), `strict`, a node-environment `vitest.config.ts`, a boundary test, and
root workspaces `["game", "react"]`. The formal LAI-2003 approval is still open.

| Check | Result on each engine branch |
|---|---|
| `make workspace-check` (names, versions, lockfile, build order `@lai/game-engine` then `react`, import boundary, peer range) | Pass on all five |
| Playground only through a dynamic `import()` gated on `import.meta.env.DEV` | Pass (`react/src/app/AppRoutes.tsx`). The release build is plain `npm run build` (production mode), so the route and chunk are dropped |
| Production code importing `@lai/game-engine/debug` | Warning: `useEngineRuntime.ts` (renderer stats). A type-only import (`hostTypes.ts` on scoring) is ignored. The engine lead is moving it to `engine/` |
| CI runs engine tests | Not on `main`'s `ci.yml`; added on `integration/multi-agent-dev` as `npm run test:engine --if-present` and `engine:vectors:check` |
| Site deploys on engine changes | `game/**` added to `deploy-site.yml` paths on `integration/multi-agent-dev` (owner acknowledgement needed) |

The sections below are the original proposal and stay as the rationale.

## 1. Location and name

| Decision | Value | Why |
|---|---|---|
| Directory | `game/` at the repository root, a sibling of `react/` | Already fixed by the roadmap (LAI-2101) and the conversion doc. One location only: **no `packages/` directory** |
| Package name | `@lai/game-engine` | Scoped, private name. `scripts/check_workspace_packages.py` enforces that `game/` carries exactly this name |
| Publishing | `"private": true`, never published to a registry | Consumed only inside the repository |
| Version | `0.x.y` while the interface is unstable (section 8) | |

## 2. npm workspace integration (proposed change, LAI-2101)

```jsonc
// package.json (root): workspace order is the build order, dependencies first
"workspaces": ["game", "react"],
"scripts": {
  "test:engine": "npm run test -w @lai/game-engine",
  "typecheck": "npm run typecheck -w @lai/game-engine && npm run typecheck -w react"
}
```

```jsonc
// game/package.json (sketch; the engine agent writes the real one)
{
  "name": "@lai/game-engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "exports": { ".": "./src/index.ts" },
  "sideEffects": false,
  "peerDependencies": { "three": "^0.185.1" },
  "scripts": { "typecheck": "tsc --noEmit -p tsconfig.json", "test": "vitest run" }
}
```

```jsonc
// react/package.json: the app depends on the engine, never the reverse
"dependencies": { "@lai/game-engine": "0.1.0" }
```

- Source-first: `exports` points at TypeScript source, and Vite (bundler resolution) compiles it
  with the app. No separate build step, no `dist/`, no new bundler. Adding one later is a recorded
  decision.
- `three` is a **peer** dependency of the engine and a normal dependency of `react` (and the
  root), with the same range, so one copy of Three.js is bundled.
- After editing manifests, regenerate `package-lock.json` with `npm install` on the owning branch
  (lockfile hotspot). `make workspace-check` fails if the lockfile has no `game` entry.

## 3. TypeScript package boundaries

- `game/tsconfig.json`: `strict: true` (enforced by the check), `moduleResolution: bundler`,
  `verbatimModuleSyntax`, `noEmit`, `lib: ["ES2023", "DOM"]`, **no `jsx`** and no React types.
  `include: ["src"]`.
- `react/tsconfig.app.json` consumes the engine through the package name (workspace symlink in
  `node_modules/@lai/game-engine`), never by relative path into `../game`.
- Project references (`tsc -b`) are optional. If used, `react/tsconfig.json` adds
  `{ "path": "../game" }` and the engine sets `composite: true`. Decide in LAI-2003.

## 4. Import boundary enforcement

Two guards, one per side:

| Guard | Where | Rules | Status |
|---|---|---|---|
| `scripts/check_workspace_packages.py` (`make workspace-check`, CI step) | `game/package.json`, `game/src/**` | No dependency on or import of React, React DOM, React Router, Phaser, Amplify, AWS SDKs, `aws-jwt-verify`, Colyseus or Testing Library. No `.tsx` or `.jsx`. No relative import leaving `game/`. No import of another workspace package. `strict` on. Engine depends on no workspace. No cycles | Implemented on this branch; passes vacuously until `game/` exists |
| `react/src/test/engineBoundary.test.ts` (LAI-0203) | Engine folders still in `react/src` | No React, routing, auth, session or data-client imports | Implemented (main). LAI-2101 retargets it to `game/` and adds Django-client rules |

Engine code also never validates answers, awards progress or calls AI; it emits typed events
(ADR-020, CLAUDE.md section 19). Scoring stays in Django (GE-100 ledger). The engine may
**display** scores it is given.

## 5. Engine unit-test configuration

- Vitest, run per package: `npx vitest run --maxWorkers=2 --root game <paths>`.
- `game/vitest.config.ts`: `environment: 'node'` by default. Tests that need a DOM opt in per file
  with `// @vitest-environment jsdom`. No WebGL in unit tests: renderer-dependent code is tested
  through pure functions and fakes. WebGL and visual checks are browser validation at merge
  readiness.
- `react/vite.config.ts` keeps its own `include`. Engine tests are not double-run from `react/`.
- CI: `npm run test` at the root runs both workspaces once LAI-2101 adds `test:engine` to it.

## 6. Build dependency ordering

`python3 scripts/check_workspace_packages.py --order` prints the topological order over workspace
dependencies (today: `learning-adventure-island-react`; after LAI-2101:
`@lai/game-engine`, then `learning-adventure-island-react`). Root scripts run in that order, and
the check fails on a cycle or on any engine dependency on a workspace.

## 7. Package compatibility checks

Run by `make workspace-check` (also in `make js-check` and CI):

| Check | Fails when |
|---|---|
| Manifest exists | A listed workspace has no `package.json`; workspace globs are refused (list directories explicitly) |
| Private and named | Not `private`; new packages not `@lai/<name>` (`react` keeps its historical name) |
| Same platform | `type` or `engines.node` differs from the root |
| One version per dependency | A dependency appears in more than one manifest with different ranges (catches two Three.js copies) |
| Lockfile in sync | `package-lock.json` has no entry for a workspace |

Deferred to merge readiness (authorized): `npm run build` (bundle includes one `three`), the full
Vitest suite, and `npm run test:e2e` smoke for LAI-2102.

## 8. Development playground build support

A playground is a page that mounts the engine with a fixture `WorldDefinition`. It is not
production UI. Proposal:

- Location: `react/src/routes/dev/EnginePlayground.tsx`, registered only when
  `import.meta.env.DEV` is true, so `vite build` tree-shakes it out. No new Vite config, no new
  dependency, no new deploy artifact. The existing `vite.admin-preview.config.ts` is a separate
  bundle for Django Admin and is not reused for this.
- Fixtures: the region manifests already in `react/src/features/region-play` and
  `react/src/features/island-map/three/*Region.ts`. No network: assets resolve to `react/public/models/`.
- Ports: the worktree's slot Vite port (`make web`).
- Check at merge readiness: `npm run build` output contains no playground chunk.

## 9. Shared asset manifest compatibility

The engine consumes **resolved** asset references and never fetches manifests or calls Django.

| Producer | Today | Engine contract |
|---|---|---|
| Django asset resolver (`lai/apps/assets/resolver.py`) | Published version URL, format, collision profile (Pending merge, `0003_collision_profiles`) | Passed in by the React host |
| Region manifests (`react/src/features/region-play/regionManifest.ts`) | TypeScript manifests per region (ADR-033: layouts stay in TS until LAI-0805) | `WorldDefinition` input, validated at the boundary |
| Content export (`content/exported/manifest.json`, schema `version`) | Versioned JSON | Not read by the engine |

Rules: the engine validates its inputs at runtime (CLAUDE.md section 13); unknown optional fields
are ignored; a required-field change is a breaking change (section 10).

## 10. Versioning and release conventions

- The engine is versioned with the repository: it is released when `react/` is released
  (`deploy-site.yml`). No separate engine release.
- `game/package.json` `version` follows semver as an interface marker: **minor** for an additive
  change to exports, events or `WorldDefinition`; **major** (or minor while `0.x`) for a removal or
  a required-field change. The `react` dependency names the exact version, so a breaking bump is
  visible in the diff.
- A breaking engine change lands in the same PR as every consumer's update (one repository, no
  skew), and the PR lists the consumers touched.
- Release notes: the engine section of the release notes template
  ([release-notes](../engineering/templates/release-notes.md)).
- Deployment impact: `deploy-site.yml` does not yet list `game/**` in its paths (blocker B10). The
  LAI-2101 PR proposes adding it as an owner-approved workflow change.

## 11. Coordination with the engine agent (Agent 4)

Posted on GE-100. Requests: (1) use `game/` and the name `@lai/game-engine`, not `packages/`;
(2) do not create `game/` before LAI-2003 is approved or the owner waives it; (3) keep extraction
moves (LAI-2102) behind the feature-branch merges, or freeze those files first (integration plan,
blocker B6); (4) changes to the check's forbidden list or naming rules come back to LAI-ENG-002 as
a comment rather than an edit to the script on the engine branch.
