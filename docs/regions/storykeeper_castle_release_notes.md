# Storykeeper's Castle completion: release notes (SC-R12-02, DRAFT)

Status: **draft, not released, not owner accepted.** Branch `feature/storykeeper-castle-completion`.
Nothing here is merged to `main` or deployed. Every item is development complete with unit-test
evidence (`tasks/TASK_TRACKER.md`); browser, device and playtest acceptance is the owner checklist in
`storykeeper_castle_acceptance.md` section 4.

## For parents

- **A new Pathfinder mission, The Painted Words.** Children aged 5 to 6 practise rhyme, beginning
  sounds and syllables to mend a page of the Great Storybook. A replay uses a fresh set of words.
- **The Great Storybook keeps everything a child earned.** A child who finished the book before the
  new page keeps the seal; the book now shows that more pages have appeared, never that pages are
  missing.
- **Jumping is part of castle play.** Low stepping stones and pads appear in the castle's adventures.
  Jumping is never required: every answer is also on the on-screen card, and Sprouts see flat markers.
- **Characters.** Keeper Quill notices the pages a child restores, Ember the dragon visits, and
  Professor Orion looks after the Observatory.
- **Sound and narration.** Each room has its own quiet ambience. Narration uses the island's speech
  service and captions always stay on screen. Mute and volume are respected.
- **Keepsakes, the Trophy Room and the Hall of Heroes.** Keepsakes earned in castle adventures sit on
  pedestals. The guide lists the stories a child has finished. Nothing is ranked against other
  children, and nothing expires.
- **Return visits.** The castle sometimes greets a returning child with a short, authored line. It
  never asks a child to come back at a time, never counts down, and never says anything was missed.
  When AI is on, the AI only chooses which authored line to show; it writes no words. With AI off the
  castle shows the same kind of line.
- **The Writing Room in 3D (preview).** The hidden Writing Room can be explored in the new 3D view
  once the Secret Door story is finished. The previous version stays available.

## For the team

| Area | Change | Evidence |
| --- | --- | --- |
| SC-R04-05 to 08 | The Painted Words, page states, completion UI, versioned completion (`GREAT_STORYBOOK_RESTORED_V2`) | Tracker entries |
| SC-SEC-01 | Protected world-change keys; generic POST and quest PUT refuse unproven claims | `docs/security/WORLD_CHANGE_INTEGRITY.md` |
| SC-JMP | Shared platforms runtime in every primary castle adventure | ADR-063; `storykeeper_castle_jumping_inventory.md` |
| SC-R05 | Quill reconcile, Ember visit, Professor Orion | Tracker |
| SC-R06 | Castle cues on the Sound Manager; narration via Django speech | Tracker |
| SC-R07 | Keepsake items and reward rules; pedestals; Hall of Heroes; ranks (off) | Tracker |
| SC-R08-01, SC-R09 | Ambient event catalog; Castle Director route `generateCastleDirector`; Quill flavour service | ADR-065 (Proposed); `docs/PLAY_API.md`; `docs/AI_AND_CHILD_SAFETY.md` |
| SC-R10-01/02 | Three.js Writing Room and parity tests; optional `entryRequirements` in the location manifest | `docs/regions/prep/writing_room_prep.md` |
| SC-R11 (engineering) | Local diagnostics (`?lai-diag=1`), disposal fixes, configurable wall height, accessibility tests | `docs/PILOT_READINESS.md` 5b |

Migrations: `ai/0006_castle_director` (route constraint), `regions/0007_castle_director`
(`CastleVisitState`, `CastleEventShown`, both child-owned and deleted with the child). No data
migration. No production data touched.

## Retirement decisions

| Item | Decision | Gate |
| --- | --- | --- |
| Phaser Storykeeper Castle world | **Kept** | ADR-020 parity, visual validation, LAI-2303 Sprouts gate, owner approval (SC-R10-03) |
| Phaser Writing Room (`world/castle-writing-room`) | **Kept as the default route** | Same; the switch is the one-line change in `AppRoutes.tsx` |
| 2D zone shim for `castle-painted-wall` | **Kept** | Removed with the Phaser castle |
| Rank titles | **Built, switched off** | Owner decision (keep or drop) |

## Known limits

- No measurements exist: tablet frame time and load time are blank until SC-R11-01.
- No keepsake GLBs exist; pedestals show primitive placeholders (ADR-028 art follow-up).
- Quill flavour has no client surface; the ambient line has no 3D cue.
- Residual integrity risks listed in `docs/security/WORLD_CHANGE_INTEGRITY.md` (non-page adventure keys,
  some quest objective types).
- Formatting (Prettier, Ruff) and the full suites run at merge readiness, not during this stretch.
