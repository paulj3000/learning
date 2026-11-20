# Writing Room Three.js prep (SC-R10-01/02)

Read-only prep. Phaser retirement (SC-R10-03) stays gated on ADR-020 parity, LAI-2303 and owner approval. Nothing here deletes Phaser.

## 1. What "parity" means

The Phaser room is thin. Its whole behaviour, in `react/src/features/island-map/worldObjects.ts` `CASTLE_WRITING_ROOM_INTERACTIONS`, is:
- `writing-room-desk` (DISCOVERY, TAP): SHOW_MESSAGE "You solved it, so it is yours to use..."
- `writing-room-bookshelf` (OBJECT, TAP): SHOW_MESSAGE "Shelf after shelf of blank books..."
- `writing-room-castle-exit` (LOCATION, APPROACH): NAVIGATE `world/storykeeper-castle`.

There are no NPCs, no adventure, no write action and no progress event. Chapter 3 content lives elsewhere. `story/content/theCastlesSecretDoor.ts` chapter `what-was-waiting` has three scenes: `the-room-revealed` (branches on flag `whatIsBehind`), `quill-hands-over-the-room`, and the REFLECTION `secret-door-reflection` (objective `curious-questioning`). It is rendered by `three/extensions/castleTale/CastleSecretDoorStory.tsx` through `AdventureStepCard`, and it records `THE_CASTLES_SECRET_DOOR_COMPLETE`.

So parity means:
- Same interactions, ids, messages, requirements and exit.
- Same unlock gate and same fail-closed behaviour.
- Same rewards (none new).
- Chapter 3 stays where it is.
- The room must not invent a writing activity, because a "write the first story" mechanic would be new scope and needs an owner decision.

| Feature | Phaser today | Three.js target |
|---|---|---|
| Learning objectives | None in room. `curious-questioning` and creative writing belong to chapter 3. `locations.ts` lists skills "Curiosity, Creative writing". | Unchanged. No new objective. |
| Activities | Read two messages, walk out | Same two plus exit. Optionally a "Things to do here" list (reuse `ThreeLocationWorldView`). |
| Inputs | Arrows/WASD, tap-to-walk, "Things to do here" list, location-page link | Engine controls plus the existing React overlay (`WorldActionPanel`). Keep the "Prefer not to walk?" link to `/island/:childId/locations/castle-writing-room`. |
| Progress/rewards | None recorded | None recorded. |
| Age bands | No band gate in room (the story is EXPLORER only; Sprouts keep Phaser and card route) | Same. Sprouts guided profile is a LAI-2303 question. |
| Accessibility | Panel `role="dialog"`, list alternative, instruction line | Keep panel and list. Add focusable labels per ADR-020 and the engine's focus contract. Message text unchanged. |
| Content contracts | `locations.ts` slug `castle-writing-room`, `homeIsland.ts` pack, `realmThemes.ts`, `islandNpcs.ts` schedule entry (afternoon), `CASTLE_EXITS` `writing-room` -> `locations/castle-writing-room` | Same slug and ids. Manifest `regionId` and `locationSlug` both `castle-writing-room`. |
| Completion/persistence | Unlock only via world change key; `isLocationUnlocked` shows "not discovered yet" | Same check, through manifest requirements. |

Note `islandNpcs.ts:112` schedules an NPC at this location, but the Phaser scene sets `npcs: []`. Flag this to the owner before parity. The safe reading is that the NPC is not placed, so the Three.js room places none either.

## 2. Manifest design

Round room as in the roadmap (`STORYKEEPER_CASTLE_REBOOT_ROADMAP.md` line 106): one window, desk, shelves of blank books.

- Registry: `ThreeLocationManifest` with `regionId` `castle-writing-room`, `locationSlug` `castle-writing-room`, `worldSlug` `HOME_WORLD_SLUG`, `version` 1.
- Bounds: a small interior, `halfExtentX` and `halfExtentZ` about 5 (a 10 by 10 room, approximated round by four corner colliders), with a 3.2 high wall.
- Surfaces: carpet floor, wall ring, ceiling, using the `castleVisualKit.ts` pattern.
- Environment: warm interior, one window light (`lights`), a window prop.
- Entities:
  - Desk at about (2.5, -1), bookshelves along the back arc, and the one ajar secret door at the west wall, which is also the exit.
  - Props reuse castle assets from `ASSET_MANIFEST`. A missing model falls back to the engine placeholder.
