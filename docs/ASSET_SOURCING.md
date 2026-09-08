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

| Pack | Where | Notes |
| --- | --- | --- |
| Kenney Castle Kit 2.0 | https://kenney.nl/assets/castle-kit | 75 models, complete remake of the 2017 original |
| Kenney Modular Dungeon Kit | https://kenney.nl/assets | Interiors |
| Kenney Fantasy Town Kit | https://kenney.nl/assets | Exteriors |
| Quaternius Modular Dungeon | https://quaternius.itch.io/lowpoly-modular-dungeon-pack | |
| Quaternius Fantasy Props MegaKit | https://quaternius.itch.io/fantasy-props-megakit | |

All CC0. Quaternius ships FBX, OBJ and glTF with shared texture sets.

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
