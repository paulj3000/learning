# Storykeeper Castle — Gameplay and Compatibility Contracts (SC-R01-04)

These are the contracts every reboot phase (SC-R02 to SC-R12) works inside.
Contracts marked **[test]** are enforced by
`react/src/features/island-map/three/castleRebootContracts.test.ts` or by an
existing test it names. A change that needs to break one is a decision, made
in its own ADR or roadmap amendment, not a refactor.

## C-1. 3D world interactions [test]

- The castle's twelve interactions (`worldObjects.ts`,
  `STORYKEEPER_CASTLE_INTERACTIONS`) keep their ids, action kinds and world-
  change gates exactly. The manifest uses the same array, not a copy.
- Visual work may restyle what an interaction *looks like*. It never renames
  an interaction, changes its action, or changes what gates it.
- The tapestry secret stays in `hiddenInteractionIds`.
- New interactions (SC-R04 onward) are additive. Each needs a HUD path
  (C-3) and, if hidden, a reason recorded in the roadmap.

## C-2. Extension claims [test]

`castle-tale` claims an interaction only when it will host something for the
child's band (`castleTaleClaims.ts`). A claim always leads to a visible
session or is not made. This fixed audit finding AUD-1: before SC-R01-04, an
Explorer opening the story hall, or a Sprout or Pathfinder opening the secret
door, got a claim that started nothing and never closed. Those interactions
now fall through to the generic panel.

## C-3. Authored adventure steps and HUD equivalence [test]

- Every 3D binding names a step and an option (or ordering item) the authored
  content already declares. Bindings never invent ids
  (`castleRebootContracts.test.ts` C-4, `castleChoiceBindings.test.ts`).
- Every step the castle stages as a world object is answerable from the HUD
  card in the same words (`castleHudEquivalence.test.tsx`). No learning
  objective is reachable only by walking, looking or aiming.
- Option labels, step ids, prompts and hint ladders are unchanged by the
  reboot. The premise is carried by new framing copy only.

## C-4. Progress persistence

- **ADR-027 single write.** A story chapter played in 3D, on a card, or after
  a resume writes one story-progress record. The adventure and story engines
  own every write. `castle-tale` and the 3D scene write nothing themselves:
  they drive `useAdventureSession` and `useStoryProgress`, which own the
  calls.
- **Visual work writes nothing.** SC-R02 adds no persistence, no world change,
  no reward and no progress record.
- **Persistence target.** Today: Amplify (`ChildStoryProgress`, world
  changes, discoveries, `ChildNpcState`, `ChildInventory`). After the
  platform cutover (LAI-0309, LAI-0603, LAI-0709): Django `progression`,
  `inventory` and `quests` models. The castle adds no Django model of its
  own (ADR-033).
- **Resume.** A session left open resumes in place, its choices read back
  from recorded answers. No reboot phase adds a second resume store.

## C-5. Storybook quest progression [test, for the sources]

- Pages are **derived** from existing records by a pure function
  (implemented in SC-R04-01). They are never stored.
- Each planned page names a world change or discovery that its bands'
  content already writes. The contract test proved this and corrected the
  roadmap: no Explorer mission writes `FIRST_STORY_TOLD`, so the first-story
  page belongs to Sprouts and Pathfinders.
- World changes are keyed by `locationSlug/changeKey`. The secret-door arc
  writes under `castle-secret-passage`, not `storykeeper-castle`, and the
  page function must read both.
- Every band can restore at least one page.
- The island quest `restore-the-great-storybook` (SC-R04-02) uses objective
  kinds the quest engine already credits (BUILD on world-change keys, SOLVE,
  TALK_TO, DISCOVER), on the pattern of `tell-a-story-together`.

## C-6. Artifacts and ranks

- Artifacts are catalog items granted by reward rules
  (`reward-storykeepers-tale` → `storykeepers-quill` is the model) and owned
  through inventory. The castle displays them and never grants them.
- Rank titles are computed from the share of the band's page set restored.
  They are never stored, never compared, never lost, and never time-based.

## C-7. NPC interactions

- Keeper Quill stays `keeper-quill` in the NPC framework
  (`features/npc/content/islandNpcs.ts`), with interaction
  `talk-to-keeper-quill`.
- A model upgrade keeps the asset id `npc-quill` and the clip names `Idle`,
  `Talk`, `Wave`, `Point`, `Celebrate` and `ReactConcerned`, because
  `castle-tale` drives them by name.
- New NPCs (Ember, SC-R05) reuse existing NPC ids where they exist
  (`ember-dragon`).
- AI dialogue (SC-R09) goes only through the ADR-044 route, with bounded
  context and authored fallbacks. It never sets memory flags the authored
  dialogue cannot set (`reachableMemoryFlags`).

## C-8. Asset resolution

- Every asset is addressed by logical id through the registry
  (`assets/manifest.ts`) and resolver. There are no URLs in scene or
  manifest code (`noHardCodedAssetUrls.test.ts`).
- Gameplay-bearing assets keep their ids and stay generated (ADR-028). Both
  halves of a state-variant pair come from one producer.
- A missing asset never stops play: placeholders as today. Procedural
  surfaces fall back to flat colour.
- Swapping an asset's source (generated, KayKit, commissioned, Django Asset
  Library) is a registry change with no game-logic edit.

## C-9. Sound cues (contract only; no audio until SC-R06)

- Castle sound is requested by **named cue** (for example
  `castle.portrait.lit`), never by URL, through the shared Sound Manager once
  it is merged. There is no castle-specific audio engine.
- Cues are fire-and-forget and gameplay never waits on audio.
- Mute and volume belong to the shared settings.
- Narration requires the provider decision and parent voice consent
  (SC-R06-03).

## C-10. Age bands [test]

- Each band has exactly one castle mission: Sprouts get Quill's Picture
  Story, Pathfinders the Storykeeper's Tale, Explorers the Castle's Secret
  Door.
- New premise copy, pages and rooms never put a Sprout in front of an
  Explorer puzzle or show a locked slot meant for another band.
- Sprouts get no reticle in the castle, and the card route stays their
  primary route until SC-R11's playtest.

## C-11. Accessibility alternatives

- The "Things to do here" list and the HUD card stay complete alternatives to
  walking.
- Motion added by the reboot respects reduced motion (SC-R02-05). State still
  changes instantly, so the outcome is always visible.
- Quality tiers change appearance only: colliders, interactions, bindings and
  copy are identical at every tier.
