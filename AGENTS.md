# AGENTS.md: Agent Contract for Learning Adventure Island

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-020, ADR-033

This is the tool-neutral contract for every AI coding agent working in this repository (Claude,
Codex and others). It is short on purpose: it may be loaded into every session. Detail lives in
[docs/engineering/](docs/engineering/README.md).

## Relationship to CLAUDE.md and docs/engineering

| Document | Role |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Claude-specific entry point and project index: mission, product, safety, scope, technology baseline |
| `AGENTS.md` (this file) | Tool-neutral agent contract: how any agent claims, isolates, builds, tests, hands off and reports work |
| [docs/engineering/](docs/engineering/README.md) | Detailed engineering policies this file summarizes |

- For project and product rules (age bands, AI safety, MVP scope, technology baseline), this file
  defers to CLAUDE.md.
- For process detail, this file defers to `docs/engineering/*` and the canonical docs it links.
- Any conflict between these documents is a defect. Report it to the owner. Until the owner
  resolves it, the stricter rule applies.

## Roles

| Role | Responsibility |
|---|---|
| Owner | Final decisions: approvals, ADR acceptance, QA acceptance, merges to `main`, deployments |
| ChatGPT | Project manager, architect, spec writer, coordinator; writes structured specs and tickets |
| Agent (Claude-01 to Claude-05, or another tool) | Implements one assigned ticket in its own worktree and branch |
| Trello | Authority for task state |
| GitHub (`paulj3000/learning`) | Authority for code evidence: commits, branches, pull requests |

## The ten rules

1. Never modify another agent's worktree.
2. Never commit directly to `main`.
3. Never independently merge overlapping feature branches. Integration is coordinated and
   owner-authorized ([integration policy](docs/engineering/integration-policy.md)).
4. No unauthorized AWS deployments and no live AWS calls. Use the fake providers for local work
   and tests. **Binding:** CLAUDE.md §18, `docs/DJANGO_MIGRATION_ROADMAP.md` principle 7.
5. No new architectural framework without approval. **Binding:** CLAUDE.md §8 (the baseline holds
   unless an ADR changes it), CLAUDE.md §19 (Three.js is the only gameplay renderer, ADR-020).
6. Identify changes to shared components before implementing them, in the implementation plan and
   on the ticket.
7. Document unresolved dependencies and integration risks on the ticket, in the handoff and in
   the pull request description.
8. Never mark an unverified acceptance criterion complete. **Binding:** CLAUDE.md §14.
9. No scope expansion beyond the authorized task without documenting it; obtain owner approval for
   significant changes.
10. Preserve existing architectural decisions. Never change an ADR's text or status; propose a new
    ADR instead. **Binding:** `docs/DECISIONS.md` registry rules 3, 6 and 7.

## Agent responsibilities

- Work on exactly the ticket you were assigned, within its stated scope.
- Read CLAUDE.md, this file, the ticket and the docs it names before starting.
- Run the initial technical audit and write an implementation plan before coding
  ([implementation plan template](docs/engineering/templates/implementation-plan.md)).
- Keep Trello and the branch current enough that another agent could resume your work.
- Report blockers immediately instead of working around them.

## Task ownership and claiming

- An agent holds one ticket at a time unless the owner says otherwise.
- A claim is valid only when the Trello card has `assigned_agent`, `branch` and `worktree` filled
  and a claim comment. Format: [trello-workflow.md](docs/engineering/trello-workflow.md).
- Never start work on a card claimed by another agent. Ask the coordinator.
- Detail: [multi-agent-workflow.md](docs/engineering/multi-agent-workflow.md).

## Worktree isolation and branch ownership

- Each ticket gets a dedicated worktree at `/Coding/learning-worktrees/<short-name>` and a
  dedicated branch created from `origin/main` (or from an integration base the ticket names).
- Record the baseline SHA (`git rev-parse HEAD`) on the ticket when the worktree is created.
- Only the owning agent commits to its branch. Read-only inspection of other branches is fine:
  `git show origin/<branch>:<path>`.
- Never stash, reset, check out, clean or commit in a worktree you do not own.
- Branch names and prefixes: [branch-policy.md](docs/engineering/branch-policy.md). Existing branch
  names are not renamed.
- Commands: [development-workflow.md](docs/engineering/development-workflow.md).

## Allowed and prohibited actions

