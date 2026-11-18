# Engineering Standards

- **Status:** Mandatory policy (in effect once merged to `main` with owner approval; governance decision ADR-072, Proposed)
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-072 (engineering governance, Proposed), ADR-019, ADR-020, ADR-033
- **Canonical sources:** [`CLAUDE.md`](../../CLAUDE.md), [`AGENTS.md`](../../AGENTS.md), [`docs/DECISIONS.md`](../DECISIONS.md), [`docs/TESTING_STRATEGY.md`](../TESTING_STRATEGY.md)

This directory holds the detailed engineering policy for Learning Adventure Island: how work moves
from a requirement to a merged, approved change, and how up to five Claude Code agents work on it at
the same time without colliding. It does not restate product rules, architecture or test cadence;
it points to their canonical sources.

## Authority map

| Source | What it governs | Notes |
|---|---|---|
| [`CLAUDE.md`](../../CLAUDE.md) | Mandatory entry point for every agent session: mission, age bands, AI model, coding rules, work process (section 14), definition of done (section 15), in-effect ADR rules (sections 18 to 20) | Read first, every session |
| [`AGENTS.md`](../../AGENTS.md) | Tool-neutral agent rules (any coding agent, not only Claude) | Summary rules; points here for detail |
| `docs/engineering/` (this directory) | Detailed engineering policy: lifecycle, branches, multi-agent coordination, testing policy, security, integration, release, documentation | Policy plus pointers, not copies |
| [`docs/adventures/`](../adventures/README.md) | Adventure standards: realms, quests, challenges, jumping, scoring, accessibility, assets, NPCs, audio, educational content | Applies to every playable adventure |
| [`docs/DECISIONS.md`](../DECISIONS.md) | The single ADR log and its registry and governance rules | `npm run adr:check` validates it |
| [`docs/TESTING_STRATEGY.md`](../TESTING_STRATEGY.md) | Canonical check cadence ("When to run which checks"): what runs during development, at task completion, and at merge or release readiness | [`testing-policy.md`](testing-policy.md) summarizes and links; it never overrides this |
| Trello board "Learning Adventure Island — Master Development" | Task ownership, priority and workflow state (which agent owns which ticket, and which list it is in) | See [`trello-workflow.md`](trello-workflow.md) |
| GitHub | Code evidence: branches, commits, pull requests, CI results | Trello cards link to it; GitHub is never the place for approvals that only the owner can give in Trello or a PR review |

### Precedence when documents conflict

1. Owner decision (recorded on the Trello card, in a PR review, or in an ADR)
2. Accepted ADR in [`docs/DECISIONS.md`](../DECISIONS.md)
3. [`CLAUDE.md`](../../CLAUDE.md)
4. [`AGENTS.md`](../../AGENTS.md)
5. `docs/engineering/` and `docs/adventures/` documents with status Mandatory policy
6. Guidance and Proposed documents

An agent that finds a conflict reports it (Trello comment on the ticket, and in the handoff or
completion report) and follows the higher-ranked source. It never silently edits one document to
make it agree with another; the fix is a documentation change reviewed like any other policy
change ([`documentation-policy.md`](documentation-policy.md)).

## Reading order for a new agent

1. [`CLAUDE.md`](../../CLAUDE.md), then [`AGENTS.md`](../../AGENTS.md).
2. This README.
3. [`development-workflow.md`](development-workflow.md): the 22-step lifecycle and the stop-and-ask triggers.
4. [`multi-agent-workflow.md`](multi-agent-workflow.md): identity, claiming, locking, worktrees, handoff, recovery.
5. [`trello-workflow.md`](trello-workflow.md) and [`branch-policy.md`](branch-policy.md).
6. [`testing-policy.md`](testing-policy.md) with [`docs/TESTING_STRATEGY.md`](../TESTING_STRATEGY.md), "When to run which checks".
7. [`definition-of-done.md`](definition-of-done.md).
8. The documents your ticket touches: [`architecture-rules.md`](architecture-rules.md), [`security-policy.md`](security-policy.md), [`coding-standards.md`](coding-standards.md), and for gameplay work [`docs/adventures/README.md`](../adventures/README.md).
9. The ADR registry at the top of [`docs/DECISIONS.md`](../DECISIONS.md) and every ADR your ticket names.

