import { describe, expect, it } from 'vitest';
import { recoveredText } from '../platforms/platformCopy';
import type { ThreeLocationManifest } from './locationManifest';
import { bridgeCheckpointLabels } from './ThreeLocationWorldView';

/** GE-065: a recovery toast names the checkpoint even when the list lives in the engine bridge. */

function manifest(extensions: unknown[]): ThreeLocationManifest {
  return { extensions } as unknown as ThreeLocationManifest;
}

describe('bridge checkpoint labels', () => {
  it('reads labels from the engineBridge binding’s gameplay.checkpoints list', () => {
    const labels = bridgeCheckpointLabels(
      manifest([
        { extensionId: 'region-play', config: {} },
        {
          extensionId: 'engineBridge',
          config: {
            capabilities: [
              { id: 'gameplay.hazards', config: {} },
              {
                id: 'gameplay.checkpoints',
                config: {
                  checkpoints: [{ id: 'cp-bank', label: 'the near bank' }, { id: 'no-label' }],
                },
              },
            ],
          },
        },
      ]),
    );
    expect([...labels]).toEqual([['cp-bank', 'the near bank']]);
  });

  it('is empty without a bridge binding', () => {
    expect(bridgeCheckpointLabels(manifest([])).size).toBe(0);
    expect(bridgeCheckpointLabels({} as ThreeLocationManifest).size).toBe(0);
  });

  it('recoveredText prefers the platforming list, then the labels', () => {
    const spec = {
      platforms: [],
      checkpoints: [{ id: 'cp-dock', x: 0, z: 0, label: 'the old dock' }],
    };
    const labels = new Map([['cp-bank', 'the near bank']]);
    expect(recoveredText(spec, 'cp-dock', labels)).toContain('the old dock');
    expect(recoveredText(spec, 'cp-bank', labels)).toContain('the near bank');
    expect(recoveredText(spec, 'cp-unknown', labels)).toContain('Have another go!');
  });
});
