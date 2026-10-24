# Storykeeper Castle — AI, 3D World, Voice, and Gameplay Upgrade Roadmap

## 1. Objective

Transform Storykeeper Castle from a mostly static 3D walkthrough into the narrative heart of Learning Adventure Island.

The upgraded castle should:

- Give the child a clear reason to return.
- Act as a physical gateway into existing stories and adventures.
- Change as the child makes progress.
- Use AI to personalize events, NPC dialogue, hints, and recommended adventures.
- Use structured, validated game systems rather than letting AI freely control the world.
- Use Amazon Polly for all generated character/narrator speech.
- Store generated MP3 audio in Amazon S3 and reuse it rather than regenerating identical lines.
- Support Three.js first-person exploration.
- Reuse the existing story progress system so castle entry points do not create duplicate progress records.

---

# 2. Story Premise

## The Great Storybook

Storykeeper Castle protects the stories of Learning Adventure Island.

Something has damaged the Great Storybook.

Its pages have scattered across the island.

As a result:

- Books are behaving strangely.
- Characters are escaping from stories.
- Magical artifacts are appearing in the wrong places.
- Parts of the castle have gone dark.
- Doors and wings have become locked.
- Story worlds occasionally overlap.
- The Storykeeper does not fully understand what caused it.

The child becomes a **Story Explorer** and helps restore the Great Storybook.

Possible rank progression:

1. Story Explorer
2. Page Finder
3. Tale Keeper
4. Story Guardian
5. Master Storykeeper

The castle itself becomes the visual record of the child's accomplishments.

---

# 3. Core Gameplay Loop

The Storykeeper Castle loop should be:

1. Enter Castle.
2. Castle Director evaluates current child state.
3. Ambient event or mystery appears.
4. Child explores.
5. Child meets an NPC or discovers an interactive object.
6. A story, side quest, puzzle, or learning challenge begins.
7. Existing curriculum/game systems control the actual challenge.
8. Child completes the challenge.
9. Child earns an artifact, page, collectible, relationship change, or castle unlock.
10. Castle visually changes.
11. New mysteries become available.
12. Child returns later and experiences a different combination of events.

The goal is:

**Explore → Discover → Learn → Accomplish → Change World → Return**

---

# 4. 3D Art Direction

## Recommended Style

Use a consistent:

- Stylized fantasy
- Low-poly to moderate-poly
- Warm and colorful
- Exaggerated silhouettes
- Child-friendly
- Slightly magical
- Roblox / Prodigy / animated-adventure feeling rather than realism

Avoid mixing highly realistic assets with cartoon assets.

## Preferred Runtime Format

Use:

- `.glb` as the primary runtime model format.
- glTF 2.0-compatible materials.
- Draco compression or Meshopt where useful.
- KTX2/Basis textures where supported.
- LODs for larger objects.
- Texture atlases for repeated props.

Keep editable Blender source files separately from runtime GLBs.

---

# 5. 3D Model Inventory

## Phase A — Castle Structure

These are required first.

### Exterior

- Main castle
- Gatehouse
- Drawbridge
- Towers
- Battlements
- Castle walls
- Courtyard
- Exterior stairs
- Castle banners
- Large doors
- Windows
- Roof pieces
- Fountain
- Statues

### Interior Modular Kit

- Stone walls
- Interior corners
- Floors
- Ceilings
- Pillars
- Archways
- Straight stairs
- Spiral stairs
- Railings
- Doors
- Secret doors
- Trap doors
- Bookshelves
- Wall alcoves
- Window modules

Recommended starting source:
- Kenney Castle Kit for modular CC0 castle geometry.
- Poly Haven for CC0 textures and environment props.
- Additional Sketchfab models only after checking the individual license.

---

# 6. Essential Castle Rooms

Do not build an enormous castle immediately.

Build these rooms first.

## 6.1 Grand Hall

