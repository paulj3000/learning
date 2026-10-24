# Asset Sourcing — What to Buy, and Why

**Researched 2026-09-08.** Prices and licences were checked on that date and
should be re-checked before purchase.

This is the concrete options-and-prices half of **ADR-020** ("Where the
castle's art comes from", `docs/DECISIONS.md`), whose "To price before
accepting" section item 3 asks whether a CC0 kit exists in a style that can
stand beside this project's generated assets. It does. This file names it.

Read `docs/regions/storykeeper_castle_reconciliation.md` first for why this
question is blocking, and `docs/regions/storykeeper_castle.md` sections 4,
40 and 41 for the art direction being bought against.

**Total to get moving: about $150, plus roughly $3 of Amazon Polly.** The
audio half can start today for nothing.

---

## 0. What has been brought in so far

**Updated 2026-09-09.** Nineteen CC0 archives are on disk under `assets/`,
totalling **532 MB**. Git ignores them: they are the *input* to the
importers, not something to ship, and their sha256s are in
`docs/ASSET_LICENCES.md` so a re-download is verifiable. **Nothing here was
paid for**, including the Quaternius `[Pro]` tier, which is still CC0.

### Models

| Archive | Models | Formats | Status |
| --- | --- | --- | --- |
| Kenney Castle Kit 2.0 | 76 | GLB, FBX, OBJ | **2 imported** — `tree-large`, `tree-small` |
| Kenney Fantasy Town Kit 2.0 | 167 | GLB, FBX, OBJ | **1 imported** — `rock-small` |
| Quaternius Ultimate Modular Men | 11 | **glTF**, FBX, Blend | **2 imported** — `Worker`, `Suit` |
| Kenney Pirate Kit | 72 | GLB, FBX, OBJ | Listed, nothing imported |
| Kenney Watercraft Pack | 46 | GLB, FBX, OBJ | Listed, nothing imported |
| Kenney Modular Dungeon Kit 1.0 | 39 | GLB, FBX, OBJ | Measured — blocked on the wall-height decision |
| KayKit Dungeon Remastered 1.0 | 203 | **GLB**, OBJ | Now local. 2 files already shipped from an earlier download |
| Quaternius Fantasy Props MegaKit `[Pro]` | 211 | glTF + `.bin`, FBX, OBJ | Listed — PBR-textured, a different style family |
| Quaternius Modular Dungeon (2019) | 48 | **FBX, OBJ, Blend — no glTF** | Listed — needs a conversion step |
| Quaternius Cute Fish | 52 | **FBX, OBJ, Blend — no glTF** | Listed — same |
| Quaternius Animated Fish | 7 | **FBX, OBJ, Blend — no glTF** | Listed — same |
| Kenney Pirate Pack | **0** | 403 PNGs | **2D sprite pack.** Not a 3D kit; earlier notes calling it "190 models" were wrong |

### Audio — 420 sounds, and no player for them

| Archive | Sounds |
| --- | --- |
| Kenney Impact Sounds | 130 `.ogg` |
| Kenney Interface Sounds | 100 `.ogg` |
| Kenney Music Jingles | 86 `.ogg` |
| Kenney RPG Audio | 52 `.ogg` |
| Kenney UI Audio | 52 `.ogg` |

Section 1's point stands and has not been acted on: this project still has
**no audio code at all**. These files cannot be "imported" the way a model
can - they need a sound manifest, a loader, `AudioListener` /
`PositionalAudio` wiring, and a parent-facing mute and volume control before
one of them plays. That is a subsystem, and it is the largest single item
still outstanding on this page.

### Two broken downloads

| Archive | Problem |
| --- | --- |
| `Ultimate Monsters` | Truncated, fails `unzip -t`. Worth re-downloading: it is the only near-miss for Ember |
| `Fantasy Props MegaKit[Source]` | Truncated, and redundant. `[Pro]` already holds all 211 models; Source adds only Unity/Unreal/Godot projects. Delete it |

**Still not downloaded:** Quaternius Ultimate Nature
(https://quaternius.com/packs/ultimatenature.html), which section 5 of
`MODELS_NEEDED.md` names for the Dragon's Sanctuary.

### What actually ships

Seven files, about 2.1 MB, checked in under `public/models/`:

| File | Serves | Note |
| --- | --- | --- |
| `kaykit-floor-tile-large.glb` | `ground-tile-stone` | No normalisation needed |
| `kaykit-floor-wood-large-dark.glb` | `ceiling-tile` | No normalisation needed |
| `kenney-rock-small.glb` | `rock` | Scaled 0.302 |
| `kenney-tree-large.glb` | `foliage-tree` | Scaled 1.406 |
| `kenney-tree-small.glb` | `foliage-tree-lod1` | Scaled 1.927 |
| `npc-harbor-master.gltf` | `npc-harbor-master` | 24 clips stripped to 3, 2.9 MB to 824 KB |
| `npc-professor-ticktock.gltf` | `npc-professor-ticktock` | Stand-in for a bespoke character |

The five scenery files take over ids the shared kit already places, so no
scene file changed for them. The two characters are new ids: before them,
Clockwork Harbor's Harbor Master and Professor Ticktock were both
`npc-pip`, and so were the same pirate as each other.

### Three corrections measurement forced

1. **Kenney's kits are on a 1-unit module, not a metre one.** A castle wall
   out of the box is 1.31m tall, below a child's 1.6m eye height. "Drop it
   in and it works" was never true for these packs.
2. **Quaternius's characters are the opposite** - already ~1.86m,
   ground-pivoted, and **untextured**, which makes them a closer style
   match to the generated kit than any textured pack. What they need is
   subtraction: 24 clips each, most of them combat, in a product for 3- to
   8-year-olds.
3. **The `carpet` hope is dead.** None of the three Kenney kits contains a
   rug. The MegaKit is the next place to look.

---

## 1. Buy audio first, not art

This project currently has **no audio of any kind**: no music, no footsteps,
no page turn, no chime when the book slides onto the shelf, no voice. A
grep for `AudioListener`, `PositionalAudio`, `.mp3`, `speechSynthesis` and
Polly across `src/`, `amplify/` and `scripts/` returns nothing.

Silence is doing more damage to "showable to a child" than the untextured
geometry is, and it is the cheapest thing on this list to fix.

| What | Where | Licence | Cost |
| --- | --- | --- | --- |
| Music Jingles (85 assets) | https://kenney.nl/assets/music-jingles | CC0 | free |
| UI Audio (50 assets) | https://kenney.nl/assets/ui-audio | CC0 | free |
| RPG Audio, Impact Sounds, Interface Sounds | https://kenney.nl/assets | CC0 | free |

CC0 means no attribution surface is owed, which matters on a children's
product where an attribution screen has to be somewhere a parent can
actually reach.

### Amazon Polly — the cost is not a real constraint

The upgrade roadmap's sections 17 to 22 assume Polly with S3 MP3 caching.
That is the right shape, and the reason is arithmetic:

**The island's entire authored prose is about 103,000 characters** across 39
content files (`src/features/npc/content`, `adventures/content`, `story`,
`quests/content`, `discovery/content`, `rewards/content`; measured by
summing quoted string literals of 25+ characters, so it is a generous
over-estimate that includes some non-spoken text).

Because those lines are authored and deterministic, each is synthesised
**once, ever**, and served from S3 thereafter. One-time cost to voice the
entire island:

| Polly engine | Rate | One-time cost for 103k chars |
| --- | --- | --- |
| Standard | $4 / 1M | **$0.41** |
| Neural | $16 / 1M | **$1.65** |
| **Generative** | $30 / 1M | **$3.08** |
| Long-form | $100 / 1M | $10.28 |

Free tier (first 12 months): 5M standard, 1M neural, 100k generative
characters per month. **The whole island fits inside the free tier.**

Use the **generative** engine. It is built for narrative smoothness,
inquisitive questions and character dialogue, which is exactly Keeper Quill
and Chatty.

Only *AI-generated* dialogue accrues per-child cost, and that is already
bounded by the maximum-output-length rule in `CLAUDE.md` section 7.

> **What is not settled by cost.** `docs/IMPLEMENTATION_STATUS.md`'s
> "Decisions pending" lists "text-to-speech provider and voice consent
> model" as open. Polly answers the provider half only. The consent half is
> a question for `docs/PRIVACY_AND_SAFETY_REVIEW.md` and has not been asked.
> Do not treat $3 as the whole decision.

---

## 2. The 3D recommendation — The Complete KayKit, $150

**https://kaylousberg.itch.io/kaykit-complete** (Kay Lousberg)

$150 for 20+ packs, individually $242, and it includes all future releases
at no extra cost.

Why this one for **this** project specifically:

- **CC0.** This deletes one of ADR-020's four named import costs outright:
  no attribution surface a parent must reach, no licence ledger, no
  redistribution question about shipping models inside an app bundle.
- **Ships glTF natively.** The Dungeon Pack provides `.gltf` alongside FBX
  and OBJ. `assets/manifest.ts` resolves every asset by id and
  `assets/assetLoader.ts` already loads real glTF over fetch, so this drops
  into the pipeline that exists.
- **The style is the one already chosen.** Chunky, warm, exaggerated
  silhouettes, storybook. It matches the restyle shipped in `d468e4c`
  ("warm, chunky, storybook-game look") and the upgrade roadmap's section 4
  "Roblox / Prodigy / animated-adventure feeling".

Relevant packs inside the bundle: Dungeon Pack (modular castle interiors,
stairs, ceilings, tavern pieces, bar, furniture, beds), Furniture Bits, RPG
Tools Bits, Forest Nature Pack, Character Pack Adventurers, Character
Animations, Fantasy Weapon Bits, Medieval Hexagon Pack.

Individual pack if not buying the bundle:
https://kaylousberg.itch.io/kaykit-dungeon-pack

### Free CC0 supplements

**Downloaded and measured 2026-09-09.** Every Kenney pack on this page is a
free download from kenney.nl; the "Get All-in-1 bundle" button beside each
Download is an optional convenience purchase of the same CC0 files, not a
requirement. The archives are kept under `assets/*.zip`, which git ignores -
their sha256s are in `docs/ASSET_LICENCES.md` so a re-download is
verifiable.

| Pack | Where | Formats | What it actually contains |
| --- | --- | --- | --- |
| Kenney Castle Kit 2.0 | https://kenney.nl/assets/castle-kit | GLB, FBX, OBJ | 76 models. Exterior: towers, walls, gates, bridges, flags, siege engines, trees, rocks. **1-unit module** - its wall is 1.00 x 1.31 x 1.00 |
| Kenney Modular Dungeon Kit 1.0 | https://kenney.nl/assets | GLB, FBX, OBJ | 39 models, architecture only. **4m grid, 4.15m walls** - see `MODELS_NEEDED.md` §3 |
| Kenney Fantasy Town Kit 2.0 | https://kenney.nl/assets | GLB, FBX, OBJ | 167 models. Buildings, roofs, walls, market stalls, fountains, roads, carts, trees, rocks. 1-unit module |
| Quaternius Modular Dungeon | https://quaternius.itch.io/lowpoly-modular-dungeon-pack | **FBX, OBJ, Blend - no glTF** | 48 models, good furniture (tables, chairs, chests, pedestals, columns). Needs a conversion step |
| Quaternius Fantasy Props MegaKit `[Pro]` | https://quaternius.itch.io/fantasy-props-megakit | **glTF** (+ external `.bin`), FBX, OBJ | 211 models, **PBR textures** (BaseColor/Normal/ORM). The Pro tier is still CC0 |

All CC0, including the Quaternius Pro tier (`License_Pro.txt`).

**Two things measurement changed about this section.** Kenney's kits are
authored on a **1-unit module**, not a metre one, so a castle wall out of
the box is 1.31m tall - below a child's 1.6m eye height. Anything from
these packs needs uniform downscaling, which
`scripts/import-kenney-assets.ts` now does. And every Kenney `.glb`
references a shared `Textures/colormap.png` by relative uri, with a
**different atlas per pack**, so each import has to embed its own or 404.

**The `carpet` hope in `MODELS_NEEDED.md` is dead.** None of the three
Kenney kits contains a rug. The MegaKit is the next place to look.

---

## 3. The paid alternative — Synty POLYGON

Roughly $40 to $100 per pack. Highest fidelity of the options here and the
closest to Prodigy's actual look. https://syntystore.com/collections/polygon

**The web-extraction question is answered, and the answer is favourable.**
Three.js serves models the browser can trivially download, which is a real
licensing concern. Synty's one-time purchase licence
(https://syntystore.com/pages/one-time-purchase-licence) is worldwide and
not limited by engine, OS, platform or device, so WebGL is covered; and
Synty have told a developer asking about exactly this case - a three.js
browser game where players could extract textures via devtools - that it is
fine, provided assets are not simply reposted as a standalone public
repository. Editing assets is allowed; reselling edited assets is not.

**Still not where to start.** It is per-pack money rather than one payment,
the obligations are heavier than CC0, and it buys fidelity before the
design is known to work. Revisit after one room proves out.

---

## 4. The real gap — characters

Environments are effectively solved at this budget. Characters are not, and
the problem here is specific: **Keeper Quill, Chatty the Parrot and Ember
the dragon are bespoke.** No pack contains them.

- KayKit's **Character Pack Adventurers** plus **Character Animations**
  gives humanoid NPCs on a shared rig, which covers the Storykeeper, the
  Inventor, Professor Orion and a knight.
- **KayKit Skeletons is the wrong half of the bundle for this audience.**
  The upgrade roadmap's section 6.8 says to keep the Forgotten Dungeon
  "playful rather than scary" and the product is for ages 3 to 8. Use those
  models as props, not as inhabitants.
- A talking parrot and a small dragon are the one place bespoke money is
  genuinely well spent, because they are the product's identity rather than
  its scenery. Either commission the two, or restyle them from a pack's
  creature models and accept the compromise deliberately.

Any character source must satisfy the existing animation contract:
`assets/animationVocabulary.ts` is a closed clip vocabulary (`Idle`, `Talk`,
`Wave`, `Point`, `Celebrate`, `ReactConcerned` and others), and both castle
and forest roadmaps hold the constraint that it is not extended. An imported
character needs its clips renamed to that vocabulary, not the vocabulary
widened to the import.

---

## 5. Do not buy

- **Textures.** Poly Haven is excellent and irrelevant to this problem.
  Untextured *stylised* models are a legitimate art direction; untextured
  *primitives* are not. The problem is geometry and silhouette, not surface.
- **100+ models.** The upgrade roadmap's section 40 says this itself.
- **Characters and environments from different style families.** Section 4
  warns about mixing fidelities, and it is the most common way a
  bought-asset scene ends up reading worse than a consistent grey-box one.
- **Anything CC-BY** while a CC0 equivalent exists, for the attribution
  reason above.

---

## 6. Sequencing — buy before authoring, not after

ADR-020 measured that 44 of the castle's 60 assets are gameplay-bearing and
only 16 are importable scenery, which makes a kit purchase look close to
useless.

**That ratio is a property of the old design, not a law.** Those 44 are
gameplay-bearing because the SC storyboard's thesis was to make the geometry
*be* the puzzle: nine countable stars, three rods graded by length, a
carving worn smooth. The upgrade roadmap's gameplay is a different shape
entirely - portal books, artifacts on pedestals, ambient events, quests
wrapping curriculum - and almost none of it is geometry-bound.

**Design the new rooms around what is in the box and the ratio inverts:**
most of what gets placed is bought, and only a handful of genuinely
puzzle-bearing pieces stay generated. That only works if the kit is chosen
*before* the rooms are authored, which is exactly the decision point the
project is at now.

The import work each bought asset still needs is unchanged from ADR-020:
scale normalisation to 1 unit = 1 metre, re-pivoting to ground-pivot (most
packs are centre-pivoted), and a visual check against the room it sits in.
Collision is already decoupled from the visual mesh
(`docs/THREE_WORLD_ASSET_CONVENTIONS.md`, "Collider proxy"), so a swapped
mesh cannot silently change where a child can walk.

---

## 7. Suggested order

1. **Tonight, free:** download the Kenney audio packs. Nothing about them
   requires a decision.
2. **This week, $150:** The Complete KayKit, if ADR-020 is accepted.
3. **Then:** wire Polly for the authored lines only, generative engine, S3
   cache, subtitles. Confirm the consent question first.
4. **Then:** re-skin one room - the Great Library is the densest and the
   best test - and prove the manifest swap is a one-line change with no
   game-logic edit. That is the upgrade roadmap's own Phase 1 exit
   criterion.
5. **Then re-cost** the rest of the upgrade roadmap against a room that
   actually looks like a castle.

---

## Sources

- The Complete KayKit — https://kaylousberg.itch.io/kaykit-complete
- KayKit Dungeon Pack — https://kaylousberg.itch.io/kaykit-dungeon-pack
- Kenney Castle Kit — https://kenney.nl/assets/castle-kit
- Kenney Music Jingles — https://kenney.nl/assets/music-jingles
- Kenney UI Audio — https://kenney.nl/assets/ui-audio
- Quaternius Modular Dungeon — https://quaternius.itch.io/lowpoly-modular-dungeon-pack
- Quaternius Fantasy Props MegaKit — https://quaternius.itch.io/fantasy-props-megakit
- Synty one-time purchase licence — https://syntystore.com/pages/one-time-purchase-licence
- Amazon Polly pricing — https://aws.amazon.com/polly/pricing/
- Amazon Polly generative voices — https://docs.aws.amazon.com/polly/latest/dg/generative-voices.html
