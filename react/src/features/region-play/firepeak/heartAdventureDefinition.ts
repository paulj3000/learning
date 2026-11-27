import { defineAdventure, type AdventureDefinition } from '@lai/game-engine/sdk';
import { NPC_MANAGER, QUEST_SERVICE, SOUND_MANAGER } from '@lai/game-engine/services';
import {
  HEART_CHANGE_KEYS,
  HEART_PLACE_SLUG,
  HEART_PUZZLE_IDS,
  HEART_QUEST_ID,
} from '../../content-export/firepeakHeartContent';

/**
 * GE-073: The Heart of Firepeak as Game Engine Core data (Realm > Adventure > Quest > Challenge).
 *
 * Ids only. Django stays authoritative for the layout (`lai/apps/regions/firepeak_heart_layout.py`),
 * the puzzles, their grading and the rewards (ADR-033, ADR-073). This definition says which engine
 * capabilities the Area needs and names the authored ids the engine refers to, so the content
 * compatibility checks and the location engine bridge (GE-065) can be pointed at it. Nothing here
 * changes play: the live region-play runtime keeps running the Area until the bridge lands.
 *
 * Kept equal to the seed by `heartAdventureDefinition.test.ts` (scene snapshot
 * `lai/apps/regions/firepeak_heart_scene.json`).
 */

/** The Place and its one 3D Area share the slug. */
export const FIREPEAK_HEART_AREA = HEART_PLACE_SLUG;

/** The Heart lies on the home island (the Place `firepeak-heart`, `HOME_WORLD_SLUG`). */
export const HOME_REALM_ID = 'learning-adventure-island';

/** Checkpoints in route order (`CHECKPOINTS` in the layout); each opens with its zone's key. */
export const FIREPEAK_HEART_CHECKPOINT_IDS = [
  'fh-cp-landing',
  'fh-cp-emberwood',
  'fh-cp-lava-near',
  'fh-cp-lava-far',
  'fh-cp-caverns',
  'fh-cp-forge',
  'fh-cp-summit',
  'fh-cp-heart',
] as const;

/** The 14 server-graded puzzles, in quest order (the content export's list). */
export const FIREPEAK_HEART_PUZZLE_IDS: readonly string[] = HEART_PUZZLE_IDS;

/**
 * Jump challenges, all optional (FPV-D7). Route ids name authored platforms, colliders or zones.
 * Most have a walking route to the same place. The lava stepping stones are jump-only: they lead
 * only to the optional Lava Jumper shard (jumping standard), so `accessibleRouteId` is null and
 * nothing required lies behind them (`test_firepeak_heart_layout.py` walks every required route).
 */
export const FIREPEAK_HEART_JUMP_ROUTES = [
  // The landing log, beside the open path to the Emberwood gate.
  { id: 'fh-jump-landing-log', jumpRouteId: 'fh-jump-log', accessibleRouteId: 'fh-zone-landing' },
  // Emberwood logs, beside the forest path.
  {
    id: 'fh-jump-forest-logs',
    jumpRouteId: 'fh-forest-log-1',
    accessibleRouteId: 'fh-zone-emberwood',
  },
  // Summit hops; the stairs (0.2 m rises) reach the same plateau.
  {
    id: 'fh-jump-summit-hops',
    jumpRouteId: 'fh-summit-hop-1',
    accessibleRouteId: 'fh-summit-up-1',
  },
  // Lava stepping stones to the optional Lava Jumper shard: jump-only.
  { id: 'fh-jump-lava-stones', jumpRouteId: 'fh-stone-1', accessibleRouteId: null },
] as const satisfies readonly {
  id: string;
  jumpRouteId: string;
  accessibleRouteId: string | null;
}[];

export const FIREPEAK_HEART_ADVENTURE: Readonly<AdventureDefinition> = defineAdventure({
  id: HEART_QUEST_ID,
  realmId: HOME_REALM_ID,
  version: '1.0.0',
  engineApi: '>=0.1.0 <1.0.0',
  // FP-D2: Pathfinders and Explorers only.
  ageBands: ['PATHFINDER', 'EXPLORER'],
  // Catalog objectives (FPV-D10): every band `skill` and variant `skill` the puzzles name.
  learningObjectiveIds: [
    'addition-within-100',
    'addition-within-ten',
    'cause-and-effect',
    'comparing-and-ordering-numbers',
    'earth-science',
    'equal-sharing',
    'following-instructions',
    'halves-and-fractions',
    'measurement',
    'multiplication-facts',
    'patterns',
    'reading-comprehension',
    'sequencing',
    'shapes-and-geometry',
    'simple-circuits',
    'subtraction-within-100',
    'subtraction-within-ten',
  ],
  areas: [FIREPEAK_HEART_AREA],
  capabilities: [
    { id: 'movement.locomotion' },
    { id: 'movement.jump' },
    { id: 'gameplay.checkpoints' },
    { id: 'gameplay.hazards' },
    { id: 'gameplay.platforms' },
    { id: 'gameplay.puzzles' },
    { id: 'gameplay.collectibles' },
    { id: 'gameplay.jumpChallenges' },
    { id: 'environment.lighting' },
    { id: 'environment.particles' },
  ],
  questIds: [HEART_QUEST_ID],
  challengeIds: [...FIREPEAK_HEART_PUZZLE_IDS],
  jumpChallenges: FIREPEAK_HEART_JUMP_ROUTES.map((route) => ({
    ...route,
    areaId: FIREPEAK_HEART_AREA,
    optional: true,
  })),
  checkpoints: FIREPEAK_HEART_CHECKPOINT_IDS.map((id) => ({ id, areaId: FIREPEAK_HEART_AREA })),
  worldConsequenceId: HEART_CHANGE_KEYS.complete,
  contentSource: 'DJANGO_PUBLISHED',
  requiredServices: [QUEST_SERVICE.id, NPC_MANAGER.id, SOUND_MANAGER.id],
});
