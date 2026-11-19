import { describe, expect, it } from 'vitest';
import { bridgeCheckpointIds } from './bridgeCheckpoints';

describe('bridgeCheckpointIds (GE-066)', () => {
  it('reads the gameplay.checkpoints ids of the engineBridge extension only', () => {
    expect(
      [
        ...bridgeCheckpointIds({
          extensions: [
            { extensionId: 'regionPlay', config: { capabilities: [{ id: 'gameplay.checkpoints', config: { checkpoints: [{ id: 'not-bridge' }] } }] } },
            {
              extensionId: 'engineBridge',
              config: {
                capabilities: [
                  { id: 'gameplay.hazards', config: { hazards: [] } },
                  { id: 'gameplay.checkpoints', config: { checkpoints: [{ id: 'cp.a' }, { id: 'cp.b' }, { label: 'no id' }] } },
                ],
              },
            },
          ],
        }),
      ].sort(),
    ).toEqual(['cp.a', 'cp.b']);
  });

  it('serves nothing for a missing or odd config', () => {
    expect(bridgeCheckpointIds({ extensions: [] }).size).toBe(0);
    expect(bridgeCheckpointIds({ extensions: [{ extensionId: 'engineBridge', config: { capabilities: 'all' } }] }).size).toBe(0);
    expect(bridgeCheckpointIds({ extensions: [{ extensionId: 'engineBridge', config: { capabilities: [null, 3] } }] }).size).toBe(0);
  });
});
