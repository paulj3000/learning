import type { EnginePresentationEventMap } from '@lai/game-engine/contracts';
import type { WorldEngineEventMap } from './worldEngineEvents';

/**
 * GE-007: the engine's presentation events and this runtime's bus must agree on every event
 * both define, so a host forwards one to the other unchanged while worlds migrate. A type
 * error here means one side changed a payload without the other.
 */
type Shared = keyof EnginePresentationEventMap & keyof WorldEngineEventMap;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AllSame = {
  [K in Shared]: Same<EnginePresentationEventMap[K], WorldEngineEventMap[K]>;
}[Shared];

const parity: AllSame = true;
const everyEngineEventIsShared: Exclude<
  keyof EnginePresentationEventMap,
  keyof WorldEngineEventMap
> extends never
  ? true
  : false = true;

describe('engine presentation event parity', () => {
  it('matches WorldEngineEventMap for every shared event', () => {
    expect(parity).toBe(true);
    expect(everyEngineEventIsShared).toBe(true);
  });
});
