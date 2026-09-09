# Models Needed

**Compiled 2026-09-09.** Prices and licences were checked on that date and
should be re-checked before any purchase.

What this is: the per-region inventory of 3D models the island still needs,
where each might come from, and what it would cost. It is the "what" to
`docs/ASSET_SOURCING.md`'s "which kit and why", and it inherits its rules
from **ADR-020** (`docs/DECISIONS.md`). `docs/ASSET_LICENCES.md` is the
ledger of what has actually been imported so far.

---

## 1. Where things stand

`public/models/` holds **110 files**: 108 generated from primitives by
`scripts/generate-world-assets.ts`, and 2 imported (KayKit, CC0). Every one
resolves from `src/features/island-map/three/assets/manifest.ts`.

| Region | Models | Scene built | Still needed |
| --- | --- | --- | --- |
| Welcome Harbor | Shared kit (19) | Yes | Nothing |
| Pirate Builder Bay | Shared kit | Yes | Nothing |
| Storykeeper Castle | 60 (2 now imported) | Yes | 14 optional re-skins |
| Wonderwild Forest (surface) | 29 | Yes | Nothing |
| Wonderwild Hive | Authored, unplaced | **No** | **Nothing — needs a scene, not models** |
| The Writing Room | Authored, unplaced | **No** | **Nothing — needs a scene, not models** |
| Clockwork Harbor | Borrowed only | Yes | **~32** |
| The Dragon's Sanctuary | Borrowed only | Yes | **~13 + a rigged dragon** |
| Fossil Ridge Camp | None | No | **~6** |
| Bolt's Workshop | None | No | **~8** |
| The Care Beach | None | No | **~12** |
| The Lantern Tide Pools | None | No | **~8** |

Two rows are worth reading twice. The **Hive** and the **Writing Room** need
**no new models at all** — `npc-buzz`, `comb-cell`, `comb-cell-capped`,
`ground-tile-comb`, `glowworm-ceiling`, `flower-cluster`, `writing-desk`,
`round-window`, `costume-rack` and both sconces are already generated and
checked in, and nothing places them. That is scene-authoring work, and it is
the cheapest visible progress on this whole page.

---

## 2. The rule that shapes every row below

ADR-020 measured that of the castle's 60 assets, **44 are gameplay-bearing
and 16 are importable scenery.** Gameplay-bearing means the geometry *is* the
rule: three rods graded by length, nine countable stars, 22 state-variant
pairs that must share exact vertices. **Those are not purchasable at any
price**, and no row below proposes buying one.

Expect the same ratio wherever a region's puzzles are geometry-bound, and
expect it to invert wherever rooms are designed around what a kit already
contains. That choice is made when the room is authored, not when the kit is
bought.

---

## 3. Storykeeper Castle — 14 optional re-skins

`ground-tile-stone` and `ceiling-tile` are done. The rest of the importable
16:

Checked against the pack's actual 203-file listing, not guessed:

| Needed | KayKit Dungeon match | Verdict | Cost |
| --- | --- | --- | --- |
| `wall-stone` | `wall` (4×4×1m, single mesh, ground-pivoted) | Grid mismatch — see below | Free (CC0) |
| `archway` | `wall_arched` (4×4×1m, single mesh) | Arch *cut into a wall panel*, not a free-standing frame — replaces the wall+gap+archway arrangement rather than slotting in | Free (CC0) |
| `reading-table`, `binding-table` | `table_medium`, `table_long` (+ broken, decorated, tablecloth variants) | Good match | Free (CC0) |
| `writing-desk` | `table_small`, `table_small_decorated_A/B` | Good match | Free (CC0) |
| `tapestry` | `banner_*` — **42 of them**, 7 shapes × 6 colours | Good match, embarrassment of riches | Free (CC0) |
| `portrait-frame` | `banner_shield_*` | Plausible, not a portrait frame | Free (CC0) |
| `window-frame`, `round-window` | `wall_window_open`, `wall_window_closed`, `wall_archedwindow_open`, `wall_archedwindow_gated` | Windows *in wall panels*, same mismatch as `wall_arched`. No free-standing frame, no round window | Free (CC0) |
| `carpet` | **None.** No rug or carpet anywhere in the pack | Look elsewhere (Kenney Castle Kit, KayKit Furniture Bits) | — |
| `cushion` | **None** in Dungeon | KayKit Furniture Bits | $150 bundle |
| `lectern`, `rod-rack`, `costume-rack` | **None** | Keep generated | — |