Purpose:
- Primary arrival location.
- Storykeeper NPC.
- Quest introductions.
- Major castle changes.
- Player rank display.

Models:

- Throne-like Storykeeper chair
- Long tables
- Chandeliers
- Fireplace
- Banners
- Statues
- Large central Great Storybook pedestal
- Floating magical particles
- Large locked doors

## 6.2 Grand Library

Purpose:
- Main story discovery area.
- Books become portals into stories.
- Lost pages.
- Escaped books.
- Hidden passages.

Models:

- Tall bookshelves
- Books
- Floating books
- Tables
- Chairs
- Ladders
- Book carts
- Candles
- Scrolls
- Globes
- Reading podiums
- Magical book
- Sliding bookshelf secret door

## 6.3 Hall of Heroes

Purpose:
- Visual representation of completed stories and relationships.

Models:

- Portrait frames
- Character paintings
- Busts
- Pedestals
- Statues
- Plaques
- Empty frames for locked heroes

## 6.4 Trophy / Artifact Room

Purpose:
- Display physical rewards from adventures.

Models should include reusable display systems:

- Display cases
- Pedestals
- Shelves
- Spotlight fixtures
- Plaques

Artifacts can include:

- Dragon egg
- Pirate compass
- Wizard wand
- Knight shield
- Crystal
- Moon rock
- Mermaid pearl
- Golden key
- Magic feather
- Ancient map
- Crown
- Fossil
- Potion bottle

## 6.5 Observatory

Purpose:
- Astronomy
- science
- measurement
- fractions
- geometry

Models:

- Telescope
- Orrery
- Star charts
- Celestial globe
- Planet models
- Chalkboard
- Tables
- Lenses
- Gears
- Observatory dome

## 6.6 Inventor's Workshop

Purpose:
- STEM
- logic
- sequencing
- engineering

Models:

- Workbench
- Tools
- Gears
- Levers
- Pipes
- Machines
- Crates
- Blueprint table
- Mechanical toys

## 6.7 Potion Laboratory

Purpose:
- Math/science puzzles.

Models:

- Cauldron
- Potion bottles
- Shelves
- Ingredients
- Scales
- Measuring containers
- Mortar and pestle
- Spell books
- Magical smoke

## 6.8 Forgotten Dungeon

Purpose:
- Mysteries
- harder challenges
- secrets

Models:

- Dungeon walls
- Cells
- Iron doors
- Chains
- Torches
- Barrels
- Crates
- Skeleton props
- Hidden levers
- Broken walls
- Locked chests

Keep imagery playful rather than scary.

## 6.9 Map Room

Purpose:
- Geography
- exploration
- world navigation

Models:

- Large world map
- Globe
- Map table
- Scroll racks
- Compasses
- Ships
- Pins/markers
- Magical island model

---

# 7. Character Model Inventory

Build a small reusable cast instead of dozens of NPCs.

## Priority 1

### Storykeeper

Needs:

- Idle
- Talk
- Point
- Think
- Surprised
- Laugh
- Concerned
- Wave
- Walk

The Storykeeper should be the most polished castle character.

### Child Avatar

Needs:

- First-person compatibility
- Optional visible hands
- Walk
- Run
- Interact
- Pick up
- Push/pull
- Open door
- Carry object

### Ember — Small Dragon

Needs:

- Idle
- Fly
- Land
- Sit
- Hop
- Look around
- Talk/emote
- Happy
- Worried

### Professor Orion

Role:
- Observatory NPC.

### Inventor

Role:
- Workshop NPC.

### Castle Ghost

Role:
- Mystery / comedy.

Keep the ghost friendly.

### Knight / Armor Character

Role:
- Puzzle challenge NPC.

## Priority 2

- Wizard
- Pirate
- Librarian
- Talking portrait characters
- Fairy
- Owl
- Cat
- Mouse
- Raven
- Goblin helper
- Small castle guards

---

# 8. Creature Models

