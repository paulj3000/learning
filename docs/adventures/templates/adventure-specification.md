# Adventure Specification: `<adventure name>`

- **Status:** `<Draft | In review | Owner approved>` (template version 1, governed by [`docs/adventures/adventure-standard.md`](../adventure-standard.md))
- **Owner:** Project owner
- **Last reviewed:** `<YYYY-MM-DD>`

> **How to use.** Copy this file, replace every `<placeholder>`, and keep every section: write
> `Not applicable: <reason>` rather than deleting one. Do not invent data, evidence or results;
> write `<TBD: owner decision>` for anything undecided and list it in section 25. Every adventure
> consumes the shared managers (Asset Library, NPC Manager, Sound Manager, quest engine, play
> services, movement controller, and the shared jump controller where jumping is used); a specification that proposes a replacement is
> rejected. Read [`adventure-standard.md`](../adventure-standard.md) and the standards linked in
> each section first.

## 1. Identity

| Field | Value |
|---|---|
| Adventure title (child-facing) | `<title>` |
| Adventure kind | `<primary / step adventure>` |
| Ticket prefix | `<e.g. TR-, FP-, SC-R, NP->` |
| Step adventure slugs (`catalog.Adventure`), if any | `<slugs, or none>` |
| Adventure template id (sent with every AI request) | `<template id>` |
| Trello card(s) | `<card id and title>` |
| Branch | `<branch name>` |
| Agent or author | `<agent id or name>` |
| Related ADRs | `<ADR-NNN, ...>` |
| Status label | `<Proposed | Approved future | Pending merge | Implemented (main)>` |

## 2. Realm and Place

| Field | Value |
|---|---|
| Realm (Island, `catalog.World`) | `<island slug>` |
| Place (`catalog.Location`) | `<place slug>` |
| 3D Area (`regions.WorldRegion`) | `<region id or none>` |
| Launch point (`regions.AdventureLaunchPoint`) | `<launch object or none>` |

## 3. Age bands

| Age band | Supported? | Session length target | Interaction depth | Reading load | Response modes |
|---|---|---|---|---|---|
| Sprouts (3 to 4) | `<yes/no>` | `<minutes>` | `<one-step>` | `<pictures/narration>` | `<modes>` |
| Pathfinders (5 to 6) | `<yes/no>` | `<minutes>` | `<steps>` | `<level>` | `<modes>` |
| Explorers (7 to 8) | `<yes/no>` | `<minutes>` | `<stages>` | `<level>` | `<modes>` |

Session length is a design target only; there are no play-time limits (ADR-053).

## 4. Learning objectives

Standard: [`educational-content-standard.md`](../educational-content-standard.md)

| Objective code (`LearningObjective`) | Exists in catalog? | Evidence recorded by | World consequence |
|---|---|---|---|
| `<code>` | `<yes / to be exported>` | `<ChallengeAttempt / step / quest objective>` | `<WorldChange key>` |

## 5. Story

- Child-facing goal: `<one sentence>`
- Beginning: `<setup>`
- Middle: `<problem the child solves>`
- End: `<visible consequence in the island>`
- Tone notes: `<warm, encouraging; no shame or fear>`

## 6. Environment

- Layout source: `<TypeScript manifest / seed file; spatial layout is not Django-administered (LAI-0805)>`
- Key zones and landmarks: `<list>`
- Lighting, quality tier notes: `<notes>`

## 7. NPCs

Standard: [`npc-standard.md`](../npc-standard.md)

| `npc_id` | Role | Dialogue mode (`AUTHORED`/`HYBRID`/`AI`) | Triggers used | Voice profile | Authored fallback |
|---|---|---|---|---|---|
| `<npc id>` | `<role>` | `<mode>` | `<triggers>` | `<profile or none>` | `<where>` |

## 8. Quests

Standard: [`quest-standard.md`](../quest-standard.md). One quest specification per quest.

| Quest slug | Stages | Offered by | Completion consequence | Spec |
|---|---|---|---|---|
| `<slug>` | `<count>` | `<npc id or launch>` | `<WorldChange / reward>` | `<path to quest spec>` |

## 9. Challenges

