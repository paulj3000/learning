# Storykeeper Castle Reboot — Consolidated Roadmap (SC-R)

**Status: authoritative for Storykeeper Castle from 2026-11-02.** It supersedes the
*scope* of `docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` (SC-0 to SC-11, built) and
`docs/regions/storykeeper_castle.md` (the upgrade roadmap, Phases 0 to 14, not
built). Both stay as history and design reference. Read
`docs/regions/storykeeper_castle_implementation_audit.md` (the baseline) and
`docs/regions/storykeeper_castle_reconciliation.md` (why the two older roadmaps
disagree) first.

Branch: `adventures/storybook`. Tracker: `tasks/TASK_TRACKER.md`, section
"Storykeeper Castle Reboot".

## 1. What this reboot is

An **incremental overhaul, not a rewrite**. The eight-room Three.js castle that
SC-0 to SC-10 built is kept, re-dressed, and extended. Its engineering survives
intact: derived walls, the binding table, HUD equivalence as a test, ADR-027
single story progress, resume-from-answers, and the seating-puzzle factoring.
What changes is the castle's art, its premise, and what it gives a child to come
back for.

### Premise: the Great Storybook

> The magical Great Storybook has been damaged, scattering its pages throughout
> the castle. Keeper Quill needs the child's help to collect the pages and restore
> the castle's stories.

The premise wraps the existing adventures rather than replacing them:

- telling a story with Quill (the Tale, or the Picture Story for Sprouts)
  restores a page;
- solving the secret door's clues restores one;
- opening the door restores one;
- finishing the arc restores one;
- one page is hidden behind the tapestry for children who explore.

No authored adventure text, option id, or step changes to fit the premise.
The premise is carried by new framing copy: Quill's introduction, the Storybook
dais, the page display, and later NPC lines.

### Decisions carried from the older roadmaps

| Decision | Source | Status here |
| --- | --- | --- |
| Engine and adventure content untouched by 3D work | SC roadmap preamble | Kept |
| Every 3D route has a HUD equivalent | SC preamble, explorable-world roadmap section 42 | Kept, executable test |
| No vertical traversal | SC preamble | Kept: every new space is ground floor |
| ADR-008 Sprouts gate; card route not retired before the playtest | SC-11 | Kept as SC-R11 |
| Gameplay-bearing geometry stays generated | ADR-028 (Proposed) | Kept |
| AI proposes, engine validates; no AI-invented actions | Upgrade roadmap section 11-12 | Kept for SC-R09 |
| Amazon Polly with S3 caching | Upgrade roadmap section 17-22 | **Not adopted yet**: needs a provider decision and a voice-consent review (SC-R06 is gated) |
| Nine-room floor plan | Upgrade roadmap section 6 | **Not adopted**: its functions are mapped onto the eight existing rooms plus two new spaces (section 2) |
| Five ranks from Story Explorer to Master Storykeeper | Upgrade roadmap section 2 | Adopted as *derived, presentational* titles (section 4.4), never stored or competitive |

## 2. Castle layout

The upgrade roadmap's nine rooms are **functions**, not floor plans. Seven of
them map onto existing rooms. Two new spaces are added, and each is reached
through a mechanism the castle already has: the secret bookshelf door and the
tapestry nook.

```text
                 z = 10 ┌──────────────┐        ┌─────────┐
                        │  CHARACTER   │        │ SETTING │
                        │   GALLERY    │        │  TOWER  │
                        │ (Hall of     │        │ (+Obser-│
                        │  Heroes)     │        │  vatory)│
  ┌──────────┐   z = 6  ├──────┬───────┤   ┌────┤         │
  │  ENTRY   │          │             │   │ E  └─────────┘
  │  HALL    ├──────────┤ STORY HALL  ├───┤ A  ┌─────────┐
  │ (Grand   │  arch    │   (hub,     │   │ S  │ ILLUST- │
  │ Entrance)│          │  Quill)     │   │ T  │ RATION  │
  └──────────┘          │             │   │    │ STUDIO  │
   ⋮ tapestry passage   ├──────┬──────┤   │ C  └─────────┘
  ┌──────────┐  z = -6  │  COSTUME    │   │ O  ┌──────────────────┐
  │ SECRET   │          │   ROOM      │   │ R  │  GREAT LIBRARY   │
  │ CHAMBER  │          │ (+Trophy    │   │ R  │  (Great Storybook│
  │ (SC-R08) │          │  Room)      │   │    │   dais)          │
  └──────────┘ z = -10  └─────────────┘   └────┴────────┬─────────┘
                                                        ⋮ secret door
                                               ┌──────────────────┐
                                               │  WRITING ROOM    │
                                               │  (3D in SC-R10)  │
                                               └──────────────────┘
```

