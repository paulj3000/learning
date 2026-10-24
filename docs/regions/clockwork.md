# Learning Adventure Island — Clockwork Harbor Implementation Roadmap

## 1. Overview

**Clockwork Harbor** is a major explorable region within Learning Adventure Island.

The region is a colorful mechanical seaside town powered by an ancient machine known as the **Heart of the Harbor**. When the harbor's machinery begins failing, the player must investigate the town, recover missing components, solve increasingly complex problems, discover what happened, and ultimately repair the Heart of the Harbor before the Moon Tide arrives.

Clockwork Harbor should feel like an adventure game first and an educational experience second.

The player should experience:

- Exploration
- Mystery
- NPC interaction
- Physical puzzles
- Collectibles
- Hidden areas
- Environmental changes
- Story progression
- Rewards
- Adaptive learning challenges

Educational difficulty must be based primarily on **demonstrated skill level**, not age or grade.

## 2. Core Design Principles

### 2.1 Adventure First

Never present Clockwork Harbor as a sequence of worksheets.

Instead of:

> Solve 8 × 7.

Use:

> The lift needs 56 units of power. Each power cell produces 8 units. How many cells should you install?

The educational challenge should have an in-world purpose.

### 2.2 One World, Multiple Skill Levels

The 3D environment and overall story remain the same regardless of the player's learning level.

Difficulty changes through:

- Puzzle complexity
- Reading complexity
- Number size
- Number of reasoning steps
- Vocabulary
- Available hints
- Distractors
- Time constraints where appropriate
- Amount of information the player must infer

Do not create separate versions of Clockwork Harbor for different ages.

### 2.3 Persistent World Changes

Completing quests should visibly affect the world.

Examples:

- Lighthouse begins rotating.
- Harbor lamps illuminate.
- Drawbridge operates.
- Ships enter the harbor.
- Mechanical animals return.
- Shops reopen.
- NPC dialogue changes.
- Heart of the Harbor begins operating.
- Previously inaccessible locations become available.

The player should feel:

> I fixed this place.

## 3. Adventure Story

### Main Conflict

Clockwork Harbor is powered by an enormous ancient machine beneath the town.

The machine begins malfunctioning.

Symptoms appear throughout the harbor:

- Lighthouse stops.
- Harbor clock runs backward.
- Drawbridge fails.
- Mechanical creatures escape.
- Water pumps malfunction.
- Ships cannot enter.
- Strange sounds come from beneath the streets.

A small mechanical creature named **Cog** appears to be stealing components.

Initially, NPCs believe Cog caused the disaster.

The player eventually discovers that Cog was actually trying to repair the Heart of the Harbor.

The true problem is that the ancient machine is failing.

A dangerous **Moon Tide** is approaching.

The player must repair the machine before the harbor floods.

## 4. Major Characters

### Cog

Small mechanical companion.

Personality:

- Curious
- Mischievous
- Friendly
- Easily distracted
- Brave
- Nonverbal or minimally verbal initially

Cog becomes the player's companion after the Market Mystery.

Cog can later:

- Detect hidden mechanisms.
- Point toward clues.
- Enter small passages.
- Activate mechanical devices.
- React to discoveries.
- Help deliver hints.

### Professor Ticktock

Eccentric inventor.

Functions as:

- Story character
- Quest giver
- Engineering guide
- AI tutor
- Hint provider

Professor Ticktock should never feel like a classroom teacher.

He helps the child reason through problems rather than immediately providing answers.

### Harbor Master

Introduces the region and the lighthouse emergency.

### Market NPCs

Examples:

- Baker
- Fisherman
- Merchant
- Sailor
- Dock worker
- Clockmaker

These characters become witnesses during the Market Mystery.

## 5. Region Layout

Create Clockwork Harbor as interconnected districts.

```text
Harbor Entrance
      |
      v
    Docks
      |
      +---------- Lighthouse
      |
      v
Marketplace
      |
      +---------- Clock Tower
      |
      v
Drawbridge
      |
      v
Inventor District
      |
      +---------- Mechanical Menagerie
      |
      v
Professor Ticktock's Workshop
      |
      v
Underground Entrance
      |
      v
Ancient Tunnels
      |
      v
Heart of the Harbor
```

Include optional alleys, rooftops, tunnels, warehouses, caves, and secret rooms.