- Zones: `writing-room-castle-exit` (west door), `writing-room-desk`, `writing-room-bookshelf`, each as a `RectZone` keyed by interaction id (Phaser keys zones the same way).
- Interactions: reuse `CASTLE_WRITING_ROOM_INTERACTIONS` verbatim (same ids, messages, `requirements`).
  - Change the exit action to `NAVIGATE` `explore/storykeeper-castle` only if `WorldActionPanel` resolves it like other converted regions. Otherwise keep `world/storykeeper-castle`, which the legacy redirect already forwards.
  - Do not edit the shared array in place while Phaser still uses it. Both views import the same constant, so parity holds by construction.
- Checkpoints: one, `castle-writing-room-entry`, in `discovery/checkpoints.ts`. The save-compatibility rule applies: append only.
- Entry from the castle: `CASTLE_EXITS` `writing-room` keeps `to: 'locations/castle-writing-room'`. The Phaser interaction `castle-last-bookshelf` is the same entry. SC-R03-01 explicitly kept the door navigating until SC-R10.
- Runtime: `ThreeLocationWorldView` with `createLocationEngine`, no new engine code. Input and dialogs are React overlays: `WorldActionPanel`, the location link, the "not discovered" gate. No answer validation, no AI, no progress in the engine.

### Files to create
- `react/src/features/island-map/three/castleWritingRoomRegion.ts` (constants, pure, no three)
- `react/src/features/island-map/three/runtime/manifests/castleWritingRoom.ts` (`CASTLE_WRITING_ROOM_MANIFEST`)
- `.../manifests/castleWritingRoom.test.ts` (validation)
- `.../manifests/castleWritingRoom.engine.test.ts`
- `.../manifests/castleWritingRoomParity.test.tsx`
- `react/src/features/discovery/checkpoints.ts`: add `CASTLE_WRITING_ROOM_REGION_ID` and checkpoint (edit)
- `manifests/index.ts`: register in `SOURCE_LOCATION_MANIFESTS` (edit)
- `docs/IMPLEMENTATION_STATUS.md` (edit)

### Route coexistence
- Keep `/island/:childId/world/castle-writing-room` on `CastleWritingRoomWorldPage` (Phaser) until the gates clear.
- The Three.js room is served at the generic `explore/castle-writing-room` (`LOCATION_WORLD_ROUTE`), which needs no new route.
- Add a "Try exploring the room (new!)" link in `IslandLocationPage.tsx` beside the existing walk link (line 260), the same way the Dragon's Sanctuary did (line 247).
- The Three.js room does not become the default, and `world/` is not turned into `LegacyLocationWorldRedirect` until parity, LAI-2303 and owner sign-off. That switch is the one-line change in `AppRoutes.tsx:248` that belongs to SC-R10-03.

## 3. Shared progress contract

Neither room records anything today, so the contract is "neither writes a world change":
- Unlock and the only record: `THE_CASTLES_SECRET_DOOR_COMPLETE`, `changeType` `STORY_COMPLETED`, `locationSlug` `castle-secret-passage`, written by the Story engine at chapter 3.
- Great Storybook page `page-what-was-waiting` (`great-storybook/pages.ts:111`) sources from the same key.
- Both views read `WorldInteractionContext.worldChangeKeys` through `useExplorableWorld`. Neither calls `recordWorldChangeOnce`.
- If a "first story written" record is later wanted, it is a new key defined once in the Django catalog and the shared TypeScript constants, never per renderer.

## 4. Unit-test plan

