# Storykeeper Castle entry from the child UI (#99, Trello #255)

Status: fixed on `feature/storykeeper-playability-fixes` (from `main` `41ee7320`), unit-tested.
**Not owner accepted.** No browser, Playwright or device test was run for this fix. The owner's
exact screen was never captured, so the cause below comes from tracing the code and probing the
API, not from a recording. Keep #99 and #255 open until the owner plays sections 3 and 4 in the
real application.

## 1. Root cause

There is no crash and no server refusal. Both entry routes into the castle worked. The child
was simply never offered a clear way in, and two of the three age bands were told the castle
had nothing for them.

1. **The castle has no "Explore in 3D" button on the Realms pages.** Storykeeper Castle is a
   bundled TypeScript manifest region (ADR-033). It has no Django 3D Area (`WorldRegion`), so
   `GET /children/<id>/islands/` lists the Place with `area: null`, and Realms (`realmCatalog.ts`,
   `PlaceCard.tsx`, and the redesign in PR #104) offers only "Visit Storykeeper Castle", which
   leads to the Place page.
2. **On the Place page (`IslandLocationPage.tsx`), the 3D castle was labelled a preview.** The
   links were, in order:
   - the card tale;
   - "Try exploring the castle (new!)", which opens the legacy Phaser view;
   - "Peek at an early 3D preview (new!)", which is the real Three.js castle.

   An old test even pinned the castle's "preview" label as "SC-11's call to change".
3. **Sprouts and Explorers were told "This adventure is not available for your age yet."** The
   page took the first adventure template for the location, which is The Storykeeper's Tale
   (Pathfinders only).
   - A Sprout never saw Quill's Picture Story.
   - An Explorer's adventure (the Secret Door) lives inside the castle.
   - The Writing Room had the same bug the other way round: its first template is the Sprout
     story, so Pathfinders and Explorers lost "Write a story".

Ruled out, by evidence (throwaway PostgreSQL 18, `migrate` and `load_content` only, no seed
commands, one child per band, signed Cognito-style token):

| Check | Result |
|---|---|
| Realm and Place ids | `learning-adventure-island` (home, unlocked) has `storykeeper-castle` for every band; region id `storykeeper-castle` |
| Published Django content | Castle adventures load: Sprout 1 (`quills-picture-story`); Pathfinder 3 (`the-storykeepers-tale`, `the-painted-words`, `-again`); Explorer adventures are under `castle-secret-passage` |
| World pack and manifests | `STORYKEEPER_CASTLE_MANIFEST` is in `sourceLocationManifestRepository`, so `regionRepositoryForChild` never asks Django for it |
| React routing | `/island/:childId/explore/storykeeper-castle` is `LocationWorldPage`, behind `RequireParent` only; nothing in the child shell gates it |
| APIs the 3D castle calls | 200 for `castle/rooms`, `castle/storybook`, `places/storykeeper-castle/npcs`, `audio/manifests/places/storykeeper-castle`, `audio/settings`, `sessions`, `quests`, `content/npcs`, and the session routes of the band's adventures |
| Database initialisation | Nothing beyond `migrate` and `load_content` is needed to enter. Seeds add Ember, Orion's lines, sound and speech (acceptance section 4.0), not access |
| Child access | Parent-owned child only; `regions/storykeeper-castle/npcs` is 404 by design (no Django Area), and the castle uses the Place route instead |
| Assets | Models come from the bundled manifest; nothing in the Asset Library gates entry (LAI 07 informed) |

## 2. The fix

Everything is in `react/src/routes/IslandLocationPage.tsx`:

- **Pathfinders and Explorers:** "Enter the castle" is the first action, styled as the primary
  button and linking to `/island/:childId/explore/storykeeper-castle`. It no longer says
  "preview". The Phaser view stays, as "Explore the castle from above instead".
- **Sprouts:** the card route stays first (contract C-10, ADR-008, until SC-R11-02's playtest).
  "Try exploring the castle (new!)" (the Phaser view) and "Walk inside the castle" (3D) come
  after it. Each band has exactly one link into the 3D castle.
- **The band's own adventure:** each band is offered its own adventure, picked with
  `resolveAdventureForAgeBand`. When no template fits the band, the page falls back to the first
  one, and its "not available" message is still true.
- **Explorers at the castle:** they read "Your castle adventure is inside. Look for the secret
  door in the Great Library." instead of "not available".

Not changed, on purpose:
- Realms (`realmCatalog.ts`, `PlaceCard.tsx`). A direct "Enter the castle" button there means
  teaching the catalog about bundled regions. That is a design decision for LAI 05 and the
  owner, and `realmCatalog.ts` is being changed for #98 and #100.
- The Phaser view. Retiring it is SC-R10-03, an owner decision.
- The bay's preview links (Phase 33).

Regression tests: `react/src/routes/IslandLocationPage.test.tsx`, "Storykeeper Castle entry, by
age band (#99)" and "the Writing Room offers each band its own story".

## 3. Navigation checklist (owner, real application)

Play once per band: Sprout, Pathfinder and Explorer. Use a child whose parent is signed in, on a
database prepared with acceptance section 4.0.

| # | Step | Expected | Result |
|---|---|---|---|
| N-1 | Child home, then **Realms** | The Realm Explorer opens; Adventure Island is open | |
| N-2 | Adventure Island (or the castle card in the redesign), then **Visit Storykeeper Castle** | The castle Place page opens | |
| N-3 | Look at the Place page | Pathfinder or Explorer: **Enter the castle** is the first button. Sprout: Quill's Picture Story comes first, then "Walk inside the castle". No "preview" wording, and no "not available for your age" | |
| N-4 | Pathfinder: the Start button | "Start: The Storykeeper's Tale". Sprout: "Start: Quill's Picture Story". Explorer: the "secret door in the Great Library" line | |
| N-5 | Enter the castle | The 3D castle loads in the Entry Hall (P-1); no failed `/api/v1` request | |
| N-6 | Walk into the Story Hall | The hub; Keeper Quill is there | |
| N-7 | Start the band's adventure inside, then leave mid-way with "Leave island" | You reach the Realm Explorer; progress is saved | |
| N-8 | Realms, Visit, Enter the castle again | It resumes at your saved checkpoint, with the adventure still in progress | |
| N-9 | The adult exit | Goes to the parent space | |
| N-10 | The Writing Room Place card (Pathfinder or Explorer) | "Write a story" is offered, not "not available" | |

## 4. Castle areas: status

**Playable** means it is built, unit-tested and reached by walking in the 3D castle. None of these
rows has been played in a browser. The per-area play rows are P-1 to P-16 in
`storykeeper_castle_acceptance.md` section 4.5, and this table points at them.

| Area | Status | Notes | Play row |
|---|---|---|---|
| Castle entrance (Entry Hall) | Playable | Spawn and checkpoint `storykeeper-castle:entrance`. Leaving goes to the Realm Explorer | P-1, P-16 |
| Central hub (Story Hall) | Playable | Keeper Quill; the story stones for The Storykeeper's Tale. The guide's "Go to" returns here from any room | P-1, P-6, P-15 |
| Great Library | Playable (Explorer arc) | Clue wall, pattern and rod stones, the bookshelf secret door (Secret Door chapters) | P-3 |
| Great Storybook | Playable | 3D book on the library dais, plus the guide's Storybook section. Pages come back from records | P-7, P-9 |
| Writing Room | Playable | Its own Place (`castle-writing-room`), reached through the library's secret door and from its Place card. "Write a story" for every band | P-15, N-10 |
| Painted Words | Playable (Pathfinder) | Illustration Studio pads; replay serves the second word set | P-8 |
| Trophy Room | Playable, display only by design | Shows keepsakes, never grants them. Hall of Heroes 3D plates are deferred (draw-call budget) | P-4 |
| Observatory (in the Setting Tower) | Playable, flavour only by design | Telescope, orrery and star chart give read-aloud lines with nothing graded. Professor Orion uses a stand-in model | P-5 |
| Educational adventures | One per band, playable | Sprout: Quill's Picture Story. Pathfinder: The Storykeeper's Tale and The Painted Words. Explorer: the Secret Door chapters | P-3, P-8, P-9 |
| Movement and jumping | Playable; jumping optional | A lower hop indoors; every answer is possible without jumping. Sprouts get flat markers and no jump steps | P-10, P-11 |
| Camera | Playable | Stays under the ceiling and inside the room; close in the corridor | P-10 |
| NPCs | Playable | Quill and Orion fall back to the manifest. Ember appears after `seed_npc_ember --publish` and her progress gate | P-12 |
| Saving and resume | Playable | Sessions resume in their room; a replay re-grants nothing | P-9, P-15 |

Unavailable by design: these are not defects, and they are not exposed as playable.
- Storybook adventure portals into story worlds (SC-JMP-04): pages lead to their room.
- The movement tutorial (SC-JMP-06): needs the owner's placement decision.
- Castle ranks: ship switched off, owner decision O-12.
- Castle sound: silent until the 18 audio files exist (`docs/audio/STORYKEEPER_CASTLE_AUDIO.md`
  section 4).

Defects found in this pass: the three entry causes in section 1. No defect was found inside the
castle at unit level. What the castle looks and feels like in a browser is still unverified.