| Allowed without further approval | Requires explicit owner approval | Prohibited |
|---|---|---|
| Read any file or branch | Merging to `main` | Committing to `main` |
| Edit files inside your own worktree within scope | Any AWS deploy, `cdk deploy`, live AWS or Bedrock call (**Binding:** CLAUDE.md §18) | Modifying another agent's worktree |
| Run targeted tests, typecheck, `npm run adr:check`, `npm run content:check`, `npm run infra:synth:dev` | Adding or upgrading a dependency (**Binding:** CLAUDE.md §13) | Reintroducing Amplify (**Binding:** CLAUDE.md §18) |
| Commit and push your own branch | Editing `.github/workflows/*` | Adding features to Phaser worlds (**Binding:** CLAUDE.md §19) |
| Draft a PR description and compare URL | A new framework, renderer, backend or data store | Deleting or changing deployed AWS resources or production data (**Binding:** CLAUDE.md §18) |
| Propose an ADR as `Proposed` with a reserved number | Accepting an ADR; any APPROVAL task in `docs/DJANGO_MIGRATION_ROADMAP.md` | Force-pushing someone else's branch; rewriting published history on a shared branch |

## File and component ownership

- The ticket lists **owned components** (you may change them freely within scope) and **shared
  components** (you must coordinate).
- Shared components requiring coordination: database models and migrations; authentication;
  shared API contracts; shared game engine; player movement; jumping and collision; camera; asset
  resolution; NPC systems; sound systems; content publication; scoring; deployment
  infrastructure.
- Architectural boundaries: [architecture-rules.md](docs/engineering/architecture-rules.md).

## Shared component modification rules

1. Name the shared component and the intended change in the implementation plan and on the
   ticket before editing it.
2. Check open branches and claimed tickets for concurrent changes to the same component.
3. Keep the change minimal and backward compatible where possible; extend the canonical
   implementation rather than adding a second one. **Binding:** CLAUDE.md §20, ADR-033.
4. List every shared component change in the handoff and the pull request
   ([pull request template](docs/engineering/templates/pull-request.md)).
5. If the change breaks another open branch, stop and escalate to the coordinator.

## Dependency management

- Do not add, remove or upgrade a package (`package.json`, `package-lock.json`,
  `requirements.txt`, `requirements-dev.txt`) without owner approval.
  **Binding:** CLAUDE.md §13 ("Do not silently introduce a new dependency").
- Request approval on the ticket with the package, version, purpose, licence and alternatives.

## Agent communication

- Communicate through the Trello card (comments and fields) and through committed handoff notes.
- Do not rely on chat history or another agent's memory; anything another agent needs must be on
  the ticket or in the repository.
- Use ticket IDs (`LAI-<AREA>-<NNN>`) and agent IDs (`Claude-01` to `Claude-05`) in every message.

## Blocker reporting

When blocked, within the same session:

1. Move the card to Blocked and add a comment: what is blocked, why, what was tried, what
   decision or input is needed, and from whom.
2. Commit and push any coherent work so far; never leave uncommitted state as the only record.
3. Do not work around the blocker by expanding scope, bypassing a gate or touching another
   agent's files.

## Handoffs

Every session that stops before completion ends with a handoff using
[docs/engineering/templates/agent-handoff.md](docs/engineering/templates/agent-handoff.md),
posted on the ticket and referenced from the last pushed commit or the PR.

## Testing requirements

- Run the development checks: targeted unit tests for changed code, typecheck when TypeScript
  changed, focused regression tests, and the security and privacy checks the change touches.
  **Binding:** [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) ("When to run which checks").
- Full suites, linting, builds, browser and WebGL checks run only at merge or release readiness,
  when explicitly requested. List them as deferred.
- Never report a test you did not run. Report infrastructure failures separately from test
  failures.
- Agent-facing summary: [testing-policy.md](docs/engineering/testing-policy.md).

## Documentation responsibilities

- Update the docs your change affects (architecture, schema, privacy behaviour, scope).
  **Binding:** CLAUDE.md §13.
- Add a dated entry for your ticket to `docs/IMPLEMENTATION_STATUS.md`. **Binding:** CLAUDE.md §14.
- Reserve ADR numbers through the registry before using them. **Binding:** `docs/DECISIONS.md`
  registry rules 2 and 7.
- Documentation rules: [documentation-policy.md](docs/engineering/documentation-policy.md).

## Completion requirements

A ticket is complete only when it passes the gates in
[definition-of-done.md](docs/engineering/definition-of-done.md). An agent can bring a ticket to
Development Complete; Integration Complete, Owner Accepted, Merged, Deployed and Complete need the
coordinator or the owner. Report completion with
[completion-report.md](docs/engineering/templates/completion-report.md), listing files created and
changed, tests run with results, deferred checks, and remaining risks. **Binding:** CLAUDE.md §14.

## Where to read next

- [development-workflow.md](docs/engineering/development-workflow.md): the 22-step lifecycle.
- [multi-agent-workflow.md](docs/engineering/multi-agent-workflow.md): concurrent agents, claims,
  work packages, recovery.
- [coding-standards.md](docs/engineering/coding-standards.md),
  [security-policy.md](docs/engineering/security-policy.md).
- [Adventure standards](docs/adventures/README.md) for gameplay content.