### 2.1 Space-by-space plan

"3D Area ownership" follows ADR-041: one optional 3D Area per Place. The castle
is the Place `storykeeper-castle`, and its 3D Area is today's TypeScript
manifest (ADR-033; no Django `WorldRegion` until LAI-0805). Every space below
belongs to that one 3D Area except the Writing Room, which is its own Place
(`castle-writing-room`) today.

| Space | Existing room id | Purpose | Primary NPCs | Educational interactions | Doors and connections | Assets needed | Storybook features | Phase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Entry Hall** (the "Grand Entrance") | `entry-hall`, existing | Arrival, welcome, the castle's promise at a glance | none (Quill is in view) | none (orientation) | West: castle doors to the harbour. East: archway to the Story Hall | Grand doors, banners, columns, floor inlay, the Storybook mural | Storybook mural that fills in as pages return | Visual SC-R02-03; mural state SC-R04 |
| **Story Hall** (hub; the upgrade roadmap's "Grand Hall") | `story-hall`, existing | Meet Quill; tell a story; bind it | Keeper Quill | Beats 1–2, 5–6 (Tale, Picture Story): character, setting, comprehension, ordering | Hub: to Entry, Gallery, Costume, Corridor | Hearth, lectern, binding table, stage dais, tapestries | Quill offers the quest here; the page tracker sits on Quill's lectern | Visual SC-R02-04a; quest SC-R04 |
| **Character Gallery / Hall of Heroes** | `character-gallery`, existing | Choose a hero (beat 3); later, a record of completed stories | none | `choose-hero`, portraits as options | South archway to the Story Hall | Portraits (gameplay, generated), frames, plinths, rope barriers | Each restored story hangs a framed "story plate" here | Visual SC-R02-04b; record SC-R07 |
| **Costume Room / Trophy Room** | `costume-room`, existing | Dress-up flavour today; the artifact display | none (later: Castle Ghost, SC-R05) | none now; artifact descriptions are readable | North archway to the Story Hall | Wardrobes, mirror, costume racks (unplaced today), pedestals | Pedestals show earned artifacts permanently | Visual SC-R02-04c; artifacts SC-R07 |
| **East Corridor / Map Corridor** | `east-corridor`, existing | The spine to the deep rooms; wayfinding | none | none | West to the Story Hall; east to the Tower, Studio, Library | Runner carpet, sconces, island map wall, banners | The map shows where pages are still missing (non-spoiler hints) | Visual SC-R02-04f; map SC-R04 |
| **Setting Tower / Observatory** | `setting-tower`, existing | Choose a setting (beat 4); later, the place story worlds are glimpsed | none (later: Professor Orion, SC-R05) | `choose-setting`, windows as options | West archway to the Corridor | Window frames and views (gameplay), telescope, star chart, orrery | Return events seen through the windows (Ember flying past) | Visual SC-R02-04d; events SC-R08 |
| **Illustration Studio** | `illustration-studio`, existing | See the story drawn (beat 7) | none | The easel shows hero × setting | West archway to the Corridor | Easel and canvases (gameplay), paint table, drawings, stools | Restored pages' pictures appear on the studio wall | Visual SC-R02-04e |
| **Great Library** | `great-library`, existing | The deepest room: the book on the shelf (8), clues (9), pattern lock (10), the Great Storybook's home | Keeper Quill (via the arc) | Explorers' arc: clues, counting, patterns, measurement, vocabulary | West archway to the Corridor; south: the secret bookshelf door to the Writing Room | Bookshelves, reading tables, chairs, columns, candles, the **Storybook dais** | The Great Storybook rests here and visibly regains pages | Visual SC-R02-02; Storybook SC-R04 |
| **Writing Room** | none in 3D (Phaser and card today) | Where the child's own story is kept (beat 11) | Keeper Quill | Story chapter 3 reflection | Through the secret door, back to the Library only | Round room, one window, desk, shelves of blank books | Final page; the Storybook's last chapter | SC-R10 (needs the bounds and route work in SC-R03) |
| **Secret Chamber** (the "Dungeon", kept ground-level) | none, new | An explorer's reward space behind the tapestry nook | none | Optional observation puzzles (SC-R08) | Hidden passage from the tapestry nook (Story Hall, south-west) | Low stone room, lantern, chest, mural | A hidden page | SC-R03 (shell) / SC-R08 (content); **needs approval** |
| **Observatory** | merged into the Setting Tower | see above | | | | | | |
| **Trophy Room** | merged into the Costume Room | see above | | | | | | |
| Inventor's Workshop, Potion Laboratory, Map Room as a room | not planned | Out of scope until a separate approval; the Map Room is a corridor function | | | | | | |

**Why merge rather than add.** Seven of the nine upgrade-roadmap rooms have a
natural home in an existing room, and adding them as rooms would leave eight
existing rooms half-used, which the reboot brief rules out. The Observatory
needs windows; the tower has three. The Trophy Room needs display space; the
Costume Room has had none of its authored racks placed since Phase 14. Merging
also keeps the castle's walking distances inside a Sprouts session (5 to 8
minutes).

