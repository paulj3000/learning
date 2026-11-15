# Movement defects, campfire and feather: owner QA guide (2026-11-15)

Branch: `feature/treasure-rush-palm-trees`. Decision: ADR-060 (Proposed). Status: development
complete and unit-tested; **not seen in a browser, on a device or with a gamepad**; owner QA
pending. Nothing deployed; no AWS change.

## 1. What changed and why

| Item | Root cause | Fix |
| --- | --- | --- |
| **P0: avatar walks away from the camera when blocked** | `withoutRootMotion` dropped position tracks only on the model's top-level nodes. A Mixamo-style rig keeps a walk's forward travel on its hips bone (`Scene > Armature > mixamorigHips`), so the visible body travelled up to 1.5 m from the controller's position, worst when backing toward the camera into a wall. Secondary: gait came from the velocity asked for, and a blocked child stopped a few centimetres short of the wall and re-entered the gap next frame (walk/idle flicker). | `withoutRootMotionFor` pins every skeleton root bone horizontally (vertical bob kept). Gait, state and walk playback use `locomotionSpeed`, the distance really covered (platform carry excluded). Blocked steps come up flush. The third-person boom lifts gently over a wall behind the child. |
| **P0: child walks into Storykeeper Castle's walls** | The controller tested a single point (the feet) against every collider. | A configurable cylindrical footprint: radius **0.35 m** + skin **0.02 m** (so 0.37 m from any solid face), circle-versus-box blocking. One castle layout fix: the costume racks stand back at z -9.2 (rack c was 0.3 m from the Trophy Room door's landing point). Every other castle collider already matched its wall. |
| **P1: the Parrot Feather shows as a key** | `regionPlayScene` drew every region pickup with `builtKey()`. It was written when the beach key was the only pickup; Pirate's Leap later added the Sparkly Shell and the Parrot Feather as model-less pickups, so both looked like keys. | Each pickup is drawn as what it is (`pickupLook.ts`: feather, shell, key, or a neutral gem; never a key unless it is one), and as its published model when there is one. The Backpack icon is a coin for every keepsake, never a key, so it needed no change. |
| **P1: campfire model** | Treasure Cove's campfire was primitives. | The Kenney campfire through the Asset Manager; the primitive flame stays on top (the model has none). |

## 2. Assets