## 6. Phase 0 — Technical Foundation

### Goal

Establish Clockwork Harbor as a proper Learning Adventure Island region before building individual adventures.

### Region Registration

Add Clockwork Harbor to the world/region registry.

Store:

- Region ID
- Display name
- Description
- Thumbnail
- Starting location
- Required progression
- Region state
- Available quests

Suggested ID:

```text
clockwork-harbor
```

### Player Region Progress

Track:

```text
NOT_STARTED
DISCOVERED
IN_PROGRESS
COMPLETED
MASTERED
```

Store separately from learning skill.

### Quest System Integration

Clockwork Harbor must use the shared LAI quest system.

Quest state:

```text
LOCKED
AVAILABLE
ACTIVE
COMPLETED
```

Support:

- Main quests
- Side quests
- Hidden quests
- Repeatable activities

### World State

Create persistent Clockwork Harbor state.

```json
{
  "lighthouseFixed": false,
  "marketMysterySolved": false,
  "drawbridgeFixed": false,
  "animalsRecovered": [],
  "workshopUnlocked": false,
  "undergroundUnlocked": false,
  "heartRestored": false,
  "goldenGearsFound": []
}
```

This state determines what the Three.js world displays.

## 7. Phase 1 — Skill Engine Foundation

### Goal

Separate educational difficulty from age.

Create a reusable Learning Profile that can eventually be used throughout Learning Adventure Island.

### Initial Skill Domains

Track:

```text
math
reading
vocabulary
logic
science
spatial
```

Each domain should contain:

```json
{
  "level": 3,
  "confidence": 0.78,
  "attempts": 14,
  "successes": 11
}
```

### Difficulty Scale

#### Level 1 — Explorer
Recognition, matching, counting, simple instructions.

#### Level 2 — Adventurer
Basic arithmetic, simple reading, basic patterns.

#### Level 3 — Pathfinder
Multiplication/division, paragraphs, multi-step problems.

#### Level 4 — Trailblazer
Fractions, geometry, inference, complex patterns.

#### Level 5 — Master Explorer
Algebraic thinking, optimization, advanced reasoning.

#### Level 6+ — Challenge Levels
Open-ended and increasingly complex challenges.

## 8. Phase 2 — Adaptive Challenge Engine

Create a shared challenge model.

A challenge should specify:

```text
challengeId
questId
skillDomain
skillLevel
challengeType
prompt
solution
hintLevels
attemptLimit
reward
```

Support challenge types such as:

```text
MULTIPLE_CHOICE
NUMBER_INPUT
TEXT_INPUT
MATCHING
SEQUENCE
OBJECT_PLACEMENT
MECHANICAL
DIALOGUE
EXPLORATION
INFERENCE
```

### Adaptive Rules

Successful performance increases confidence.

Repeated success can increase difficulty.

Failure should NOT immediately reduce skill level.

Preferred behavior:

```text
Failure
  |
  v
Contextual Hint
  |
  v
Second Attempt
  |
  v
Visual Demonstration
  |
  v
Simplified Version
```

Record performance for future adaptation.

## 9. Phase 3 — Clockwork Harbor MVP Environment

### Goal

Create a playable harbor before implementing the entire story.

Build:

- Harbor entrance
- Dock
- Lighthouse exterior
- Lighthouse interior
- Basic marketplace
- Initial NPCs

The player must be able to:

- Walk
- Look around
- Interact
- Talk to NPCs
- Pick up items
- Open doors
- Activate mechanisms

## 10. Phase 4 — Chapter One: The Dark Lighthouse

The player arrives at Clockwork Harbor.

The harbor gate cannot safely open because the lighthouse has stopped operating.

The Harbor Master asks for help.

Player explores:

- Dock
- Lighthouse grounds
- Lighthouse interior

Player discovers the lighthouse power mechanism.

### Adaptive Puzzle

The objective remains:

> Restore power to the lighthouse.

Difficulty varies according to math/logic skill.

Possible challenges include:

- Counting crystals
- Determining required power
- Multiplication
- Division
- Pattern recognition
- Multi-step power calculations
- Optimization

### Completion Event

Animate:

- Generator starting.
- Gears turning.
- Lighthouse beam illuminating.
- Lighthouse rotating.
- Harbor gate opening.
- Ships reacting.

Update:

```text
lighthouseFixed = true
```

Unlock:

```text
Marketplace
```

## 11. Phase 5 — Chapter Two: The Market Mystery

Introduce reading comprehension, deduction, NPC interaction, and investigation.

The player learns that one of the Great Harbor Gears is missing.

Witnesses claim Cog stole it.

The player investigates.

### Investigation System

Allow players to collect:

```text
Clues
Witness statements
Objects
Times
Locations
Observations
```

Add a simple **Investigation Journal**.

### Skill Scaling

Lower levels:

- Follow directions.
- Identify objects.
- Read short statements.
- Match witnesses with locations.

Higher levels:

- Compare testimony.
- Calculate elapsed time.
- Construct timelines.
- Detect contradictions.
- Infer Cog's route.

### Ending

Player finds Cog.

Reveal:

Cog wasn't simply stealing the gear.

Cog was attempting to repair something.

Cog joins the player.

Update:

```text
marketMysterySolved = true
companionCogUnlocked = true
```

## 12. Phase 6 — Chapter Three: The Broken Drawbridge

Create an interactive gear room.

Player can:

- Pick up gears.
- Rotate gears.
- Place gears.
- Remove gears.
- Activate mechanism.
- Observe results.

### Skill Scaling

- Explorer: shape/size/color matching.
- Adventurer: gear patterns and sequences.
- Pathfinder: multiplication and ratios.
- Trailblazer: gear ratios and rotation.
- Master Explorer: optimize a gear train for a target output.

### Completion

Animate the complete mechanism.

Drawbridge lowers.

Update:

```text
drawbridgeFixed = true
```

Unlock:

```text
Inventor District
```

## 13. Phase 7 — Mechanical Menagerie

Professor Ticktock's mechanical creatures have escaped.

Create:

- Clockwork Fox
- Brass Turtle
- Gearwing Owl
- Springtail Rabbit
- Copper Crab

Each animal becomes a mini-adventure.

### Example: Gearwing Owl

Located on a rooftop.

Player must determine how to reach it using:

- Crates
- Ladders
- Balconies
- Rooftops

Tests spatial reasoning.

### Creature State

```json
{
  "clockworkFox": false,
  "brassTurtle": false,
  "gearwingOwl": false,
  "springtailRabbit": false,
  "copperCrab": false
}
```

Returning creatures should produce visible changes inside Professor Ticktock's workshop.

## 14. Phase 8 — Professor Ticktock's Workshop

Build a large interactive workshop.

This becomes a reusable STEM activity center.

Stations can include:

- Gear Table
- Crane
- Balance Table
- Pipe Machine
- Bridge Table
- Circuit Bench
- Magnet Table

Activities should support experimentation and multiple valid solutions where practical.

## 15. Phase 9 — AI Professor Ticktock

Integrate AI dialogue.

Professor Ticktock should receive contextual information including:

```text
Current quest
Current puzzle
Skill domain
Skill level
Attempts
Previous hints
Player answer
Expected concept
```

The AI should provide Socratic assistance.

Avoid immediately giving answers.

Hint progression:

```text
Observation
     ↓
Question
     ↓
Small Hint
     ↓
Strong Hint
     ↓
Demonstration
     ↓
Simplified Challenge
```

### Voice

Use **Amazon Polly** for generated NPC speech.

Store generated audio in **Amazon S3**.

Cache speech so identical dialogue does not require repeated generation.

```text
AI Dialogue
    ↓
Text Generated
    ↓
Speech Cache Lookup
    ↓
Already Exists? ── YES → S3 audio
    |
    NO
    ↓
Amazon Polly
    ↓
MP3
    ↓
S3
    ↓
Three.js NPC playback
```

## 16. Phase 10 — Beneath the Harbor

Unlock the underground region.

Create:

- Sewer entrance
- Maintenance tunnels
- Ancient mechanical tunnels
- Underground waterfall
- Crystal chambers
- Abandoned control rooms
- Ancient doors

The visual tone should become more mysterious.

The player begins realizing Clockwork Harbor was constructed around something much older.

## 17. Phase 11 — Environmental Puzzle Systems

Introduce interconnected environmental puzzles.

Examples:

- Water Routing
- Power Routing
- Pressure
- Counterweights
- Ancient Symbols
- Mechanical Doors

Challenges can combine multiple skill domains.

