# P1 movement and platforming: owner QA guide

Covers all three P1 workstreams on one branch, `feature/pirates-leap` (the latest stacked branch):

1. Running and sprinting (PR #29, ADR-058; `docs/PLAYER_RUNNING_AND_SPRINTING.md`).
2. Shared platforms, checkpoints and recovery (PR #37, ADR-059; `docs/PLATFORMING.md`).
3. Treasure Cove: Pirate's Leap (PR on `feature/pirates-leap`; `docs/PIRATES_LEAP.md`).

Stack: `main` <- `integration/p1-movement-base` (avatar stack, Amplify-free main, derived
colliders, collision profiles, running) <- `feature/interactive-platforms` <- `feature/pirates-leap`.
Development is unit- and engine-tested only; everything below is owner QA, not yet done.

## Local setup

Requires Node.js 22+, Python 3.12+, Docker (PostgreSQL 16). No Amplify sandbox.

```bash
git fetch origin feature/pirates-leap
```
```bash
git checkout -B feature/pirates-leap origin/feature/pirates-leap
```
```bash
npm install
```
```bash
make py-install
```
```bash
cp -n .env.sample .env
```

Fill in `.env` (the existing Cognito pool; Django verifies its tokens and `npm run dev` reuses it):

```
COGNITO_REGION=us-west-1
COGNITO_USER_POOL_ID=<pool id>
COGNITO_ALLOWED_CLIENT_IDS=<web app client id>
```

Database, migrations and content (the content import brings Pirate's Leap's quest, items and
rewards; the seed writes the course; the publish makes it playable locally):

```bash
make up
```
```bash
make migrate
```
```bash
cd lai && ../.venv/bin/python manage.py load_content && ../.venv/bin/python manage.py seed_treasure_rush && ../.venv/bin/python manage.py publish_treasure_rush && ../.venv/bin/python manage.py ensure_asset_roles && cd ..
```
```bash
make createsuper
```

Run (two terminals), then open http://localhost:5183/ and sign in as a test parent:

```bash
make runserver
```
```bash
make web
```

Navigation: choose a child > Island > Pirate Builder Bay > Treasure Cove (Realms). From Pirate
Landing walk south-west past Palm Tree Grove to the "Pirate's Leap: training course" signpost.
Pip at the landing offers "Pirate's Leap".

New migrations on this stack: `assets/0003_collision_profiles` (collision profiles). The platform and
Pirate's Leap work needs no migration.

## Checklist

### Desktop keyboard and mouse
- [ ] WASD and arrows walk; left and right are not swapped; Shift held sprints; the Shift tap setting toggles sprint.
- [ ] Space jumps; V switches camera; E or Enter interacts; nothing happens while typing in a text box.
- [ ] Opening a panel or switching tabs stops sprinting and clears held keys.

### Mobile phone and tablet
- [ ] A short drag walks, a longer drag runs, past the edge sprints; the Jump button works while moving.
- [ ] Camera drag, movement and Jump at the same time; Backpack, Hint, Exit, View and Jump do not overlap.

### Gamepad
- [ ] Left stick walks to running by tilt; L3 sprints; A jumps; X interacts; Y switches camera; right stick looks.

### First- and third-person
- [ ] The whole course plays in both views; the avatar runs (Run clip, or a faster Walk) and lands cleanly.
- [ ] Camera stays steady on moving platforms and the lift; the sprint view widening is subtle (off with reduced motion).

### Running and sprinting
- [ ] Speeds change smoothly; running jumps go further than walking jumps; jump height is unchanged.

### Moving platforms
- [ ] The ferry waits at each bank, carries you across, and you can jump on and off it.
- [ ] The lift: the gold plate wakes it, it waits before leaving, carries you up and down; it never comes down on you.
- [ ] A platform never pushes you through a wall or traps you; the sinking barrel blinks, vanishes, and comes back.
- [ ] The bounce drum throws you up; you can steer onto the ledge.

### Jumping, landing and collision
- [ ] You cannot walk through barrels, logs, posts, trees, rocks or Pip; low ones can be jumped onto.
- [ ] The ruins gate and the channel still hold at full sprint.

### Checkpoint recovery
- [ ] Flags mark checkpoints; "Safe spot: ..." appears; falling in the water says "Splash! Back to ..." and returns you there.
- [ ] Nothing collected is lost; no lives, no game over, no timer.

### Pirate's Leap completion, educational interactions, rewards and replay
- [ ] Pip's zone messages introduce each section; the quest is offered by Pip.
- [ ] Pip's riddle drum asks an age-appropriate counting question; solving it raises the plank bridge at once; skipping it is fine.
- [ ] The secret treasure opens with a gentle question; the Medal and quest completion appear; the shell and feather are picked up once.
- [ ] Replay the course: the chest stays open; no reward is given twice; re-entering the cove keeps everything.
- [ ] The rest of Treasure Cove (Pip's Missing Treasure, the lookout) works as before.

### Staff (Django Admin)
- [ ] Regions > 3D Areas > Treasure Cove > Edit content: `platformTuning` slows the ferry or disables the sinking barrel; a bad value is refused.
- [ ] Assets > Collision profiles: a profile changes how an asset blocks (preview: Show collision).

## Automated tests run (development policy: unit tests only)

See each PR: Vitest (island-map, region-play, platforms, content export, routes, api) and pytest
(regions, game sessions, quests, inventory, catalog, education, audio, users, core). Browser,
WebGL, device, gamepad and Playwright checks are deferred to merge readiness.