## 3. Quest, Adventure, and 3D Area boundaries

The hierarchy is ADR-041's Island → Place → 3D Area, with Adventures launched
from objects. Nothing here adds a second hierarchy.

| Layer | What it is in the castle | Owns | Never does |
| --- | --- | --- | --- |
| **Island-level Quest** | `restore-the-great-storybook`: a `catalog.Quest` authored in the quest content (exported through `quests.json`, loaded by `manage.py load_content`), offered by Keeper Quill | The *goal* and its stages; objective kinds the quest engine already credits (BUILD on world-change keys, SOLVE on adventures, TALK_TO, COLLECT) | Grade answers; write story progress; hold castle layout |
| **Place-level Adventures** | The Tale, the Picture Story, the secret-door story (3 chapters, 2 adventures), and future castle missions | Learning objectives, steps, correctness, the single progress record (ADR-027), the world change at the end | Know about pages, ranks, or 3D positions |
| **3D Area interactions** | Portraits, windows, plates, clues, rods, doors, the tapestry, the Storybook dais, pedestals | Presentation: where a choice is *standing*, what lights up, what animates | Decide correctness; grant rewards; create progress records |

The **Great Storybook's pages are derived, not stored** (section 4.1). The
quest observes the same world changes that the adventures already write. A
child who finished the Tale last month already has page one the first time
they see the Storybook.

## 4. Progression design (implemented in SC-R04 and SC-R07; specified here)

### 4.1 Storybook pages

A page is a pure function of existing records:

| Page | Restored by | Bands |
| --- | --- | --- |
| `page-first-story` | `FIRST_STORY_TOLD` (written by the Tale **and** the Picture Story) | Sprouts, Pathfinders, Explorers |
| `page-three-clues` | `SECRET_DOOR_CLUES_COLLECTED` | Explorers |
| `page-pattern-lock` | `CASTLE_SECRET_DOOR_OPENED` | Explorers |
| `page-what-was-waiting` | `THE_CASTLES_SECRET_DOOR_COMPLETE` | Explorers |
| `page-tapestry` (hidden) | discovery `castle-tapestry-stair` | All bands |

Each band's quest completes on **its own page set**. A Sprout's Storybook is
whole at two pages; it never shows ten empty slots meant for an eight-year-old.
New pages arrive with new adventures (SC-R04 adds at least one Pathfinder
mission so the band has more than one page), and each new page names an
existing or new world change, never a page-specific store.

### 4.2 Artifacts

Artifacts are `catalog.ItemDefinition` rows granted by `RewardRule`s, on the
pattern `reward-storykeepers-tale` → `storykeepers-quill` already uses, and
owned through `inventory.InventoryItem`. The castle *displays* inventory on
Costume Room pedestals (manifest scenery gated by requirements). It does not
grant anything. There is no castle-specific artifact table.

### 4.3 Discoveries and secrets

