# Heart of Firepeak NPCs (NPC Manager)

Five characters, authored by `python manage.py seed_npc_firepeak` (create-only, never
overwrites, not published unless `--publish`). Content lives in
`lai/apps/npcs/firepeak_content.py`; tests in `lai/apps/npcs/tests/test_firepeak_npcs_seed.py`.
Identity is the catalog `NpcDefinition` (ADR-054 item 1): the content export creates it, this
command never does. Catalog dialogue stays the reliable baseline; the NPC Manager rows add
persona, behaviour, model variant, placement and authored fallback dialogue.

## Run order

1. `load_content` with the Heart of Firepeak export (catalog NPCs `flint`, `kindle`,
   `professor-basalt`, `cinder`, `ignis`). Without them the command fails and tells you to run it.
2. The area seed for `firepeak-heart` (the 3D Area). Without it the placements are skipped with a
   note; run `seed_npc_firepeak` again after the area exists (second run creates only the placements).
3. `seed_npc_firepeak`. Creates, per NPC: a stand-in model asset (`firepeak-<npc>, the same ids as the 3D Area placements`, origin Django,
   tag `firepeak-heart`, no file), a Polly voice profile (reused if present), the character, the
   `classic` variant, behaviour profile(s), placements, an approved persona and the dialogues.
4. Upload the GLBs (below), then `seed_npc_firepeak --promote`, then `--publish`.

A character is created READY only when its model is already live (a published version or a
bundled file). Otherwise it is DRAFT, so a missing model can never block an unrelated release
(releases are global and also carry Pirate Pip and Keeper Quill). `--promote` changes only
`status`, DRAFT to READY, and only when the model is live.

## Inventory

All: age bands PATHFINDER and EXPLORER, variant `classic`, Polly neural voices (en-US).

| NPC | Role | Mode | Zone | Placements (x, z) | Behaviour | Model asset | Voice |
|---|---|---|---|---|---|---|---|
| Flint (`flint`) | GUIDE; welcome, map, movement | AUTHORED | 1 Explorer's Landing | `fh-flint` (-4, 86) | stationary, faces child | `firepeak-flint` | Matthew 100% |
| Kindle (`kindle`) | COMPANION; hints | HYBRID | 2 Emberwood, 7 Heart | `fh-kindle` (3, 58), `fh-kindle-heart` (4, -86) | follow (stop 2.5 m, bounded 14 m); stationary at the Heart | `firepeak-kindle` | Ivy 108% |
| Professor Basalt (`professor-basalt`) | TEACHER; real volcano science | AUTHORED | 4 Caverns, 6 Summit | `fh-basalt` (-6, 1.5), `fh-basalt-summit` (-6, -64.6) | stationary | `firepeak-professor-basalt` | Kevin 96% |
| Cinder (`cinder`) | QUEST_GIVER; forge, sequences | AUTHORED | 5 Ancient Forge | `fh-cinder` (-5, -31) | stationary | `firepeak-cinder` | Stephen 92% |
| Ignis (`ignis`) | GUIDE; final challenge | AUTHORED | 7 Heart Chamber | `fh-ignis` (-4, -87) | stationary | `firepeak-ignis` | Ruth 92% |

Flint is stationary, not `guide`: a guide needs authored waypoints, which belong to the area
layout. Staff can switch his profile to `guide` in Django Admin once the path exists.
Coordinates are first guesses inside each zone's z range (design section 4); adjust the numbers
in Django Admin (NPC placements) or edit the module before the first run.

Placements use the NPC Manager placement model (ADR-054 item 4 exception to LAI-0805), so the
area's layout entities `fh-*` and these placements share names only.

## Animation mapping

Runtime state to clip: idle Idle, walk Walk, talk Talk, wave Wave, point Point, celebrate
Celebrate, laugh ReactHappy, sad ReactConcerned. Missing states fall back (`ANIMATION_FALLBACKS`):
run to walk, think to idle, jump to celebrate, and so on. The stand-in asset declares these eight
clips; once a GLB is uploaded its own clip list rules, and publish names any mapped clip the model
lacks. Kindle's float-like idle: if the model names it `Float`, set `idle` to `Float` on the
variant in Django Admin. Behaviour reactions: started and resumed wave, correct laugh,
incorrect sad, quest and adventure completed celebrate.

## Dialogue summary

Per NPC: `greeting-explorer` (ages 7 to 8, longer) and `greeting-pathfinder` (ages 5 to 6,
shorter), both `on_interact` with an AGE_BAND condition (priority 20); `welcome-back`
(`on_return_visit`); `fallback` (`on_interact`, priority 0, no condition, authored in code).
Choices use only `NONE`, `END` and (Kindle) `REQUEST_HINT`; nothing grants or completes anything.
Kindle also has `hint-wrong-answer` (`on_incorrect_answer`) and a hint choice in his greetings.
Professor Basalt starts facts with "Real volcanoes ..."; anything magical is island magic.

## AI and Polly fallbacks

- Only Kindle's `hint` node sets `allowAiHint`, with the single allowed topic
  "patterns and counting in Emberwood Forest". The node text is the authored fallback shown
  whenever AI is off, refused, slow or rate limited. The AI pipeline still checks the parent's AI
  setting, the kill switch and every output (ADR-054 item 7).
- Each NPC has an approved persona (version 1) with fallback lines, rules that forbid claiming to
  be human, asking for private information or secrets, or giving answers, and a short response cap.
- No free text from the child anywhere. Copy has no em dash and reads aloud.
- Voices: `VoiceProfile` per NPC (id = NPC id), voice and engine from the allowed Polly list. If a
  profile is missing or disabled the character is created without one and speaks as captions
  only; speech failures never block a line.

## Owner steps

Upload the character models (Django Admin, Asset Library):

1. Open `firepeak-flint` (and the other four) under Content assets, kind `character`.
2. Upload a GLB version with the clips Idle, Walk, Talk, Wave, Point, Celebrate, ReactHappy,
   ReactConcerned (missing ones fall back). Publish the version and set it as the default.
3. Run `seed_npc_firepeak --promote` (or set each character READY in Admin).

Publish an NPC release:

1. `python manage.py seed_npc_firepeak --publish` validates and publishes; or in Django Admin use
   NPC releases, Preview, then Publish. Both validate clips, voices, dialogue and placements.
2. A rerun with nothing changed prints `unchanged`. Roll back or retire from Admin if needed.
3. Deploying and migrating production data still need explicit owner approval.

## When an NPC is managed (parity with the legacy panel)

A manifest NPC the NPC Manager serves answers with the published dialogue, not `PipDialog`. What
that changes for Firepeak:

- Quest offer: Flint's greetings carry an `OFFER_QUEST` choice (`the-heart-of-firepeak`). Accepting
  is the child's own tap through the quests API, the same flow Pip uses; the client ignores an
  offer for a quest that is no longer available.
- Return to the NPC: `RegionPlayCompanion` keeps the legacy panel for an NPC while a RETURN_TO_NPC
  puzzle bound to it is unlocked and unsolved (`usesLegacyNpcDialogue`). Ignis therefore shows the
  "show the Professor" action and the puzzle stage line until `fh-heart-return` is solved, then the
  managed dialogue runs. While the puzzle is locked he is fully managed.
- Per-puzzle stage lines for other managed NPCs are not shown; those NPCs speak their published
  lines (Kindle's hints are the Manager's); the current puzzle's stage line still shows in its puzzle
  panel. A managed NPC with launch points also keeps the legacy panel, which carries the launch
  buttons the managed panel lacks.