Creature models should reinforce exploration.

Recommended:

- Small dragon
- Owl
- Cat
- Mouse
- Raven
- Butterfly
- Firefly
- Magical floating orb
- Tiny fairy
- Friendly ghost

Later:

- Griffin
- Phoenix
- Unicorn
- Giant turtle
- Baby dinosaur

Creatures do not all need dialogue.

Many should simply make the castle feel alive.

---

# 9. Interactive Prop Models

These are particularly important because they turn walking into gameplay.

Create interaction-ready versions of:

- Lever
- Button
- Pressure plate
- Movable crate
- Secret brick
- Locked chest
- Unlocked chest
- Door
- Magic door
- Portal
- Book
- Floating book
- Scroll
- Key
- Crystal
- Puzzle tile
- Gear
- Telescope
- Painting
- Suit of armor
- Bell
- Candle
- Torch
- Pedestal

Every interactive prop should have a stable internal asset ID.

Example:

```text
PROP_SECRET_BRICK_01
PROP_LIBRARY_BOOK_PORTAL_01
PROP_DRAGON_EGG_01
PROP_OBSERVATORY_TELESCOPE_01
```

---

# 10. Castle Event System

The castle needs events that happen around the child.

Create a reusable event catalog.

Examples:

- BOOK_ESCAPES_SHELF
- ARMOR_SNEEZES
- GHOST_RUNS_THROUGH_WALL
- DRAGON_FLIES_PAST_WINDOW
- SECRET_DOOR_OPENS
- LIGHTS_GO_OUT
- MAGIC_FOOTPRINTS_APPEAR
- PAINTING_CALLS_PLAYER
- TREASURE_CHEST_BOUNCES
- STAIRCASE_MOVES
- MOUSE_STEALS_KEY
- LIBRARY_BOOKS_FLOAT
- FIREPLACE_TURNS_BLUE
- PORTRAIT_CHARACTER_DISAPPEARS

Each event should define:

```text
eventId
roomId
requirements
cooldown
priority
animation
audio
followUpQuest
learningTags
minimumAge
maximumAge
```

AI selects events.

The game engine executes them.

---

# 11. AI Castle Director

Create a backend service called:

`CastleDirector`

The Castle Director should receive a safe, minimal child context.

Example input:

```json
{
  "childAgeBand": "8-10",
  "recentSkills": ["multiplication"],
  "skillsNeedingPractice": ["multiplication_6_to_9"],
  "completedStories": ["dragon_ember_01"],
  "activeQuests": [],
  "castleRoomsUnlocked": ["grand_hall", "library"],
  "artifacts": ["ember_compass"],
  "recentEvents": ["ARMOR_SNEEZES"],
  "npcRelationships": {
    "ember": 2
  }
}
```

Example result:

```json
{
  "ambientEventId": "DRAGON_FLIES_PAST_WINDOW",
  "featuredNpcId": "EMBER",
  "suggestedQuestId": "EMBER_MISSING_EGGS",
  "learningTarget": "multiplication_6_to_9",
  "dialogueIntent": "ask_player_for_help"
}
```

The server MUST validate every returned ID.

AI must never invent executable game actions.

---

# 12. AI Responsibilities

AI may:

- Recommend quests.
- Select approved ambient events.
- Generate age-appropriate NPC dialogue.
- Generate hints.
- Adapt explanation difficulty.
- Reference previous accomplishments.
- Connect existing stories.
- Choose from approved learning objectives.
- Personalize descriptions.
- Generate optional flavor dialogue.

AI may NOT directly:

- Award achievements.
- Grant inventory.
- Change grades.
- Unlock arbitrary rooms.
- Modify curriculum standards.
- Purchase anything.
- Change user profile/security information.
- Execute arbitrary commands.
- Create arbitrary URLs.
- create unrestricted child-facing content.

Rule:

**AI proposes. Game engine validates and executes.**

---

# 13. NPC AI System