## 18. Phase 12 — Heart of the Harbor Finale

The player reaches the Heart of the Harbor.

Reveal that Cog discovered the machine was failing and had been attempting to repair it.

The Moon Tide is approaching.

### Final Challenge Sequence

#### Stage 1 — Decode ancient instructions

Primary skills:

```text
reading
vocabulary
logic
```

#### Stage 2 — Recover and identify required components

Primary skills:

```text
exploration
logic
```

#### Stage 3 — Construct the gear system

Primary skills:

```text
math
spatial
logic
```

#### Stage 4 — Route power

Primary skills:

```text
logic
science
```

#### Stage 5 — Configure water gates

Primary skills:

```text
math
logic
spatial
```

#### Stage 6 — Activate the Heart

## 19. Phase 13 — World Transformation

The finale should dramatically transform Clockwork Harbor.

Before:

```text
Dark lighthouse
Broken bridge
Empty docks
Broken machinery
Closed stores
Nervous NPCs
```

After:

```text
Rotating lighthouse
Moving ships
Operating bridge
Busy docks
Open stores
Working machinery
Mechanical animals roaming
Celebrating NPCs
```

Add music and ambient effects.

NPC dialogue should acknowledge the player's accomplishment.

## 20. Phase 14 — Rewards

Avoid relying solely on XP.

Provide persistent rewards.

- Lighthouse: Personal lantern.
- Market Mystery: Cog companion.
- Drawbridge: Mechanical tool.
- Menagerie: Mechanical creature collection.
- Workshop: Portable inventor kit.
- Finale: **Keeper of Clockwork Harbor** title.

## 21. Phase 15 — Golden Gear Secrets

Hide **12 Golden Gears** throughout Clockwork Harbor.

Some should require:

- Exploration
- Puzzle solving
- Cog abilities
- Returning after story progression
- Environmental manipulation

Track:

```text
goldenGearsFound: 0-12
```

Finding all twelve opens a secret chamber beneath Professor Ticktock's workshop.

## 22. Phase 16 — Secret Ending

Inside the secret chamber is an ancient machine.

Activating it projects a map.

The map reveals another unexplored location beyond Learning Adventure Island.

Do not fully explain it.

Use this as a teaser for a future region/adventure.

## 23. Phase 17 — Side Quests

Add side quests such as:

- Fisherman's Missing Cargo
- Broken Bakery Machine
- Clockmaker's Challenge
- Harbor Delivery
- Boat Builder
- Merchant Mystery

## 24. Phase 18 — Daily/Rotating Challenges

Once the region is completed, Professor Ticktock can provide rotating challenges.

Examples:

```text
Today's Machine
Gear Challenge
Bridge Challenge
Mystery of the Day
Hidden Cog Challenge
Engineering Challenge
```

Difficulty derives from the player's Learning Profile.

## 25. Phase 19 — Learning Analytics

Record more than correct/incorrect answers.

Capture:

```text
challengeId
skill
skillLevel
startedAt
completedAt
attemptCount
hintsUsed
answerHistory
completionTime
success
```

Use this information to update the Learning Profile.

Do not punish experimentation in open-ended engineering challenges.

## 26. Phase 20 — Parent/Teacher Visibility

Expose useful progress information without reducing the experience to grades.

Example:

```text
Clockwork Harbor

Story Progress: 72%

Skills Demonstrated

Math              Level 3 ↑
Logic             Level 4 ↑
Reading           Level 2
Spatial Reasoning Level 3 ↑

Recent Strengths:
• Multiplication
• Pattern recognition
• Spatial reasoning

Currently Developing:
• Multi-step reading comprehension
• Fractions
```

Allow teachers/parents to see:

- Skills practiced
- Skills mastered
- Areas of difficulty
- Hint usage
- Progress over time

## 27. Phase 21 — 3D Asset Requirements

Create or source GLB assets for:

### Environment

- Harbor buildings
- Dock
- Boats
- Lighthouse
- Market stalls
- Clock tower
- Drawbridge
- Workshop
- Underground tunnels
- Ancient machinery

### Mechanical Assets

- Gears
- Levers
- Valves
- Pipes
- Cranks
- Chains
- Pulleys
- Pressure gauges
- Generators
- Power crystals

### Characters

- Professor Ticktock
- Harbor Master
- Sailors
- Merchants
- Fishermen
- Dock workers