Existing discovery ids and `DISCOVER` interactions (the tapestry is the model).
SC-R08 adds more hidden interactions and hides them from "Things to do" lists
the same way (`hiddenInteractionIds`).

### 4.4 Ranks

Five titles (Story Explorer, Page Finder, Tale Keeper, Story Guardian, Master
Storykeeper) are **computed from the fraction of the child's band page set
restored**. They are never stored, never compared between children, never
lost, and never tied to time. They are a description of what the castle looks
like, not a score. If the owner prefers no ranks at all, nothing else depends
on them.

### 4.5 Persistence target

Today all of the above lives in Amplify (`ChildStoryProgress`, world changes,
discoveries, `ChildInventory`). The Django models already exist
(`progression.WorldChange`, `StoryProgress`, `WorldState`,
`inventory.InventoryItem`, `quests.QuestProgress`). The castle moves with the
platform's cutover tasks (LAI-0309, LAI-0603, LAI-0709) and does not get its
own migration. Because pages are derived, the cutover carries no page data.

## 5. Age-band compatibility

| | Sprouts (3–4) | Pathfinders (5–6) | Explorers (7–8) |
| --- | --- | --- | --- |
| Castle route | Card route stays primary until SC-R11's playtest; 3D offered | 3D or card | 3D or card |
| Mission | Quill's Picture Story | The Storykeeper's Tale (+ SC-R04 mission) | The Castle's Secret Door (3 chapters) |
| Pages | 2 (first story, tapestry) | 2 now, more with SC-R04 | 5 |
| Reading | Narrated, picture-first | Narrated text | More text |
| Puzzles | Stand-at choices only; no reticle | Choices, ordering | Clues, counting, patterns, measurement |
| Secrets | Tapestry nook (walk-in) | same | same + SC-R08 |

The shared premise never forces a Sprout into an Explorer puzzle. Rooms that
hold Explorer puzzles stay walkable and pretty for a Sprout, with nothing that
reads as "locked for you".

## 6. Phases and tasks

Each task is one commit and one push. "Browser" lists what only a real browser
or device can confirm; it is never marked done on this branch.

### SC-R01 — Architecture reconciliation (docs, contract tests)

| Task | Deliverable |
| --- | --- |
| SC-R01-01 | Implementation audit |
| SC-R01-02 | This roadmap |
| SC-R01-03 | ADR-028 recommendation and asset conventions (`docs/regions/storykeeper_castle_art_direction.md`) |
| SC-R01-04 | Gameplay and compatibility contracts, with contract tests (`docs/regions/storykeeper_castle_contracts.md`) |
| SC-R01-05 | Acceptance and test plan (`docs/regions/storykeeper_castle_acceptance.md`) |

### SC-R02 — Visual overhaul (code)

| Task | Deliverable | Browser |
| --- | --- | --- |
| SC-R02-01 | Generic visual system in the location runtime: material presets, textured surfaces with world-scaled UVs, deterministic procedural textures, quality tiers, light moods, missing-asset fallbacks, disposal | Textures look right; no shimmer |
| SC-R02-02 | Great Library: textured floor, walls and ceiling, columns, chairs, candles, varied books, the Storybook dais, motes | Overall look; readability of puzzle objects |
| SC-R02-03 | Entry Hall: doors, inlay, banners, columns, mural, path to the library | First impression |
| SC-R02-04a–f | Story Hall, Gallery, Costume Room, Tower, Studio, Corridor, each its own commit | Per room |
| SC-R02-05 | Interaction feedback: gentle glow and light changes on state flips; reduced-motion support in the castle | Feel; reduced motion |
| SC-R02-06 | Lighting moods and quality-tier light budgets | Exposure consistency |
| SC-R02-07 | Asset manifest doc; every new id through the registry; fallbacks | none |
| SC-R02-08 | Static performance budgets as tests | Real FPS (SC-R11) |
| SC-R02-09 | Final development verification | none |

### SC-R03 — World expansion

| Task | Deliverable |
| --- | --- |
| SC-R03-01 | Grow region bounds and add the Writing Room shell behind the secret door (no gameplay change; the door still navigates until SC-R10) |
| SC-R03-02 | Secret Chamber shell behind the tapestry nook (**APPROVAL**: new space) |
| SC-R03-03 | Wayfinding: the corridor map and floor inlays, with HUD equivalents |