Every speaking NPC gets a character definition.

Example:

```text
NPC ID: PROFESSOR_ORION

Role:
Castle astronomer.

Personality:
Excited, distracted, encouraging, curious.

Purpose:
Teach astronomy, measurement, geometry, fractions, and science concepts.

Can discuss:
Current quest.
Observatory.
Approved curriculum topics.
Player's previous astronomy accomplishments.

Cannot:
Ask for identifying information.
Discuss unrestricted adult topics.
Leave the educational fantasy role.
Invent rewards.
Modify progression.
```

NPC context should include only what that NPC needs.

---

# 14. NPC Memory

Do not send full child history to the model.

Maintain structured NPC memory.

Example:

```json
{
  "npcId": "EMBER",
  "relationshipLevel": 2,
  "facts": [
    "player_rescued_ember",
    "player_found_ember_compass"
  ],
  "lastInteraction": "2026-09-07"
}
```

Use memory keys rather than unrestricted AI-written biographies.

---

# 15. Learning Integration

Create a `LearningDirector` layer.

It selects the actual educational skill.

Example:

```json
{
  "skillId": "MATH.MULTIPLICATION.6_TO_9",
  "difficulty": 2,
  "questionCount": 5
}
```

The quest provides the fantasy wrapper.

Example:

Story:

> Three dragon eggs are locked behind rune doors.

Learning:

> Multiplication problems determine which rune opens.

Do not let the language model decide whether the answer is mathematically correct when deterministic code can do so.

---

# 16. Story Integration

Castle stories must reuse the existing story/chapter system.

A chapter may be entered from:

- Story page
- Castle book
- NPC quest
- secret room
- world event

But all entry points resolve to the SAME story/chapter record.

Do not create duplicate progress records.

The castle is an alternative discovery mechanism, not a second story engine.

---

# 17. Amazon Polly Voice Architecture

All child-facing generated voice should use Amazon Polly.

Use MP3 output.

> Note: this roadmap assumes "MD3" in the request meant "MP3."

## Voice Flow

1. AI generates approved text.
2. Safety/content validation runs.
3. System normalizes the text.
4. Compute a cache key.
5. Look for an existing S3 audio asset.
6. If found:
   - Reuse it.
7. If not found:
   - Send text to Amazon Polly.
8. Polly generates MP3.
9. Save MP3 in S3.
10. Save metadata record.
11. Return audio URL/key to client.
12. Three.js client plays audio with subtitle text.

---

# 18. S3 Audio Layout

Recommended key layout:

```text
storykeeper-audio/
  voices/
    storykeeper/
      en-US/
        <hash>.mp3
    ember/
      en-US/
        <hash>.mp3
    professor-orion/
      en-US/
        <hash>.mp3
  stories/
    <story-id>/
      <chapter-id>/
        <line-id>.mp3
  narration/
    <story-id>/
      <hash>.mp3
```

Do not use raw dialogue as the S3 filename.

Use a deterministic hash based on:

```text
voiceId
engine
language
normalizedText
speechStyle
version
```

That provides voice caching.

---

# 19. Voice Metadata Model

Create something like:

```text
VoiceAsset
- id
- npcId
- locale
- voiceId
- engine
- textHash
- sourceText
- s3Key
- durationMs
- createdAt
- version
```

Optional:

```text
- speechMarksS3Key
```

Speech marks can later support improved subtitle timing or animation synchronization.

---

# 20. Polly Voice Rules

Create a fixed mapping.

Example:

```text
STORYKEEPER -> configured narrator voice
EMBER -> configured youthful character voice
PROFESSOR_ORION -> configured expressive adult voice
GHOST -> configured light/comedic voice
NARRATOR -> configured narrator voice
```

Do not randomly change voices between sessions.

Persist voice configuration per NPC.

Support SSML where appropriate for:

- pauses
- emphasis
- speaking rate
- pronunciation

Avoid excessive effects.

