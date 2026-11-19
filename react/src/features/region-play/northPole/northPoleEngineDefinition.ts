import { defineAdventure, defineRealm, type AdventureDefinition, type RealmDefinition } from '@lai/game-engine/sdk';
import { NPC_MANAGER, QUEST_SERVICE, SOUND_MANAGER } from '@lai/game-engine/services';
import {
  NORTH_POLE_KEYS,
  NORTH_POLE_PLACE_SLUG,
  NORTH_POLE_PUZZLE_HOSTS,
  NORTH_POLE_QUEST_IDS,
  NORTH_POLE_WORLD_SLUG,
} from '../../content-export/northPoleContent';

/**
 * GE-074: North Pole as Game Engine Core data (ADR-080: one Realm, one Place, one large 3D Area,
 * nine quests). Ids only: Django stays authoritative for the layout
 * (`lai/apps/regions/north_pole_layout.py`), the 27 puzzles, the chests and the rewards. Seasonal
 * availability is the seasons app's (ADR-081), never engine data. Nothing here changes play; the
 * live region-play runtime keeps running the Area until the location engine bridge (GE-065) lands.
 *
 * Kept equal to the seed by `northPoleEngineDefinition.test.ts` (scene snapshot
 * `lai/apps/regions/north_pole_scene.json`, puzzles `north_pole_puzzles.json`).
 */

export const NORTH_POLE_AREA = NORTH_POLE_PLACE_SLUG;
export const NORTH_POLE_ADVENTURE_ID = 'the-missing-christmas-star';

/**
 * Today's two checkpoint lists, kept together: the zone checkpoints (`effects.checkpoints`, resume)
 * and the lake course checkpoints (`platforming.checkpoints`, hazard recovery). The adoption step
 * moves both into the engine's one `gameplay.checkpoints` list.
 */
export const NORTH_POLE_CHECKPOINT_IDS = [
  'np-cp-landing',
  'np-cp-workshop',
  'np-cp-forest',
  'np-cp-lake',
  'np-cp-stables',
  'np-cp-gingerbread',
  'np-cp-mountain',
  'np-cp-observatory',
  'np-cp-finale',
  'np-course-cp-lake-east',
  'np-course-cp-lake-island',
] as const;

/**
 * Jump challenges: an optional jump route and a stair or ramp reaching the same place (NP-D5).
 * The trampoline, the stable log hops and the lake's thin ice lead only to optional collectibles,
 * which the jumping standard allows, so they are optional routes, not challenges.
 */
export const NORTH_POLE_JUMP_ROUTES = [
  { id: 'np-jump-village-steps', jumpRouteId: 'np-ledge-step-a', accessibleRouteId: 'np-stair-village-1' },
  { id: 'np-jump-workshop-crates', jumpRouteId: 'np-ledge-crate-1', accessibleRouteId: 'np-stair-shelf-1' },
  { id: 'np-jump-forest-stones', jumpRouteId: 'np-plat-pepper-1', accessibleRouteId: 'np-stair-candy-1' },
  { id: 'np-jump-gingerbread-cookies', jumpRouteId: 'np-plat-cookie-1', accessibleRouteId: 'np-ramp-ginger-1' },
] as const;

/** Zone restorations: the world changes a child sees on the island (scoring REALM_MILESTONE). */
export const NORTH_POLE_MILESTONE_IDS = [
  NORTH_POLE_KEYS.workshopRestored,
  NORTH_POLE_KEYS.forestDone,
  NORTH_POLE_KEYS.lakeDone,
  NORTH_POLE_KEYS.snowballHome,
  NORTH_POLE_KEYS.gingerRepaired,
  NORTH_POLE_KEYS.mountainSummit,
  NORTH_POLE_KEYS.starRestored,
  NORTH_POLE_KEYS.christmasEve,
] as const;

export const NORTH_POLE_REALM: Readonly<RealmDefinition> = defineRealm({
  id: NORTH_POLE_WORLD_SLUG,
  version: '1.0.0',
  titleKey: 'realm.northPole.title',
  places: [{ id: NORTH_POLE_PLACE_SLUG, titleKey: 'place.northPoleVillage.title', areaIds: [NORTH_POLE_AREA] }],
  ageBands: ['SPROUT', 'PATHFINDER', 'EXPLORER'],
  milestoneIds: [...NORTH_POLE_MILESTONE_IDS],
  adventureIds: [NORTH_POLE_ADVENTURE_ID],
});

/** The 23 skills the 27 puzzles teach across the three bands (`NORTH_POLE_CURRICULUM.md`). */
const SKILLS = [
  'addition-two-digit',
  'addition-within-ten',
  'animal-science',
  'cause-and-effect',
  'classification',
  'comparing-lengths',
  'counting-sets',
  'earth-and-space',
  'following-directions',
  'fractions',
  'measurement',
  'multiplication-facts',
  'number-order',
  'observation',
  'patterns',
  'phonemic-awareness',
  'reading-comprehension',
  'sequencing',
  'shapes',
  'shapes-and-halves',
  'sight-words',
  'subtraction-within-ten',
  'symmetry',
];

/** The 27 puzzles, from the content export (each one's hosting NPC). */
export const NORTH_POLE_PUZZLE_IDS: readonly string[] = Object.keys(NORTH_POLE_PUZZLE_HOSTS);

export const NORTH_POLE_ADVENTURE: Readonly<AdventureDefinition> = defineAdventure({
  id: NORTH_POLE_ADVENTURE_ID,
  realmId: NORTH_POLE_WORLD_SLUG,
  version: '1.0.0',
  engineApi: '^0.1.0',
  ageBands: ['SPROUT', 'PATHFINDER', 'EXPLORER'],
  learningObjectiveIds: SKILLS,
  areas: [NORTH_POLE_AREA],
  capabilities: [
    { id: 'movement.locomotion' },
    { id: 'movement.jump' },
    { id: 'gameplay.checkpoints' },
    { id: 'gameplay.hazards' },
    { id: 'gameplay.platforms' },
    { id: 'gameplay.puzzles' },
    { id: 'gameplay.collectibles' },
    { id: 'gameplay.chests' },
    { id: 'gameplay.jumpChallenges' },
    { id: 'environment.lighting' },
    { id: 'environment.weather' },
    { id: 'environment.particles' },
  ],
  questIds: [...NORTH_POLE_QUEST_IDS],
  challengeIds: [...NORTH_POLE_PUZZLE_IDS],
  jumpChallenges: NORTH_POLE_JUMP_ROUTES.map((route) => ({ ...route, areaId: NORTH_POLE_AREA, optional: true })),
  checkpoints: NORTH_POLE_CHECKPOINT_IDS.map((id) => ({ id, areaId: NORTH_POLE_AREA })),
  worldConsequenceId: NORTH_POLE_KEYS.adventureComplete,
  contentSource: 'DJANGO_PUBLISHED',
  requiredServices: [QUEST_SERVICE.id, NPC_MANAGER.id, SOUND_MANAGER.id],
});