Standard: [`challenge-standard.md`](../challenge-standard.md). One challenge specification per challenge type.

| Challenge id | Objective | Source (`ChallengeSpec` / Question Studio pool / step) | Correctness owner | Spec |
|---|---|---|---|---|
| `<id>` | `<code>` | `<source>` | `<Django function>` | `<path to challenge spec>` |

## 10. Movement and jumping

Standard: [`jumping-standard.md`](../jumping-standard.md). Jumping is a shared engine capability an
adventure may enable; it is not required (Storykeeper Castle and the Storybook adventures do not
need it). The shared movement and jump controller is pending merge on open branches; use it,
never a local one.

| Field | Value |
|---|---|
| Uses jumping? | `<yes / no>` |

If **no**, write `Not applicable: adventure does not use jumping` for the jump tables below. If
**yes**, complete them: every required step keeps an accessible non-jump route, recovery is safe,
no progress is lost and nothing is timed.

| Element | Jump required? | Accessible non-jump alternative | Fall or miss recovery | Learning progress kept? |
|---|---|---|---|---|
| `<platform / obstacle>` | `<optional / never required>` | `<ramp, path, button, assisted move>` | `<safe respawn point>` | `<yes>` |

| Field | Value |
|---|---|
| Meaningful jump route(s) | `<named route(s): what jumping reaches (shortcut, optional collectible, elevated view, secret)>` |
| Controls and camera checks | `<keyboard and touch (required), gamepad where the shared input supports it; Jump and camera buttons cover no other control; first- and third-person checked>` |
| Branch dependency (shared movement stack) | `<branches this stacks on, e.g. feature/interactive-platforms; or merged to main>` |

| Age band | Jump difficulty (gap sizes, heights, platform speed, jumps in a row) | Within controller limits? |
|---|---|---|
| Sprouts (3 to 4) | `<single low hops onto wide surfaces, optional only; or not supported>` | `<yes>` |
| Pathfinders (5 to 6) | `<difficulty>` | `<yes>` |
| Explorers (7 to 8) | `<difficulty>` | `<yes>` |

- Forced timers on movement: none.
- Collision source: `<authored zones / collision profiles (pending merge)>`

## 11. Collectibles

| Item id (`ItemDefinition`) | Collectible set | Where found | Granted by (server) |
|---|---|---|---|
| `<item id>` | `<set id>` | `<location>` | `<reward rule / pickup>` |

## 12. Scoring and rewards

Standard: [`scoring-standard.md`](../scoring-standard.md)

- Reward rules (`RewardRule`): `<rule ids>`
- What is never done: no public leaderboards, loot boxes, anxiety streaks, or loss of earned rewards.
- Effort recognition: `<how effort and retries are celebrated>`

## 13. Audio

Standard: [`audio-standard.md`](../audio-standard.md)

| Cue id | Channel | Event and target | Positional? | Visual equivalent |
|---|---|---|---|---|
| `<channel.group.name>` | `<channel>` | `<event on target>` | `<flat / positional>` | `<visual cue>` |

- Music states used: `<exploration, puzzle, victory, ...>`
- Speech: `<none / authored lines / NPC nodes>`; captions always shown.

## 14. Accessibility

Standard: [`accessibility-standard.md`](../accessibility-standard.md)

- Touch targets, keyboard path, screen reader labels: `<plan>`
- Reduced motion behaviour: `<plan>`
- Pre-reader path (Sprouts): `<plan>`
- Sound-off path: `<plan>`

## 15. Failure recovery

| Failure | Child-facing behaviour | Progress effect |
|---|---|---|
| Wrong answer | `<encouraging retry, hint>` | `<none lost>` |
| Fall or missed jump (if jumping is used) | `<safe recovery>` | `<none lost>` |
| Asset fails to load | `<bundled fallback / placeholder>` | `<none>` |
| AI unavailable | `<authored fallback>` | `<none>` |
| Network or Django error | `<calm message, retry>` | `<none lost>` |
| Child leaves mid-adventure | `<resume rule>` | `<what is kept>` |

## 16. Replayability

- What varies on replay: `<seeded challenges, pool selection, dialogue variation>`
- What stays the same: `<rules, objectives>`
- Return-visit behaviour: `<NPC on_return_visit lines, new optional content>`

