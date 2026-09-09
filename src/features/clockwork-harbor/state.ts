import {
  CLOCKWORK_CHANGE_KEYS,
  creatureChangeKey,
  GOLDEN_GEAR_IDS,
  goldenGearChangeKey,
  MECHANICAL_CREATURE_IDS,
  type ClockworkHarborState,
  type ClockworkRegionProgress,
} from './types';

/**
 * Projects a child's `WorldChange` history into Clockwork Harbor's state
 * (`docs/regions/clockwork.md` section 6).
 *
 * Pure and total: it takes the change keys the child has recorded and returns
 * a full snapshot, so there is no partially-loaded harbor and no `undefined`
 * for a scene to guard against. A child with no history gets every flag
 * `false` and both collections empty, which is exactly the harbor section 19
 * describes as "before".
 */
export function deriveClockworkHarborState(
  worldChangeKeys: readonly string[],
): ClockworkHarborState {
  const keys = new Set(worldChangeKeys);
  const marketMysterySolved = keys.has(CLOCKWORK_CHANGE_KEYS.MARKET_MYSTERY_SOLVED);

  return {
    lighthouseFixed: keys.has(CLOCKWORK_CHANGE_KEYS.LIGHTHOUSE_FIXED),
    marketMysterySolved,
    /*
      Section 11 sets `companionCogUnlocked` in the same completion block as
      `marketMysterySolved`, so it is that fact seen from another angle rather
      than a second thing to record. Deriving it means the two can never
      disagree - there is no history in which a child solved the mystery but
      did not get Cog.
    */
    companionCogUnlocked: marketMysterySolved,
    drawbridgeFixed: keys.has(CLOCKWORK_CHANGE_KEYS.DRAWBRIDGE_FIXED),
    animalsRecovered: MECHANICAL_CREATURE_IDS.filter((id) => keys.has(creatureChangeKey(id))),
    workshopUnlocked: keys.has(CLOCKWORK_CHANGE_KEYS.WORKSHOP_UNLOCKED),
    undergroundUnlocked: keys.has(CLOCKWORK_CHANGE_KEYS.UNDERGROUND_UNLOCKED),
    heartRestored: keys.has(CLOCKWORK_CHANGE_KEYS.HEART_RESTORED),
    goldenGearsFound: GOLDEN_GEAR_IDS.filter((id) => keys.has(goldenGearChangeKey(id))),
  };
}

/**
 * Section 6's `NOT_STARTED -> MASTERED` ladder, derived from the same history.
 *
 * `MASTERED` deliberately requires the story *and* all twelve Golden Gears:
 * section 21 makes the gears the optional collection and section 31 lists
 * "return after completing the story and find new activities", so a child who
 * finished the story has `COMPLETED` and still has somewhere to go. Note that
 * this ladder never moves backward - it reads history, and history only grows.
 */
export function deriveClockworkRegionProgress(
  worldChangeKeys: readonly string[],
): ClockworkRegionProgress {
  const keys = new Set(worldChangeKeys);
  if (!keys.has(CLOCKWORK_CHANGE_KEYS.ARRIVED)) return 'NOT_STARTED';

  const state = deriveClockworkHarborState(worldChangeKeys);
  if (state.heartRestored) {
    return state.goldenGearsFound.length === GOLDEN_GEAR_IDS.length ? 'MASTERED' : 'COMPLETED';
  }
  /*
    "In progress" is the first *chapter* behind them, not the first step: the
    lighthouse is chapter one (section 10), so anything that opens the
    marketplace is what separates a child who has walked in from a child who
    has actually changed something.
  */
  return state.lighthouseFixed ? 'IN_PROGRESS' : 'DISCOVERED';
}