**One bonus find outside the importable 16.** `wall-sconce` / `wall-sconce-lit`
is a state-variant pair, so ADR-020 normally keeps it generated — but KayKit
ships **`torch` / `torch_lit` / `torch_mounted`**, both halves from the same
producer, which is exactly what that rule asks for. Measured: `torch` is
1.042m tall, `torch_lit` 1.126m, so they are *not* identical vertices — the
flame is real added geometry. The construction-time swap would pop by 8cm,
which for lighting a torch is arguably correct rather than a defect. Worth a
look when the walls are settled. `candle`/`candle_lit` and
`floor_tile_grate`/`_open` are the same shape of pair if ever useful.

**Not importable despite an apparent match:** `bookshelf` pairs with
`bookshelf-ajar` and is gameplay-bearing. KayKit has `shelf_large`,
`shelf_small`, `shelves` and `wall_shelves` (a 4×4 wall with shelves built
in), but **no ajar variant**, so both halves cannot come from one producer.
Stays generated.

**Blocked on a decision, not on money.** KayKit's dungeon module is a **4m
grid with 4m-tall walls**; ours is a 4m floor grid with **2m-wide, 3m-tall**
panels (`WALL_HEIGHT = 3`). Floors matched exactly, which is why they went
first. Walls need either non-uniform scaling (visibly stretches the
stonework) or raising `WALL_HEIGHT` to 4 — which flows into every `toBox3`
collider ceiling and every room's proportions against `EYE_HEIGHT = 1.6`.

Measured from the actual files: `wall` and `wall_arched` are both
4 × 4 × 1m, single-mesh, ground-pivoted, identity root transform.

---

## 4. Clockwork Harbor — ~32 models

Source list: `docs/regions/clockwork.md` §27. Today the region borrows
`ground-tile`, `wall-stone`, `roof`, `door`, `rock` and `npc-pip`; every
harbor-specific object is inline `BoxGeometry`/`TorusGeometry`.