- `castleWritingRoom.test.ts`: passes `validateLocationManifest` against `SOURCE_MANIFEST_REGISTRIES`. The manifest interaction ids equal `CASTLE_WRITING_ROOM_INTERACTIONS` ids. Every zone resolves to an interaction. Entity positions sit inside bounds and clear of the spawn and the exit.
- `castleWritingRoom.engine.test.ts`: uses the `engineHarness` to check spawn, a collider keeps the child inside, the exit zone fires its `NAVIGATE`, and the desk and bookshelf fire the same messages as Phaser.
- `castleWritingRoomParity.test.tsx` (modelled on `dragonsSanctuaryParity.test.tsx`, mocking `createLocationEngine`): port each assertion from `CastleWritingRoomWorldView.test.tsx`:
  - the locked state shows "has not been discovered yet" and no engine is built;
  - an unlocked child gets the engine;
  - desk and bookshelf messages render in the panel;
  - the exit link goes to the castle;
  - "Things to do here" lists the same titles.
- Contract tests: `CASTLE_EXITS` `writing-room` still requires `THE_CASTLES_SECRET_DOOR_COMPLETE`. `locations.ts` and the manifest agree on the unlock key. Neither view calls `recordWorldChangeOnce`. The Phaser files stay present and the old test files stay green.
- Not testable by unit tests: visual validation and the Sprouts playtest, which remain owner steps (LAI-2303).

## Open questions for the owner
1. Should the Three.js room add a "write the first story" action? It is new scope and would need its own world-change key.
2. Should it place the NPC that `islandNpcs.ts` schedules here?
3. Should Sprouts reach this room at all, given that chapter 3 is EXPLORER only?

## Implementation note (SC-R10-01/02, development)