### Creatures

- Cog
- Clockwork Fox
- Brass Turtle
- Gearwing Owl
- Springtail Rabbit
- Copper Crab

All important interactive assets should be separate objects rather than baked into a single environment mesh.

## 28. Phase 22 — Audio

Add:

- Harbor ambience
- Ocean
- Seagulls
- Ship bells
- Clock ticking
- Mechanical gears
- Steam
- Metal impacts
- Underground water
- Machine startup
- Lighthouse machinery

NPC dialogue pipeline:

```text
Text
 ↓
Amazon Polly
 ↓
MP3
 ↓
S3
 ↓
Cached playback
```

## 29. Phase 23 — Performance Optimization

Implement:

- GLB compression
- Texture compression
- LOD
- Instancing
- Frustum culling
- Asset streaming
- Region-based loading
- Audio streaming
- Object pooling where appropriate

Do not load the underground environment when the player is walking around the marketplace.

## 30. Recommended Implementation Order

### Milestone 1 — Foundation

```text
Region
World state
Quest state
Learning Profile
Challenge engine
```

### Milestone 2 — Playable Harbor

```text
Docks
Lighthouse
Harbor Master
Basic interactions
```

### Milestone 3 — First Complete Adventure

```text
Arrival
→ Lighthouse puzzle
→ Lighthouse repaired
→ Marketplace unlocked
```

### Milestone 4 — Mystery

```text
Marketplace
Investigation system
Cog
Market Mystery
```

### Milestone 5 — Mechanical Gameplay

```text
Drawbridge
Gear system
Physical puzzles
```

### Milestone 6 — World Depth

```text
Inventor District
Mechanical creatures
Secrets
Collectibles
Exploration
```

### Milestone 7 — AI

```text
Professor Ticktock
AI hints
Adaptive difficulty
Amazon Polly
S3 voice cache
```

### Milestone 8 — Underground

```text
Tunnels
Environmental puzzles
Ancient machinery
```

### Milestone 9 — Finale

```text
Heart of the Harbor
Moon Tide
Final puzzle sequence
World transformation
```

### Milestone 10 — Replayability

```text
Golden Gears
Side quests
Daily challenges
Secret ending
```

### Milestone 11 — Learning Platform Integration

```text
Skill analytics
Parent dashboard
Teacher dashboard
Skill recommendations
Cross-region Learning Profile
```

## 31. Definition of Done

Clockwork Harbor is complete when a child can:

- Enter and freely explore the harbor.
- Discover things without being explicitly directed to them.
- Interact with meaningful NPCs.
- Complete the full story.
- Solve challenges appropriate to demonstrated skill.
- Receive progressively useful hints.
- Manipulate physical objects.
- Repair machines.
- Collect mechanical creatures.
- Discover secrets.
- Find Golden Gears.
- Unlock Cog.
- Experience visible environmental changes.
- Return after completing the story and find new activities.
- Receive challenges adapted to current abilities.

Most importantly:

> **The child should remember saving Clockwork Harbor—not taking a math or reading lesson.**

## 32. Architectural Goal Beyond Clockwork Harbor

Several systems developed for Clockwork Harbor should become shared Learning Adventure Island infrastructure:

```text
Learning Profile
Adaptive Challenge Engine
AI Hint Engine
Physical Puzzle Framework
Investigation System
Companion System
Collectible System
Persistent World State
Environmental Transformation System
NPC Dialogue System
Polly/S3 Voice Pipeline
Learning Analytics
```

Storykeeper Castle, Wonderwild Forest, Clockwork Harbor, and future regions should consume these shared systems rather than developing independent learning engines.

Long-term architecture:

```text
                 Learning Profile
                        |
               Adaptive Skill Engine
                        |
                 Challenge Engine
                        |
       +----------------+----------------+
       |                |                |
       v                v                v
 Storykeeper       Wonderwild       Clockwork
   Castle            Forest           Harbor
       |                |                |
       +----------------+----------------+
                        |
                 Shared World Systems
                        |
      +---------+-------+-------+---------+
      |         |       |       |         |
     NPCs     Quests   AI    Rewards   Analytics
```

Clockwork Harbor should prove that Learning Adventure Island can deliver a **single adventure world that dynamically adapts educational content to each child's actual abilities**.