| Needed | Where | Cost |
| --- | --- | --- |
| Harbor buildings, market stalls, workshop | [Kenney Fantasy Town Kit](https://kenney.nl/assets), KayKit Medieval Hexagon | Free (CC0) / in $150 bundle |
| Dock, boats | [Kenney Pirate Kit](https://kenney.nl/assets/pirate-kit) (70), [Pirate Pack](https://kenney.nl/assets/pirate-pack) (190), [Watercraft Kit](https://kenney.nl/assets/watercraft-kit) (45) | Free (CC0) |
| Lighthouse, clock tower, drawbridge | No CC0 match found | Bespoke or Synty |
| Underground tunnels | KayKit Dungeon | Free (CC0) |
| Gears, levers, valves, pipes, cranks, chains, pulleys, gauges | KayKit Platformer Pack (gears only); rest unmatched | $150 bundle + bespoke |
| Generators, power crystals, ancient machinery | No CC0 match found | Bespoke |
| Harbor Master, sailors, merchants, fishermen, dock workers | KayKit Character Pack Adventurers + Character Animations; [Quaternius Ultimate Modular Men](https://quaternius.com/packs/ultimatemodularcharacters.html) (11 chars, 24 anims, glTF) | $150 bundle / Free (CC0) |
| Professor Ticktock | Bespoke — a named character | See §7 |
| Cog, Clockwork Fox, Brass Turtle, Gearwing Owl, Springtail Rabbit, Copper Crab | **Nothing exists.** Six bespoke clockwork creatures | See §7 |

**The honest read:** the town is buyable, the machinery mostly is not, and
the seven named characters are not at all. This region is where the
"buy scenery, commission identity" split bites hardest.

---

## 5. The Dragon's Sanctuary — ~13 models + a rigged dragon

Source list: `docs/regions/dragons-sanctuary-roadmap.md`, "Initial Asset
List". Today the region borrows the generic kit and **`npc-pip` stands in
for Ember**.

| Needed | Where | Cost |
| --- | --- | --- |
| Cliffs, rocks, vegetation | [Quaternius Ultimate Nature](https://quaternius.com/packs/ultimatenature.html), KayKit Forest Nature | Free (CC0) / in bundle |
| Ruined temple pieces, sanctuary gate, bridges | KayKit Dungeon (`wall_broken`, `wall_cracked`, `rubble_*`, `stairs_*`) | Free (CC0) |
| Forge, lodge, dragon roost/nest | No direct match; assemble from dungeon + nature | Free (CC0) + authoring |
| Cave entrance, crystals, rune stones | KayKit Dungeon + Quaternius | Free (CC0) |
| **Ember — rigged dragon, 13 animation clips** | **Nothing in any CC0 pack.** [Quaternius Ultimate Monsters](https://quaternius.com/packs/ultimatemonsters.html) (50 monsters, glTF, CC0) is the only near-miss worth checking | See §7 |
| Future dragon base rigs | Same rig, reused | — |

**Ember is the single most expensive item on this page.** Thirteen clips
(idle, breathing, look-at, walk, turn, sit, sleep, roar, happy, thinking,
takeoff, landing, flight) and a reusable rig so later dragons are not
independent animation systems.

---

## 6. The regions with nothing yet

| Region | Needed | Where | Cost |
| --- | --- | --- | --- |
| **Fossil Ridge Camp** | Assembled sauropod skeleton, dig pit, tents, tools, crates, bone fragments | Skeleton: no CC0 match found (marketplaces are CC-BY or paid). Camp props: KayKit RPG Tools / Resource Bits | Skeleton bespoke; props free or in bundle |
| **Bolt's Workshop** | Bolt the robot (rigged), workbench, tools, spare parts, shelving | Robot: no CC0 match found. Workshop: KayKit Dungeon + Furniture Bits | Robot bespoke; rest free / in bundle |
| **The Care Beach** | Care pens, sand/beach kit, feeding props, rescued sea creatures (rigged) | Beach: Kenney Pirate Kit. Creatures: [Quaternius LowPoly Animated Fish](https://quaternius.itch.io/lowpoly-animated-fish) — CC0, rigged, **but FBX/OBJ/Blend only, no glTF** | Free (CC0) + a conversion step |
| **The Lantern Tide Pools** | Rock pools, lanterns, water surface, small pool creatures | Kenney Pirate Kit, KayKit Dungeon (`torch_*`, `candle_*`) | Free (CC0) |
| **Chatty the Parrot (3D)** | One perched parrot, `Idle` only | [Poly Pizza](https://poly.pizza/search/parrot) has Parrot ×2, Scarlet Macaw, Macaw — **CC-BY 3.0, static, not rigged** | Free, but owes an attribution surface |

**Chatty is the one row that may not be worth doing.** Her canonical face is
`ChattyAvatar.tsx`, a 344-line hand-drawn Canvas 2D avatar. The 3D model is
used in exactly one place — perched on a stone in
`wonderwildForestScene.ts`. Buying a nicer macaw buys one prettier
silhouette in one clearing, and a generic macaw beside a hand-drawn 2D
Chatty will read as two different characters.

---

## 7. What no kit contains

These four are the product's identity rather than its scenery, and no pack
on this page has them:

| Needed | Why it is bespoke | Cost |
| --- | --- | --- |
| **Ember the dragon**, rigged, 13 clips | No CC0 dragon exists in a matching style | **No verified quote** |
| **Chatty the Parrot** | No CC0 parrot that is rigged and on-style | **No verified quote** |
| **Professor Ticktock + 6 clockwork creatures** | Named characters, invented for this world | **No verified quote** |
| **Bolt the robot** | Named character | **No verified quote** |

**I have not priced commissioning.** Any figure here would be invented, and
a wrong number in a budget doc is worse than a blank. Get two or three
quotes against a written brief (style reference, clip list from
`animationVocabulary.ts`, glTF delivery, ground-pivot, 1 unit = 1m) before
planning around a number.

The cheaper alternative worth considering: **restyle a pack's creature
models** rather than commissioning from nothing, and accept the compromise
deliberately. Quaternius Ultimate Monsters (50 rigged monsters, CC0, glTF)
is the pack most likely to contain a usable starting point for Ember.

---

## 8. Source reference

| Source | Licence | Formats | Cost | Verified |
| --- | --- | --- | --- | --- |
| [KayKit Dungeon Remastered](https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0) | CC0 | **glTF** (203 files), FBX, OBJ | **Free** | Downloaded and measured |
| [The Complete KayKit](https://kaylousberg.itch.io/kaykit-complete) | CC0 | glTF, FBX, OBJ | **$150**, 22 packs, includes future releases | Page read |
| [Kenney](https://kenney.nl/assets) — Pirate Kit (70), Pirate Pack (190), Watercraft Kit (45), Castle Kit 2.0 (75), Fantasy Town Kit | CC0 | **Formats not stated on the pages** — confirm before planning | **Free** | Page read; formats unconfirmed |
| [Quaternius](https://quaternius.com/) | CC0 | Varies by pack — **Ultimate packs include glTF, several older packs are FBX/OBJ/Blend only** | **Free** | Page read per pack |
| [Poly Pizza](https://poly.pizza/) (Google Poly archive) | **CC-BY 3.0** | glTF, FBX, OBJ | Free + attribution surface | Licence verified |
| [Synty POLYGON](https://syntystore.com/collections/polygon) | One-time purchase licence | FBX (conversion needed) | **~$40–100 per pack** | Per `ASSET_SOURCING.md`, 2026-09-08 |
| Commission | Work-for-hire | As specified | **No verified quote** | Not priced |

### Two licence rules that are not negotiable

1. **Prefer CC0.** ADR-020: *"No CC-BY asset without an attribution surface a
   parent can reach."* No such surface exists in the app today. Any CC-BY
   asset must ship that surface as part of the same change — that is a UI
   change, not a docs one.
2. **No state-variant pair split across sources.** Both halves come from the
   same producer, or the construction-time swap visibly pops.

---

## 9. The realistic total

| Bucket | Cost |
| --- | --- |
| Everything CC0 above (KayKit Dungeon, Kenney, Quaternius) | **$0** |
| The Complete KayKit, if the extra packs earn it | **$150** |
| Audio, which this project has none of | **$0** (Kenney CC0 packs) |
| Amazon Polly, whole island voiced once | **~$3**, inside the free tier |
| Ember, Chatty, Ticktock, Bolt, 6 creatures | **Unpriced — get quotes** |

**Environments are effectively solved at $0–150. Characters are not, and
that is the whole budget question.** Everything else on this page is
authoring time.

---

## 10. Suggested order

1. **Place the models that already exist.** The Hive and the Writing Room
   need scenes, not purchases. Cheapest visible progress available.
2. **Look at the castle floor.** Two imported slabs are in; nobody has seen
   the room. Whether bought art beside 58 generated primitives reads better
   or worse is the mixed-fidelity question ADR-020 raises, and it decides
   everything below.
3. **Settle `WALL_HEIGHT`.** It gates the castle's remaining 14 and every
   KayKit interior in Clockwork Harbor and the Sanctuary.
4. **Download the free CC0 kits** and re-skin one more room end to end.
5. **Then, and only then, decide the $150 and the commissions**, against a
   room that actually looks like a castle.

Do not buy 100+ models, textures, or characters and environments from
different style families — see `docs/ASSET_SOURCING.md` §5.
