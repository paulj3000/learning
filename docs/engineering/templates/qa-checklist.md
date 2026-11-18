# QA Checklist: <ticket ID or release>

> **Status:** Template
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001

Used by the owner for Owner QA ([../definition-of-done.md](../definition-of-done.md), Owner
Accepted). Tick only what was actually tested. Mark untested items "Not tested". File each failure
as a defect ([defect-report.md](defect-report.md)). Gameplay standards:
[../../adventures/README.md](../../adventures/README.md).

## Build under test

- Ticket or release: `<LAI-<AREA>-<NNN> or release ID>`
- Branch: `<branch>`
- Commit SHA: `<sha>`
- Pull request: `#<n>`

## Environment

`<local | dev | prod>`, `<URL or local setup>`, date `<YYYY-MM-DD>`, tester `<name>`

## Devices

| Device | Browser and version | Input (touch, mouse, keyboard, controller) |
|---|---|---|
| `<device>` | `<browser>` | `<input>` |

## Gameplay

- [ ] The Adventure starts from its launch point and the child-facing goal is clear.
- [ ] Each Quest step and Challenge can be completed as specified.
- [ ] Visible world consequence appears after completion.
- [ ] Exits stay reachable; the child can leave and return.

## Movement and jumping

- [ ] Walking and turning feel controlled at the target age band.
- [ ] Jumping, where in scope, works on authored obstacles only (pending merge items noted).
- [ ] No falling through the world, no stuck positions; safe respawn where in scope.

## Camera and collision

- [ ] The camera never clips into walls or loses the player.
- [ ] Collisions block where expected and do not trap the player.

## Accessibility

- [ ] Large controls, readable text, narration available.
- [ ] Reduced motion respected.
- [ ] Keyboard and touch alternatives work.

## Audio

- [ ] Music, effects and voice play at sensible levels; mute and volume settings respected.
- [ ] No overlapping or stuck sounds.

## Educational content

- [ ] Content matches the age band and learning objective.
- [ ] Correct answers are accepted and incorrect answers get a hint, never shame.
- [ ] Child-facing copy is readable aloud and has no em dashes.

## Rewards and progress

- [ ] Progress and rewards persist after reload.
- [ ] The Adventure log shows the completion.
- [ ] No XP, coins, levels, streak pressure or play-time limits.

## Parent controls

- [ ] The parent dashboard summarizes activity by skill.
- [ ] Parent settings (voice, microphone, AI features) are respected.

## Result

- Outcome: `<Accepted | Rework required | Blocked>`
- Defects filed: `<defect IDs or None>`
- Notes: `<notes>`
- Owner approval entry added to Trello: `<yes / no, date>`