## Engineering standards index

| Document | Purpose |
|---|---|
| [`README.md`](README.md) | This index, the authority map, precedence and path mapping |
| [`development-workflow.md`](development-workflow.md) | The 22-step lifecycle from requirement to authorized deployment, with actors, evidence and approval points |
| [`architecture-rules.md`](architecture-rules.md) | Architecture rules every change must respect, with pointers to the ADRs that set them |
| [`testing-policy.md`](testing-policy.md) | How the canonical test cadence applies to agents and tickets |
| [`branch-policy.md`](branch-policy.md) | Branch naming, base branches, push rules and protected branches |
| [`security-policy.md`](security-policy.md) | Child privacy, authorization, secrets, AI safety and AWS rules for engineering work |
| [`definition-of-done.md`](definition-of-done.md) | When a ticket may be called development complete, accepted, merged or deployed |
| [`coding-standards.md`](coding-standards.md) | TypeScript, Python, React, Three.js engine and Django coding conventions |
| [`multi-agent-workflow.md`](multi-agent-workflow.md) | Coordination of agents Claude-01 to Claude-05: claiming, locking, worktrees, shared files, handoff, recovery |
| [`trello-workflow.md`](trello-workflow.md) | Trello lists, card fields, comments and evidence |
| [`integration-policy.md`](integration-policy.md) | Integration branches, merge order, conflict resolution and merge readiness |
| [`release-policy.md`](release-policy.md) | Release notes, environment promotion and the owner-approved deployment gate |
| [`documentation-policy.md`](documentation-policy.md) | Document ownership, status values, naming, cross-references and deprecation |

### Engineering templates

| Template | Use |
|---|---|
| [`templates/feature-specification.md`](templates/feature-specification.md) | Structured specification of a feature (lifecycle step 2) |
| [`templates/task-specification.md`](templates/task-specification.md) | One ticket's scope, dependencies and acceptance criteria (steps 3 and 4) |
| [`templates/implementation-plan.md`](templates/implementation-plan.md) | Agent's audit findings and plan before coding (steps 8 and 9) |
| [`templates/agent-handoff.md`](templates/agent-handoff.md) | Handing a ticket to another agent or recovering a session |
| [`templates/pull-request.md`](templates/pull-request.md) | Pull request description (step 15) |
| [`templates/qa-checklist.md`](templates/qa-checklist.md) | Owner QA checklist (step 18) |
| [`templates/defect-report.md`](templates/defect-report.md) | Defect found in QA or later (step 19) |
| [`templates/release-notes.md`](templates/release-notes.md) | Release notes for an approved release |
| [`templates/completion-report.md`](templates/completion-report.md) | Agent's completion report and Trello evidence (step 14) |
| [`templates/adr.md`](templates/adr.md) | Draft text for a new section in `docs/DECISIONS.md` |

## Adventure standards index

| Document | Purpose |
|---|---|
| [`../adventures/README.md`](../adventures/README.md) | Index and reading order for the adventure standards |
| [`../adventures/adventure-standard.md`](../adventures/adventure-standard.md) | What every adventure must contain: goal, learning objective, world consequence, fallbacks |
| [`../adventures/jumping-standard.md`](../adventures/jumping-standard.md) | Jumping as standard gameplay, with an accessible non-jump route and safe recovery |
| [`../adventures/scoring-standard.md`](../adventures/scoring-standard.md) | Progress and rewards without economies, leaderboards or pressure |
| [`../adventures/accessibility-standard.md`](../adventures/accessibility-standard.md) | Accessibility requirements for playable environments |
| [`../adventures/realm-standard.md`](../adventures/realm-standard.md) | Realms, places and areas in the existing content model |
| [`../adventures/quest-standard.md`](../adventures/quest-standard.md) | Quest structure and progress |
| [`../adventures/challenge-standard.md`](../adventures/challenge-standard.md) | Challenges, deterministic grading and hints |
| [`../adventures/asset-standard.md`](../adventures/asset-standard.md) | Models, textures and licensing through the asset library |
| [`../adventures/npc-standard.md`](../adventures/npc-standard.md) | NPCs through the NPC Manager |
| [`../adventures/audio-standard.md`](../adventures/audio-standard.md) | Sound cues, spatial audio and speech through the Sound Manager |
| [`../adventures/educational-content-standard.md`](../adventures/educational-content-standard.md) | Learning objectives, age bands and content accuracy |
| [`../adventures/templates/realm-specification.md`](../adventures/templates/realm-specification.md) | Realm specification template |
| [`../adventures/templates/adventure-specification.md`](../adventures/templates/adventure-specification.md) | Adventure specification template |
| [`../adventures/templates/quest-specification.md`](../adventures/templates/quest-specification.md) | Quest specification template |
| [`../adventures/templates/challenge-specification.md`](../adventures/templates/challenge-specification.md) | Challenge specification template |