---

# 21. Audio Playback in Three.js

Create an audio manager.

Responsibilities:

- preload nearby dialogue
- play spatial sounds
- play non-spatial narrator audio
- subtitles
- stop/interrupt speech correctly
- volume settings
- accessibility mute
- prevent overlapping NPC lines
- cache resolved S3 URLs
- preload frequently reused lines

Use spatial audio for nearby NPCs.

Use non-spatial audio for narrator/story voice.

---

# 22. Ambient Audio

Not every sound should use Polly.

Use normal authored sound effects for:

- doors
- footsteps
- fire
- wind
- book flutter
- magical chimes
- chest opening
- dragon wing beats
- armor movement
- bells
- secret mechanisms

Polly is for spoken voice.

---

# 23. Persistent Castle State

Add a child castle state.

Suggested model:

```text
ChildCastleProgress
- childId
- rank
- currentChapter
- unlockedRooms[]
- discoveredSecrets[]
- completedCastleQuests[]
- collectedPages[]
- triggeredEvents[]
- castleFlags{}
- lastVisitAt
```

Do not put everything into a single enormous JSON field if it needs independent querying.

---

# 24. Artifact / Trophy System

Create an artifact catalog.

```text
ArtifactDefinition
- artifactId
- name
- modelAssetId
- sourceStoryId
- sourceChapterId
- displayLocation
- rarity
- interactionText
```

Child ownership:

```text
ChildArtifact
- childId
- artifactId
- earnedAt
```

Artifacts appear physically in the Trophy Room.

---

# 25. Lost Story Pages

Create collectible pages distributed through:

- castle exploration
- stories
- quests
- hidden rooms
- island regions

Page sets can unlock:

- secret chapters
- character lore
- new castle rooms
- cosmetic rewards
- special NPC interactions

The Lost Story Pages should become a major long-term collection mechanic.

---

# 26. Secret System

Create secrets without quest markers.

Examples:

- push loose brick
- arrange books
- pull torch
- ring bells in sequence
- follow ghost footprints
- inspect painting
- rotate statue
- place artifact on pedestal
- enter room at specific story state

Persist discovered secrets.

Never require secrets for core curriculum progression.

---

# 27. Castle Visual Progression

Castle changes should reflect accomplishments.

Examples:

- Empty portrait becomes a hero portrait.
- Artifact appears in trophy room.
- Banner is added.
- Locked wing opens.
- Dead plant begins growing.
- Dark room becomes illuminated.
- Broken statue is restored.
- Dragon begins visiting a balcony.
- Books become more active.
- Great Storybook gains restored pages.

Make progression visible without opening a menu.

---

# 28. Asset Registry

Create a central asset registry.

Example:

```json
{
  "EMBER": {
    "model": "assets/characters/ember.glb",
    "animations": [
      "idle",
      "fly",
      "land",
      "talk",
      "happy"
    ]
  }
}
```

Do not hardcode model URLs throughout React/Three.js components.

The registry should support:

- model path
- version
- preload priority
- animation names
- collider definition
- LOD
- scale
- interaction points

---

# 29. Three.js Interaction System

Create a reusable interaction interface.

Every interactive object should support something like:

```text
interactionId
interactionType
maxDistance
prompt
enabled
requiredFlags
actionId
```

Interaction types:

- TALK
- OPEN
- PICKUP
- EXAMINE
- USE
- PUSH
- PULL
- READ
- ENTER_PORTAL
- SOLVE

Use raycasting from the first-person camera.

---

# 30. Collision and Navigation

Add:

- world colliders
- simplified collision meshes
- stairs/ramp handling
- room triggers
- door triggers
- NPC navigation zones
- interaction volumes

Do not use full visual geometry as collision geometry.

Keep collision meshes simple.

---

# 31. Animation Architecture

Standardize animation naming.

Characters:

```text
Idle
Walk
Run
Talk
Wave
Point
Think
Happy
Surprised
Sad
Interact
```