Built to this contract, with these differences from it, all following the code:
- The generic view had no unlock gate (the Dragon's Sanctuary 3D room has none), so the manifest gained two optional, additive fields: `entryRequirements` and `copy.locked` (`locationManifest.ts`, checked by `validateLocationManifest.ts`, enforced in `ThreeLocationWorldView.tsx`). A room without them behaves as before. A failed progress read has no keys, so the room stays closed.
- The checkpoint id is `castle-writing-room:entry` (region-prefixed, like every other region), not `castle-writing-room-entry`. Adding it changed the content export, so `content/exported/` and `tests/golden/director-content.json` were regenerated.
- The engine wall height is 3 m (`WALL_HEIGHT`), not 3.2. The exit stays `world/storykeeper-castle`, which the legacy route still serves.
- Two optional 0.3 m reading steps under the window use the shared platforms runtime. Nothing is gated on them and Sprouts get none.
- The 3D room is a link on the location page ("Try the 3D room (preview)") and the generic route `explore/castle-writing-room`. The Phaser route stays the default; the switch is SC-R10-03.

Files: `three/castleWritingRoomRegion.ts`, `three/runtime/manifests/castleWritingRoom.ts` and its `.test.ts`, `.engine.test.ts`, `Parity.test.tsx`.

Owner decisions, taken on the safe reading until answered: no "write the first story" action; no NPC placed (the `islandNpcs.ts` afternoon entry is still unplaced in both renderers); no new band gate (Sprouts are not blocked by the room itself; whether they should reach it at all is a LAI-2303 question).

## Implementation note (SC-final-B, owner decisions answered)

The three open questions above are answered, and the safe reading used by SC-R10-01/02 is replaced.

**Band mapping used.** The first brief listed the two older bands the wrong way round. The
age-correct mapping from `CLAUDE.md` section 3 is what ships:

| Band | Activity |
|---|---|
| Sprouts (3 to 4) | Tap a picture, a character and a word. One step at a time, narrated ("Hear it"), large targets, no reading or typing. |
| Pathfinders (5 to 6) | Build two or three sentences from authored word tiles (any order the child likes). Narrated prompts. |
| Explorers (7 to 8) | Pick an authored story starter, then type a short paragraph (30 to 500 characters). |

**Where the activity lives.** One adventure template per band at `castle-writing-room`
(`adventures/content/writingRoomStories.ts`: `writing-room-picture-story`, `writing-room-sentence-story`,
`writing-room-own-story`), so the saved story belongs to an `AdventureSession` and is an ordinary
`StoryArtifact`: parent-viewable and parent-deletable (Story Keepsakes), and the completed session
shows in the adventure log. The page is `routes/WritingRoomWritePage.tsx` and the component is
`features/writing-room/WritingRoomActivity.tsx` (React, ADR-020: Phaser gets nothing). It is reached from
the open book on the desk in the 3D room (a `NAVIGATE` interaction, `WorldActionPanel`'s "Go there") and
from "Write a story" on the location card. It is never required and grants no reward, world change or
currency. There is no wrong story and nothing is graded.

**Saving and safety.** `POST children/{id}/story-artifacts/written/`
(`lai/apps/education/written_story.py`, `WrittenStoryView`).
- Sprouts and Pathfinders send option ids only. The server composes the text from the authored option
  labels, so those stories can contain nothing but authored words.
- An Explorer's paragraph is the only child free text. It is length-bounded, then screened by the
  existing deterministic input checks (`screen_untrusted_text`: prompt injection, private and contact
  details, links, secrecy, reward manipulation) plus a short list of rude or hurtful words. A refusal is
  `written_story_refused` with an authored kind message; it names no category, never repeats the text,
  stores nothing, completes no session and logs nothing.
- No model reads, rewrites or comments on a child's writing. Encouragement is authored in the client.
- One story per session (the existing `story_artifact_once_per_session` constraint); another parent's
  child, another child's session, a wrong band or a wrong place is a 404. The older `story-artifacts/`
  route still refuses a `CHILD` scene, so only this route can store child-authored text.
- The server completes the session itself, with no reward and no world change.

**Narration.** Prompts are staff-written `SpeechLine`s (`<adventure slug>-<step id>`) in
`lai/apps/speech/writing_room_speech.json`, created by the existing `seed_castle_speech_lines`, and held equal
to the client's copy by a Vitest test. A voice that fails or is off leaves the same words on screen as the caption.
Nothing a child wrote is ever spoken.

**Keeper Quill.** Placed in the Three.js room unconditionally, as the castle places him (the manifest runtime
has no schedule concept; `islandNpcs.ts` still schedules him here in the afternoon). Tapping him opens the same
`NpcConversation` the castle's Quill opens (`TALK_TO` keeper-quill): his authored lines, memory and optional
narration. One authored Writing Room line was added ("Afternoons are for writing..."), said once in an
afternoon after he has met the child. The NPC Manager host (`useNpcSceneHost`) is not mounted in this room
(see the report for the follow-up); later Quill AI flavour belongs in `NpcConversation`.

**Unlock.** The Writing Room no longer waits on `THE_CASTLES_SECRET_DOOR_COMPLETE` (whose chapter 1 has a
`number-input` step). It has no unlock requirement anywhere: `locations.ts` (so the client card, the Phaser
view and the content export agree, and Django's `place_unlocked` shows the card to everyone), and the Three.js
manifest has no `entryRequirements`. A child who already holds the key keeps everything: the library's last
bookshelf (`castle-last-bookshelf`) still opens for them, and their key and keepsake are untouched. The
Secret Door arc and its arithmetic stay unchanged inside their own adventure. A child who never did the arc
reaches the room from the island map card and the location page (Django's `place_unlocked` now shows the
card to everyone). **No in-castle walk-in door was added for them:** the library's last bookshelf shares its
zone with the Secret Door story (the first available interaction wins), and any new castle zone, prop or
interaction changes the WS-C optimisation baseline (`castleOptimisationBaseline.json`) and uses the 300
draw-call budget (a prototype entry-hall door failed those tests). This is an owner decision, see the report.

**Sprouts** can enter and use the room: flat markers (no jump steps, `platformingByBand`), a tap-only
activity with large targets and a narrated prompt each step.

Phaser parity holds for the original ids: `CASTLE_WRITING_ROOM_INTERACTIONS` is unchanged (the desk message
now reads "This desk is yours to use", since nobody has to have "solved" anything). The 3D room's two extra
interactions live in `CASTLE_WRITING_ROOM_3D_INTERACTIONS`.