| | Campfire | Feather |
| --- | --- | --- |
| Asset id | `campfire` (new; none existed) | `feather` (new; none existed) |
| Version | v1 once imported | v1 once imported |
| Source file | `kenney_survival-kit.zip` > `Models/GLB format/campfire-pit.glb` + `Textures/colormap.png` | `light_princess_feather_lowpoly.zip` > `scene.gltf` + `scene.bin` |
| Source | Kenney, Survival Kit 2.0, https://kenney.nl/assets/survival-kit | dudecon, "Light Princess Feather LowPoly", https://sketchfab.com/3d-models/light-princess-feather-lowpoly-d423b5a3e60c43faa21953c9b14e105b |
| Licence | CC0 1.0 (the ZIP's `License.txt`) | **CC-BY-4.0** (its `license.txt` and glTF `asset.extras`), https://creativecommons.org/licenses/by/4.0/ |
| Publishable now | Yes | **Only with `--licence-confirmed`** (you accept CC-BY-4.0 and its credit) |
| Prepared size | 1.10 x 0.43 x 1.07 m, 305 triangles, 25,980 bytes | 0.15 x 0.55 x 0.14 m, 35 triangles, 2,324 bytes |
| Source digest (importer) | `42950786...6e213` | `e9daf3be...c5c0ea` |
| Collision profile (default, created if none) | `CYLINDER`, `SOLID`, upright, radius 0.55 m, height 0.45 m (never jumpable; flames add no height) | `NONE`, `DECORATIVE` (never blocks) |
| Placement | Treasure Cove `cove-campfire` (layout v9; collider now a 1.2 m square, was 1.6 m) | Pirate's Leap `cove-leap-feather` (the seed links it once the asset exists) |
| Fallback | The primitive stones, logs and flame | The primitive feather (never a key) |

**Licence discrepancy (feather).** The brief named Pixor's CC0 feather; the supplied ZIP is a
different model under CC-BY-4.0, which requires this credit wherever the game credits assets:

> This work is based on "Light Princess Feather LowPoly" (https://sketchfab.com/3d-models/light-princess-feather-lowpoly-d423b5a3e60c43faa21953c9b14e105b) by dudecon (https://sketchfab.com/dudecon) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

The importer records it on the definition and version and writes it into the file's
`asset.copyright`. The licence page you sent (`ip.tryop.com`) could not be reached from the
development session, so it was not checked. Until you publish with `--licence-confirmed` (or send
the Pixor CC0 GLB instead), the game draws its primitive feather. No model file is in Git.

## 3. Local update commands

From the repository root, with your local PostgreSQL running (`make up`):

```bash
git fetch origin feature/treasure-rush-palm-trees
```

```bash
git checkout feature/treasure-rush-palm-trees && git pull --ff-only origin feature/treasure-rush-palm-trees
```

```bash
npm install && make py-install
```

```bash
make migrate
```

No new migration (`makemigrations --check`: no changes). Then import the two models, **before**
reseeding, with the ZIPs you supplied (paths are examples; keep them outside the repository):

```bash
cd lai && ../.venv/bin/python manage.py import_treasure_rush_environment --source ~/Downloads/kenney_survival-kit.zip --category campfire --dry-run && cd ..
```

```bash
cd lai && ../.venv/bin/python manage.py import_treasure_rush_environment --source ~/Downloads/kenney_survival-kit.zip --category campfire --publish && cd ..
```

```bash
cd lai && ../.venv/bin/python manage.py import_treasure_rush_environment --source ~/Downloads/light_princess_feather_lowpoly.zip --category feather --publish && cd ..
```

That imports and validates the feather but does **not** publish it (CC-BY). To publish it once
you accept CC-BY-4.0 and the credit above, run:

```bash
cd lai && ../.venv/bin/python manage.py import_treasure_rush_environment --source ~/Downloads/light_princess_feather_lowpoly.zip --category feather --publish --licence-confirmed && cd ..
```

Each import is idempotent: rerunning skips what is there and never replaces an administrator's
collision profile. Then reseed (layout v9 and the feather link; idempotent, keeps children's
progress):

```bash
cd lai && ../.venv/bin/python manage.py seed_treasure_rush && ../.venv/bin/python manage.py publish_treasure_rush && cd ..
```

Run the app as usual (`make runserver` and `make web`).

## 4. Django Admin

- **Content assets** > `campfire`, `feather`: source and provenance (author, URLs, licence,
  attribution for the feather, usage).
- **Asset versions**: v1 of each, with dimensions, triangles, modifications and textures in its
  metadata; publish, make default or retire there. The feather stays VALIDATED until published.
- **Collision profiles**: one default each; widen or shrink the campfire's radius here (the
  game picks it up for any placement of the asset; the cove's own collider is the layout's).
- **World object placements** > `cove-leap-feather`: Asset id `feather` after the reseed.

## 5. Collision view (development only)

Off by default, never in a production build, never a child-facing control. In `make web`, open a
3D location with `?collisionDebug=1` on the URL, or run
`localStorage.setItem('lai.collisionDebug', '1')` in the browser console and reload
(`localStorage.removeItem('lai.collisionDebug')` turns it off). It draws the child's footprint
(green cylinder), the controller's feet (white dot), the avatar's position (magenta dot), the
camera's aim point (yellow), nearby solid (red) and jumpable (orange) colliders, and a status line:
movement state, real speed, radius, avatar drift and camera distance.

## 6. Owner QA checklist

Movement and camera (third-person, then first-person):
- [ ] Turn to face the camera and walk backwards into a wall: the camera and avatar stop together;
      the avatar goes idle; it never walks on or off screen.
- [ ] Walk forwards, sideways and diagonally into a wall; run and sprint into a barrel and a rock:
      the avatar stays under the camera and goes idle when fully blocked.
- [ ] Walk diagonally along a wall: the avatar slides and keeps walking.
- [ ] Back into a wall in third-person: the camera rises gently over your shoulder and you can
      still see your character; with reduced motion on, it rises more slowly.
- [ ] Jump, land and jump onto a low crate and over a log: animations as before.
- [ ] Stand still on a moving platform in Pirate's Leap: the avatar does not walk.
- [ ] With your own published (Mixamo) avatar: it never slides ahead of or behind the camera.

Storykeeper Castle walls:
- [ ] Walk into walls in every room: no part of the body goes into the stone.
- [ ] Walk along walls and into corners; go through every doorway both ways; enter and leave
      every room; arrive through the Trophy Room door into the Costume Room.
- [ ] Reach Keeper Quill and every interactive object; first and third person feel the same.
- [ ] If any wall still lets the body in, note where (the collision view shows the collider).

Campfire (Treasure Cove, Pip's camp):
- [ ] The Kenney campfire stands on the ground at the camp, with a small flame flickering on it
      (still with reduced motion), and the warm light.
- [ ] You cannot walk or jump through it; the paths round it and the log seats stay reachable.
- [ ] Before importing, or with the model retired, the primitive campfire shows instead.

Feather (Pirate's Leap, Fallen Log Trail):
- [ ] The Parrot Feather looks like a feather (a red and blue primitive until the model is
      published; the golden model after), hovering and turning, never a key.
- [ ] The beach's Old brass key is still a key; the Sparkly Shell looks like a shell.
- [ ] Picking up the feather gives "Parrot Feather" once; the Backpack lists it; a feather found
      before this update stays found; the quest progresses as before.
- [ ] You can walk straight through the feather's spot.

## 7. Verification done here

Local only (no browser, WebGL, device or gamepad): Vitest for the island-map, region-play, API
and test fixtures (see the commit messages), `npm run typecheck`, `npm run content:check`,
`npm run adr:check`; pytest for assets, regions and the Pirate's Leap, Pip's Treasure and Lookout
API flows against a local PostgreSQL; `makemigrations --check`. The real ZIPs were imported into a
throwaway local database with in-memory storage to confirm validation, sizes, triangle counts and
publication rules; **nothing was uploaded to your database or storage**.
