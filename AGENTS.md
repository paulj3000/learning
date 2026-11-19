# AGENTS.md: Operating Rules for AI Coding Agents

Status: Mandatory policy (ADR-072, accepted by the owner 2026-11-18). These standards are the final authority after the owner.
Applies to: every AI coding agent (Claude Code, Codex and others) working on Learning Adventure Island
Last reviewed: 2026-11-18

This file holds the tool-neutral rules for how an agent takes, does, hands off and finishes work.
Product rules, age bands, AI safety and the accepted architecture are in [CLAUDE.md](CLAUDE.md).
Detailed policy is in [docs/engineering/](docs/engineering/README.md) and adventure standards in
[docs/adventures/](docs/adventures/README.md).

**Relationship to CLAUDE.md.** `CLAUDE.md` says _what_ to build and the rules the product must
keep. `AGENTS.md` says _how_ an agent works. They must not contradict each other. If they appear
to, the precedence is: owner decision, then these standards (`CLAUDE.md`, this file,
`docs/engineering/`, `docs/adventures/`), then accepted ADRs in
[docs/DECISIONS.md](docs/DECISIONS.md) and every other document. An older document that conflicts
with the standards is stale and is corrected to match. Report the conflict in your handoff; do not
resolve it silently.

## 1. Roles

| Role                    | Who                                 | Decides                                                                                                                 |
| ----------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Project owner           | The human owner                     | Architecture, product, acceptance, merge and deployment. Final say on all.                                              |
| Project manager         | ChatGPT                             | Drafts specifications, Trello tickets and priorities for owner approval; directs assignment only as the owner delegates |
| Software engineer agent | Claude-01 to Claude-05 (and others) | How to implement an assigned, approved ticket inside its scope                                                          |

Agent IDs are dynamic: an ID names a working slot, not a feature. Agents from other tools get an
owner-assigned ID in the same format (for example `Codex-01`). An agent may self-claim only an
unclaimed card in **Ready for Development**. See
[multi-agent-workflow.md](docs/engineering/multi-agent-workflow.md).

## 2. Ten non-negotiable rules

1. Never modify another agent's worktree, branch or uncommitted work. Never reset, stash,
   rebase, force-push or delete it.
2. Never commit directly to `main`.
3. Never merge overlapping feature branches on your own. Integration follows
   [integration-policy.md](docs/engineering/integration-policy.md).
4. Never deploy to AWS or make live AWS calls without explicit owner authorization for that
   action. Infrastructure code work does not authorize deployment.
5. Never introduce a new architectural framework, runtime dependency or engine without owner
   approval (and an ADR when it is architectural). Amplify is retired; never reintroduce it. Add
   no features to Phaser worlds (bug fixes only until each is converted, CLAUDE.md section 19).
6. Identify every change to a shared component before implementing it, and record it in the
   ticket and handoff.
7. Document unresolved dependencies and integration risks.
8. Never mark an unverified acceptance criterion complete. Never fabricate test results.
9. Do not expand the task beyond its authorized scope. Record significant scope changes and get
   approval first.
10. Preserve existing architectural decisions. Change one only through a new ADR the owner accepts.

## 3. Starting a task

1. Read `CLAUDE.md`, this file, [docs/engineering/README.md](docs/engineering/README.md) and the
   policies and standards that apply to the ticket.
2. Confirm the Trello ticket is in **Ready for Development**, unclaimed, and has acceptance
   criteria. Claim it with the ownership block in
   [trello-workflow.md](docs/engineering/trello-workflow.md).
3. `git fetch`, record the baseline branch and SHA, create your own worktree and branch
   ([branch-policy.md](docs/engineering/branch-policy.md)).
4. Audit the code you will touch. Write an implementation plan
   ([template](docs/engineering/templates/implementation-plan.md)) that lists owned and shared
   components, dependencies and the acceptance criteria you will implement.
5. If the plan touches a coordination hotspot (the single list is "Coordination required" in
   [integration-policy.md](docs/engineering/integration-policy.md): migrations, auth, shared API
   contracts, the shared game engine, movement, jumping, collision, camera, asset resolution, NPC,
   sound, content publication, scoring, infrastructure, the ADR registry), record the planned
   change on the ticket before editing and get the owner's or coordinator's acknowledgement
   before merging.

## 4. Ownership and shared components

- You own only the files and components listed in your work-package block.
- A shared component is any module other tickets depend on (see
  [architecture-rules.md](docs/engineering/architecture-rules.md)). Changing one requires: a note
  on the ticket, a backward-compatible change or a coordinated plan, and tests for existing
  callers.
- New adventures reuse the shared services (Asset Manager, NPC Manager, Sound Manager, Question
  Studio, adventure and quest engines, scoring, progress, AI pipeline). Do not build replacements.
- Reserve an ADR number in the `main` registry before using it, using the one procedure in
  [multi-agent-workflow.md](docs/engineering/multi-agent-workflow.md).

## 5. Dependencies

- Do not add, upgrade or remove a dependency silently. Name it, the reason and the licence in the
  plan; runtime dependencies need owner approval.
- Lockfile and requirements changes are coordination hotspots.

## 6. Testing during development

Follow [testing-policy.md](docs/engineering/testing-policy.md), which restates the canonical
cadence in [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md):

- Run unit tests only, by path: pytest and Vitest (`--maxWorkers=2`), `npm run typecheck` when
  TypeScript changed, the security and privacy tests your change touches, `npm run content:check`
  when exported content sources change, and `make docs-check` when documentation changes.
- Do not run Playwright, browser automation, end-to-end or acceptance suites, live AWS checks,
  deployment tests or the full lint and format gates unless explicitly authorized.
- Report infrastructure failures separately from test failures.

## 7. Communication, blockers and handoffs

- Trello is the record of ownership, priority and state; GitHub is the record of code.
- Report a blocker as soon as it is found: what blocks, evidence, what you tried, the decision
  needed and from whom. Move the ticket to **Blocked** only with that note.
- Hand off with [agent-handoff.md](docs/engineering/templates/agent-handoff.md) whenever you stop
  before completion, a session may end, or another agent takes over.
- Agents do not message each other's worktrees. Coordinate through the ticket, the PR and the
  project manager.

## 8. Documentation

Update the documents your change affects in the same branch: architecture, schema, privacy
behaviour, operations, adventure content and `docs/IMPLEMENTATION_STATUS.md`. Follow
[documentation-policy.md](docs/engineering/documentation-policy.md). Do not create duplicate
documents.

## 9. Completing work

Your task ends at **Development Complete**
([definition-of-done.md](docs/engineering/definition-of-done.md)):

- authorized scope implemented, relevant unit tests passing, documentation updated;
- committed and pushed to your branch, PR opened when the ticket asks for one;
- known limitations, dependencies and deferred checks listed;
- Trello updated with the evidence and a
  [completion report](docs/engineering/templates/completion-report.md).

Integration, owner QA, acceptance, merge and deployment are separate gates. An agent never
records owner acceptance and never moves a ticket to **Complete**.

## 10. Prohibited actions (summary)

Committing to `main`; merging without authorization; deploying or calling live AWS without
authorization; changing deployed resources; migrating production data; touching another agent's
work; deleting ADRs; renumbering accepted ADRs; storing secrets in source, docs, fixtures or
Trello; logging child names, free text, audio or identifiers; adding open-ended child chat;
adding time limits to children's play; changing GitHub branch protection.
