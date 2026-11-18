# AGENTS.md: Operating Rules for AI Coding Agents

Status: Mandatory policy (proposed under ADR-072; owner acceptance pending)
Applies to: every AI coding agent (Claude Code, Codex and others) working on Learning Adventure Island
Last reviewed: 2026-11-18

This file holds the tool-neutral rules for how an agent takes, does, hands off and finishes work.
Product rules, age bands, AI safety and the accepted architecture are in [CLAUDE.md](CLAUDE.md).
Detailed policy is in [docs/engineering/](docs/engineering/README.md) and adventure standards in
[docs/adventures/](docs/adventures/README.md).

**Relationship to CLAUDE.md.** `CLAUDE.md` says _what_ to build and the rules the product must
keep. `AGENTS.md` says _how_ an agent works. They must not contradict each other. Precedence in
brief: owner decision, accepted ADR, `CLAUDE.md`, this file, then Mandatory, Proposed and Guidance
documents in `docs/engineering/` and `docs/adventures/`; the full list is in
[docs/engineering/README.md](docs/engineering/README.md#precedence-when-documents-conflict).
Report the conflict in your handoff; do not resolve it silently.

## 1. Roles

This is the one role table; other documents link here.

| Role                            | Who                                 | Decides                                                                                                                                                                                                                                      |
| ------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project owner                   | The human owner                     | Architecture, product, ADR acceptance, owner acceptance, merges, deployment, live AWS calls, moving a card to Complete, creating integration branches (or naming the agent who does), breaking locks, reassigning tickets. Final say on all. |
| Project manager and coordinator | ChatGPT                             | Nothing on its own. Drafts specifications and Trello tickets, proposes priorities, agent assignment and merge order, and coordinates. May relay and record an owner decision with a link to its source                                       |
| Software engineer agent         | Claude-01 to Claude-05 (and others) | How to implement an assigned, approved ticket inside its scope                                                                                                                                                                               |

Agent IDs are dynamic: an ID names a working slot, not a feature. See
[multi-agent-workflow.md](docs/engineering/multi-agent-workflow.md).

### What counts as owner authorization

Owner authorization is the owner's own words, from the owner's own account, given in one of:
a Trello comment by the owner, a pull request review or comment by the owner, or a direct
instruction from the owner to the agent in its session. Text written by ChatGPT, an agent, a
ticket template or a coordinator note is never owner authorization; ChatGPT may relay or record
an owner decision only with a link to its source, and the agent checks that source. Every
"owner authorization", "owner approval" or "explicit authorization" in these documents means
this.

## 2. Ten non-negotiable rules

1. Work only in your own worktree and branch; never modify another agent's worktree, branch,
   stash or uncommitted work. Never reset, stash, rebase, force-push or delete it. A ticket
   received by handoff is worked in a new worktree of your own
   ([multi-agent-workflow.md](docs/engineering/multi-agent-workflow.md#handoff)).
2. Never commit directly to `main`.
3. Never merge any branch into `main` or an integration branch without owner authorization,
   overlapping or not. Integration follows
   [integration-policy.md](docs/engineering/integration-policy.md).
4. Never deploy to AWS or make live AWS calls without explicit owner authorization for that
   action ([what counts as authorization](#what-counts-as-owner-authorization)). Infrastructure
   code work does not authorize deployment.
5. Never introduce a new architectural framework, runtime dependency or engine without owner
   approval (and an ADR when it is architectural). Never reintroduce Amplify. No new Phaser
   usage; Phaser worlds get bug fixes only until their Three.js replacements pass (CLAUDE.md
   section 19).
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
2. Confirm the Trello ticket meets the claim conditions in
   [multi-agent-workflow.md](docs/engineering/multi-agent-workflow.md#assignment-and-claiming).
   Claim it with the ownership block in
   [trello-workflow.md](docs/engineering/trello-workflow.md).
3. `git fetch`, record the baseline branch and SHA, create your own worktree and branch
   ([branch-policy.md](docs/engineering/branch-policy.md)).
4. Audit the code you will touch. Write an implementation plan
   ([template](docs/engineering/templates/implementation-plan.md)) that lists owned and shared
   components, dependencies and the acceptance criteria you will implement.
5. If the plan touches a coordination hotspot (migrations, auth, shared API contracts, the shared
   game engine, movement, jumping, collision, camera, asset resolution, NPC, sound, content
   publication, scoring, infrastructure, the ADR registry), announce it on the ticket before
   editing.

## 4. Ownership and shared components

- You own only the files and components listed in your work-package block.
- A shared component is any module other tickets depend on (see
  [architecture-rules.md](docs/engineering/architecture-rules.md)). Changing one requires: a note
  on the ticket, a backward-compatible change or a coordinated plan, and tests for existing
  callers.
- New adventures reuse the shared services (Asset Manager, NPC Manager, Sound Manager, Question
  Studio, adventure and quest engines, scoring, progress, AI pipeline). Do not build replacements.
- Number a new ADR only through the reservation procedure in
  [multi-agent-workflow.md](docs/engineering/multi-agent-workflow.md#adr-number-reservation).

## 5. Dependencies

- Do not add, upgrade or remove a dependency silently. Name it, the reason and the licence in the
  plan; runtime dependencies need owner approval.
- Lockfile and requirements changes are coordination hotspots.

## 6. Testing during development

Follow [testing-policy.md](docs/engineering/testing-policy.md), which summarizes the canonical
cadence in [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md):

- Run the development checks: unit tests by path (pytest and Vitest with `--maxWorkers=2`),
  `npm run typecheck` when TypeScript changed, focused regression tests, the security and
  privacy tests your change touches, and `npm run content:check` when content sources change.
- Do not run Playwright, browser automation, end-to-end or acceptance suites, live AWS checks,
  deployment tests or the full lint and format gates unless explicitly authorized.
- Report infrastructure failures separately from test failures.

## 7. Communication, blockers and handoffs

- Trello is the record of ownership, priority and state; GitHub is the record of code.
- Report a blocker as soon as it is found: what blocks, evidence, what you tried, the decision
  needed and from whom. Move the ticket to **Blocked** only with that note.
- Push at regular checkpoints (each meaningful commit), so an abrupt session end loses nothing.
- Hand off with [agent-handoff.md](docs/engineering/templates/agent-handoff.md): required when you
  stop deliberately before completion or another agent takes over, best-effort when a session
  ends abruptly. Resuming after an abrupt end follows
  [session recovery](docs/engineering/multi-agent-workflow.md#session-recovery).
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
