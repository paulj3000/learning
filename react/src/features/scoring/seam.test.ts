import { describe, expectTypeOf, it } from 'vitest';
import type { GameHostProps } from '../game-engine/GameHost';
import type { EngineBridgeOptions } from '../game-engine/bridge/engineBridge';
import type { ScoringClaims } from './useScoringClaims';

/**
 * The integration seam (GE-108): the scoring hook's callback plugs straight into the engine's
 * two claim sinks, GameHost and the location engine bridge, with no adapter code at the call
 * site. A contract change on either side fails this file at typecheck.
 */
describe('scoring claims seam', () => {
  it('fits GameHost.onGameplayEvent', () => {
    expectTypeOf<ScoringClaims['onGameplayEvent']>().toMatchTypeOf<
      NonNullable<GameHostProps['onGameplayEvent']>
    >();
  });

  it('fits the location engine bridge sink', () => {
    expectTypeOf<ScoringClaims['onGameplayEvent']>().toMatchTypeOf<
      NonNullable<EngineBridgeOptions['onGameplayEvent']>
    >();
  });
});