Creatures:

```text
Idle
Walk
Fly
Land
Takeoff
Talk
Happy
Sleep
```

Props:

```text
Open
Close
Activate
Deactivate
Glow
Shake
```

Use an animation state controller rather than manually triggering clips throughout the codebase.

---

# 32. Performance Budgets

Set budgets before importing models.

Suggested starting targets:

## Characters

- 15k–40k triangles for major NPCs.
- Lower for background characters.
- 2K textures maximum for most characters.
- Prefer 1K where visually acceptable.

## Props

- Small prop: 500–5k triangles.
- Medium prop: 2k–15k.
- Major hero artifact: up to roughly 20k if needed.

## Castle

Use modular pieces and LOD.

Avoid one gigantic highly detailed castle GLB.

## General

- Compress textures.
- Reuse materials.
- Instance repeated geometry.
- Lazy-load remote rooms.
- Dispose Three.js resources properly.

Test on mid-range Android hardware early.

---

# 33. Asset Acquisition Order

## Buy / download first

1. Modular castle kit.
2. Bookshelf/library kit.
3. Storykeeper character.
4. Small dragon.
5. Friendly ghost.
6. Knight/armor NPC.
7. Professor/scientist NPC.
8. Generic props pack.
9. Magical artifact pack.
10. Observatory objects.

## Create custom later

Custom art budget should focus on:

- Storykeeper
- Ember
- Great Storybook
- Lost Story Page
- signature artifacts
- castle banners/logo
- portal books
- major story characters

These establish Learning Adventure Island's unique identity.

---

# 34. Asset Licensing Rules

Maintain:

```text
docs/ASSET_LICENSES.md
```

For each downloaded asset store:

```text
Asset name
Creator
Source
Source URL
License
Attribution requirement
Date downloaded
Original filename
Modified filename
```

Prefer CC0 wherever practical.

Never assume all assets from a marketplace share the same license.

---

# 35. Castle Content Administration

Create admin tools for:

- NPC definitions
- event definitions
- quests
- artifacts
- room unlocks
- story portal placement
- Polly voice configuration
- dialogue templates
- castle flags
- learning skill tags

Content designers should not need to edit TypeScript to add every castle event.

---

# 36. Observability

Log:

```text
castle.entered
castle.room.entered
castle.event.triggered
castle.secret.discovered
castle.npc.interaction
castle.quest.started
castle.quest.completed
castle.story.entered
castle.artifact.earned
castle.audio.generated
castle.audio.cache_hit
castle.ai.request
castle.ai.invalid_response
```

Do not log unnecessary child dialogue or personal information.

---

# 37. Child Safety

Because this is a children's environment:

- Never request identifying information from the child.
- Do not allow unrestricted prompting of the model.
- Filter child input.
- Use scoped NPC conversations.
- Use approved system prompts.
- Validate structured responses.
- Use age-banded content rules.
- Keep an audit trail of AI execution metadata.
- Do not expose raw model errors or system prompts.
- Include deterministic fallback dialogue.
- Have a global kill switch for generative NPC conversation.

---

# 38. Fallback Behavior

AI should never be required for the castle to function.

If the AI service fails:

- NPC uses authored fallback dialogue.
- Castle Director uses deterministic rules.
- Existing quests still run.
- Story portals still function.
- Curriculum activities still function.
- Polly audio can fall back to cached lines or text/subtitles.

The castle must remain playable during model outages.

---

# 39. Implementation Phases

## Phase 0 — Architecture Decision

Deliverables:

- Storykeeper Castle design document.
- Castle event schema.
- NPC schema.
- asset registry schema.
- voice architecture.
- AI Director schema.
- ChildCastleProgress schema.
- integration decision with existing story progress.

Exit criteria:

- Castle responsibilities clearly separated from story engine.
- AI responsibilities explicitly bounded.

---