### SC-R04 — Great Storybook

| Task | Deliverable |
| --- | --- |
| SC-R04-01 | `greatStorybook.ts`: the page registry and the pure `restoredPages(worldState, band)` |
| SC-R04-02 | `restore-the-great-storybook` quest in quest content; export and Django load verified |
| SC-R04-03 | The Storybook dais shows restored pages (requirements-gated scenery) |
| SC-R04-04 | Quill's quest introduction and page-tracker HUD card (text equivalent) |
| SC-R04-05 | One new Pathfinder mission (**APPROVAL**: new educational content) |

### SC-R05 — Characters

| Task | Deliverable |
| --- | --- |
| SC-R05-01 | Keeper Quill model upgrade path (commissioned asset swap behind the same id and clip names) |
| SC-R05-02 | Ember visits the castle (reuses the existing `ember-dragon` NPC; a dialogue node in the castle) |
| SC-R05-03 | One supporting NPC (Castle Ghost or Professor Orion) through the NPC framework (**APPROVAL**: character) |

### SC-R06 — Sound and voice (gated on the Sound Manager merge)

| Task | Deliverable |
| --- | --- |
| SC-R06-01 | Castle sound cues through the shared Sound Manager (ambient room beds, UI, puzzle success) |
| SC-R06-02 | Mute and volume respected; reduced audio for Sprouts |
| SC-R06-03 | Narration: **APPROVAL** for provider (Polly or another) and parent voice consent |

### SC-R07 — Persistent progression

| Task | Deliverable |
| --- | --- |
| SC-R07-01 | Castle artifacts as catalog items and reward rules |
| SC-R07-02 | Costume Room pedestals display owned artifacts |
| SC-R07-03 | Hall of Heroes record of completed stories |
| SC-R07-04 | Derived rank title on the page tracker (optional per the owner) |

### SC-R08 — Secrets and replayability

| Task | Deliverable |
| --- | --- |
| SC-R08-01 | Ambient return-visit events (deterministic catalog, cooldowns, no AI) |
| SC-R08-02 | Two more hidden discoveries and the hidden page |
| SC-R08-03 | Secret Chamber content (after SC-R03-02 approval) |

### SC-R09 — AI castle behaviour (ADR-044 path; no live Bedrock in tests)

| Task | Deliverable |
| --- | --- |
| SC-R09-01 | Castle Director as a *selection* over SC-R08's event catalog, server-validated ids, deterministic fallback |
| SC-R09-02 | Quill flavour dialogue through the companion route with bounded context and authored fallbacks |

### SC-R10 — Three.js migration

| Task | Deliverable |
| --- | --- |
| SC-R10-01 | Three.js Writing Room with chapter 3 parity |
| SC-R10-02 | Parity tests against the Phaser Writing Room |
| SC-R10-03 | Retire the Phaser castle and Writing Room (**gated** on ADR-020's conditions and LAI-2303) |

### SC-R11 — Performance and accessibility (owner gates)

| Task | Deliverable |
| --- | --- |
| SC-R11-01 | Real-tablet profiling pass (owner; runbook `docs/PILOT_READINESS.md` 5b) |
| SC-R11-02 | Sprouts accessibility playtest (owner) |
| SC-R11-03 | Fixes from both |

### SC-R12 — Final acceptance

| Task | Deliverable |
| --- | --- |
| SC-R12-01 | Browser acceptance pass against `storykeeper_castle_acceptance.md` (owner) |
| SC-R12-02 | Release notes, implementation status, retirement decisions |

## 7. Owner decisions this roadmap needs

1. **ADR-028 acceptance** (art architecture), with the sourcing budget for
   commissioned Quill, Ember and Storybook art.
2. **KayKit walls**: raise `WALL_HEIGHT` to 4 m or keep 3 m and source a
   3 m kit.
3. **New spaces**: the Secret Chamber (SC-R03-02).
4. **New educational content**: the Pathfinder mission (SC-R04-05).
5. **Sound**: the Sound Manager merge and its ADR; narration provider and
   voice consent.
6. **Ranks**: keep the derived titles or drop them.
7. **Retirement**: Phaser castle and Writing Room (after SC-R10 parity and the
   Sprouts gate).