## 17. Progress persistence

| Data | Model | Written by |
|---|---|---|
| Session | `<AdventureSession / region session>` | `<service>` |
| Answers and evidence | `ChallengeAttempt`, `SkillEvidence`, `SkillProgress` | `<service>` |
| Quest state | `QuestProgress` | `<service>` |
| World consequence | `WorldChange` | `<service>` |
| Inventory | `<inventory model>` | `<service>` |

Content pinned at session start: `<which revisions are pinned>`

## 18. Parent-facing summary

- Skills summarized: `<objective codes>`
- Evidence wording: `<from verified session evidence only; no raw transcripts>`
- World change described: `<text>`

## 19. Assets

Standard: [`asset-standard.md`](../asset-standard.md)

| Asset id or pin | Kind | Source and licence | Ledger row needed? | Fallback or placeholder |
|---|---|---|---|---|
| `<asset id>` | `<kind>` | `<source, licence>` | `<yes/no>` | `<fallback>` |

New binary files committed to Git: `<none / list with the policy or owner approval that allows each>`

## 20. Performance budget

No project-wide budget is approved; state this adventure's targets and how they are measured.

| Metric | Target | Measured on | Result |
|---|---|---|---|
| Frame rate | `<target>` | `<device>` | `<to be measured>` |
| Total download for first play | `<target>` | `<method>` | `<to be measured>` |
| Draw calls / triangles in view | `<target>` | `<method>` | `<to be measured>` |
| Time to interactive | `<target>` | `<method>` | `<to be measured>` |

## 21. Dependencies

| Dependency | Type (ticket, branch, ADR, gate) | State |
|---|---|---|
| `<item>` | `<type>` | `<merged / pending merge / open>` |

## 22. Shared components used

| Component | Used for | Extension needed? (requires its owner's approval) |
|---|---|---|
| Asset Library (`apps/assets`, `djangoAssetResolver`) | `<use>` | `<no / describe>` |
| NPC Manager (`apps/npcs`, `features/npc-manager`) | `<use>` | `<no / describe>` |
| Sound Manager (`react/src/audio`, `apps/audio`, `apps/speech`) | `<use>` | `<no / describe>` |
| Movement controller; jump controller if jumping is used (pending merge) | `<use>` | `<no / describe>` |
| Quest engine and play services (`quests`, `game_sessions`, `progression`, `inventory`) | `<use>` | `<no / describe>` |
| Education (`ChallengeSpec`, `grade_answer`, Question Studio pools) | `<use>` | `<no / describe>` |
| AI pipeline (`apps/ai`) | `<use or none>` | `<no / describe>` |
| Location engine and manifests | `<use>` | `<no / describe>` |

## 23. Testing

- Unit and API tests (by path): `<paths>`
- Authorization tests (child scoping, another family's child 404): `<paths>`
- Age adaptation tests: `<paths>`
- AI validation and fallback tests: `<paths>`
- Owner manual QA (browser, tablet, audible): `<list; never claimed as done by an agent>`

## 24. Acceptance criteria

1. `<criterion, testable>`

## 25. Owner decisions

| Decision needed | Options | Recommendation | Decision and date |
|---|---|---|---|
| `<question>` | `<options>` | `<recommendation>` | `<pending>` |

## Checklist

- [ ] Every section filled or marked `Not applicable: <reason>`.
- [ ] Objectives exist in the catalog; correctness owned by Django code.
- [ ] Every age band supported has its own variant.
- [ ] "Uses jumping?" answered. If yes: shared controller, jump route(s) named, jumping never required to finish learning content, per-band jump difficulty within controller limits, accessible non-jump route and safe recovery for every jump.
- [ ] No timers, countdowns or forced stops; no loss of learning progress.
- [ ] Shared managers consumed; no replacement built.
- [ ] Authored fallback for every AI path, asset and service failure.
- [ ] Parent summary from verified evidence, by skill.
- [ ] Assets referenced by id; licences recorded; no unapproved binaries.
- [ ] Performance budget stated.
- [ ] Owner decisions listed, none assumed.