## Phase 1 — Asset Pipeline

Deliverables:

- GLB import conventions.
- Blender export rules.
- texture conventions.
- compression pipeline.
- asset registry.
- asset license ledger.
- initial CC0 castle kit.

Exit criteria:

- One room loads through asset registry.
- Asset can be swapped without changing game logic.

---

## Phase 2 — Grand Hall Vertical Slice

Build:

- Grand Hall.
- first-person movement.
- collision.
- Storykeeper.
- Great Storybook.
- one door.
- one artifact pedestal.
- interaction raycast.

Exit criteria:

Child can:

- enter castle
- walk around
- approach Storykeeper
- interact with Great Storybook
- leave through a door

---

## Phase 3 — Library Vertical Slice

Build:

- Grand Library.
- bookshelves.
- portal book.
- secret bookshelf.
- floating book event.
- Lost Story Page collectible.

Exit criteria:

Child can discover a story physically in the library and launch the same chapter used by the normal story interface.

---

## Phase 4 — Castle Progression

Build:

- ChildCastleProgress.
- room unlocks.
- page collectibles.
- artifact ownership.
- Trophy Room.
- Hall of Heroes.

Exit criteria:

Completing a story changes the castle on the next visit.

---

## Phase 5 — Amazon Polly

Build:

- Polly service.
- configured NPC voices.
- MP3 output.
- S3 storage.
- audio metadata.
- text hash/cache.
- Three.js playback.
- subtitles.

Exit criteria:

NPC dialogue generates once and is reused from S3 on repeated playback.

---

## Phase 6 — NPC Framework

Build:

- NPC definitions.
- interaction system.
- dialogue UI.
- animation controller.
- voice playback integration.
- deterministic scripted dialogue.

Exit criteria:

Storykeeper and Ember can perform multi-turn authored interactions.

---

## Phase 7 — AI NPC Dialogue

Build:

- bounded NPC prompts.
- safe child context.
- structured AI response.
- validation.
- fallback dialogue.
- Polly synthesis.

Exit criteria:

Storykeeper can respond dynamically while staying within approved castle/story context.

---

## Phase 8 — Castle Director

Build:

- session context builder.
- available-event filtering.
- AI event recommendation.
- quest recommendation.
- learning target input.
- event cooldowns.
- deterministic fallback selector.

Exit criteria:

Two children with different progress can enter the same castle and receive different appropriate events.

---

## Phase 9 — Learning Director Integration

Build:

- curriculum skill input.
- difficulty selection.
- quest template connection.
- deterministic answer checking.
- hint generation.

Exit criteria:

A castle quest can reinforce a specific skill without presenting itself as a worksheet.

---

## Phase 10 — Dynamic Events

Implement at least ten:

1. Armor sneezes.
2. Book escapes.
3. Ghost crosses hallway.
4. Ember flies past window.
5. Painting calls for help.
6. Secret footprints appear.
7. Chest shakes.
8. Lights fail.
9. Mouse steals key.
10. Hidden door opens.

Exit criteria:

The castle no longer feels static during normal traversal.

---

## Phase 11 — New Castle Wings

Add incrementally:

1. Observatory
2. Inventor's Workshop
3. Potion Laboratory
4. Map Room
5. Forgotten Dungeon
6. Tower of Tales

Each room must add a gameplay function.

Do not add rooms simply as scenery.

---

## Phase 12 — Cross-Story AI

Allow AI to reference approved completed-story facts.

Example:

- Ember was rescued.
- Pirate compass found.
- Wizard met.
- Moon rock recovered.

AI may combine approved facts into a new setup using existing quest templates.

Exit criteria:

Returning players experience continuity between separate adventures.

---

## Phase 13 — Optimization

Implement:

- GLB compression.
- texture compression.
- LOD.
- instancing.
- room streaming.
- model preload queues.
- audio preload.
- S3/CloudFront caching.
- mobile performance tests.

Exit criteria:

Stable target frame rate on representative Android devices and desktop browsers.

---

## Phase 14 — Content Expansion

Add:

- more Lost Story Pages
- secrets
- NPC relationship milestones
- artifacts
- seasonal decorations
- rare castle events
- secret stories
- advanced castle wings

This phase should be content-driven rather than requiring major architecture changes.

---

# 40. MVP Model List

For the first truly playable upgrade, obtain only:

### Environment

- Modular castle kit
- Library kit
- Grand Hall props
- Trophy pedestals
- doors
- stairs
- fireplace
- chandeliers

### Characters

- Storykeeper
- Ember dragon
- friendly ghost
- knight/armor

### Interactive props

- Great Storybook
- regular book
- floating book
- Lost Story Page
- lever
- key
- chest
- secret brick
- portal
- artifact pedestal

### Artifacts

- Dragon egg
- compass
- wand
- crystal
- shield

That is enough to prove the entire system.

Do not begin with 100+ models.

---

# 41. Recommended Source Strategy

## Kenney

Best for:

- base castle geometry
- modular pieces
- prototyping
- consistent low-poly style

Use Castle Kit as an initial structural baseline where suitable.

## Poly Haven

Best for:

- CC0 textures
- environmental props
- materials
- HDRIs if needed

All Poly Haven assets are CC0.

## Sketchfab

Best for:

- specific fantasy characters
- dragons
- specialty props
- unusual environment pieces

Check every asset license individually.

Prefer downloadable GLB/glTF models with clear commercial-use rights.

---

# 42. Suggested Repository Structure

```text
src/
  castle/
    ai/
      CastleDirector.ts
      CastleContextBuilder.ts
      CastleResponseValidator.ts
    audio/
      AudioManager.ts
      PollyAudioClient.ts
    events/
      CastleEventEngine.ts
      CastleEventRegistry.ts
    interactions/
      InteractionManager.ts
      InteractionRegistry.ts
    npc/
      NPCController.ts
      NPCRegistry.ts
      NPCDialogueController.ts
    rooms/
      GrandHall/
      Library/
      TrophyRoom/
      Observatory/
    progression/
      CastleProgressService.ts
    assets/
      AssetRegistry.ts

amplify/
  functions/
    castle-director/
    npc-dialogue/
    synthesize-voice/

docs/
  STORYKEEPER_CASTLE.md
  CASTLE_AI.md
  CASTLE_ASSET_GUIDE.md
  CASTLE_EVENTS.md
  CASTLE_VOICE_SYSTEM.md
  ASSET_LICENSES.md
```

Adjust to the project's existing structure rather than duplicating an established convention.

---

# 43. Recommended First Implementation Milestone

Do not build the whole castle first.

Build this exact slice:

1. Grand Hall.
2. Library.
3. Storykeeper.
4. Ember.
5. Great Storybook.
6. One portal book.
7. One multiplication-based dragon quest.
8. One artifact reward.
9. Trophy Room pedestal.
10. One secret Lost Story Page.
11. Three ambient events.
12. Amazon Polly voice generation.
13. S3 audio caching.
14. AI Storykeeper dialogue.
15. Castle Director chooses one event on entry.

When that works, the architecture has proven nearly every major concept.

---

# 44. Definition of Done

Storykeeper Castle is no longer just a 3D location when:

- The child has a reason to visit.
- Something can happen unexpectedly.
- NPCs remember approved past accomplishments.
- Stories can be discovered physically.
- Learning targets affect adventures.
- Completed stories visibly change the castle.
- Artifacts appear permanently.
- secrets reward exploration.
- AI personalizes the experience.
- AI cannot bypass game rules.
- NPC voice is generated with Amazon Polly.
- generated MP3s are stored and cached in S3.
- the experience works without AI if necessary.
- progress remains compatible with the existing story system.

The end goal is for the child to feel:

> "I wonder what changed in the castle today?"