## Requested paths and their canonical locations

Some locations named in the governance request already have a canonical home. The existing home
wins; nothing is duplicated.

| Requested path or concept | Canonical location | Why |
|---|---|---|
| `docs/adr/` (one file per ADR) | [`docs/DECISIONS.md`](../DECISIONS.md), single log with registry | Its governance section keeps one file plus the registry; `npm run adr:check` depends on it. No `docs/adr/` directory is created |
| ADR template | [`templates/adr.md`](templates/adr.md) | Drafts a new `## ADR-NNN: Title` section for `docs/DECISIONS.md` |
| ADR working notes | [`docs/decisions_adr.md`](../decisions_adr.md) | A working note (ADR-027), not the log |
| Testing standard or test cadence | [`docs/TESTING_STRATEGY.md`](../TESTING_STRATEGY.md) | Canonical "When to run which checks"; [`testing-policy.md`](testing-policy.md) only applies it |
| Definition of done | [`CLAUDE.md`](../../CLAUDE.md) section 15 | [`definition-of-done.md`](definition-of-done.md) expands it per workflow state |
| Architecture overview | [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) | [`architecture-rules.md`](architecture-rules.md) lists the binding rules only |
| Content hierarchy (realm, place, area) | [`docs/platform/CANONICAL_CONTENT_MODEL.md`](../platform/CANONICAL_CONTENT_MODEL.md), [`docs/engine/02_CONTENT_MODEL_STRATEGY.md`](../engine/02_CONTENT_MODEL_STRATEGY.md) | Adventure standards reference, never redefine, the model |
| Security and privacy | [`docs/THREAT_MODEL.md`](../THREAT_MODEL.md), [`docs/PRIVACY_AND_SAFETY_REVIEW.md`](../PRIVACY_AND_SAFETY_REVIEW.md), [`docs/AUTHORIZATION_REVIEW.md`](../AUTHORIZATION_REVIEW.md), [`docs/AI_AND_CHILD_SAFETY.md`](../AI_AND_CHILD_SAFETY.md) | [`security-policy.md`](security-policy.md) states the engineering rules and links these |
| Task list and ownership | Trello board; roadmap ids also in [`tasks/TASK_TRACKER.md`](../../tasks/TASK_TRACKER.md) | Trello is the workflow state; the tracker keeps roadmap task history |
| Project status | [`docs/IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md) | Updated by every completed task (CLAUDE.md section 14) |
| Migration plan and APPROVAL tasks | [`docs/DJANGO_MIGRATION_ROADMAP.md`](../DJANGO_MIGRATION_ROADMAP.md) | APPROVAL markers are stop points |
| Deployment procedures | [`docs/platform/DJANGO_EC2_DEPLOYMENT.md`](../platform/DJANGO_EC2_DEPLOYMENT.md), [`docs/infrastructure/deployment-design.md`](../infrastructure/deployment-design.md) | [`release-policy.md`](release-policy.md) adds the approval gate |
| Pull request template | [`templates/pull-request.md`](templates/pull-request.md) | No `.github` pull request template exists today |
