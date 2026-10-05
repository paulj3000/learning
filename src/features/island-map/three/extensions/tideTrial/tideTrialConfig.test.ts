import { describe, expect, it } from 'vitest';
import { parseTideTrialConfig, tryParseTideTrialConfig } from './tideTrialConfig';
import { PIRATE_BUILDER_BAY_MANIFEST } from '../../runtime/manifests/pirateBuilderBay';
import { tideTrialViewExtension } from './tideTrialViewExtension';

const BAY_CONFIG = PIRATE_BUILDER_BAY_MANIFEST.extensions[0]!.config;

describe('parseTideTrialConfig', () => {
  it('parses the bay’s config', () => {
    const parsed = parseTideTrialConfig(BAY_CONFIG);
    expect(parsed.interactionId).toBe('bay-broken-bridge');
    expect(parsed.ageBands).toEqual(['EXPLORER']);
    expect(parsed.worldChange.changeKey).toBe('BRIDGE_REPAIRED');
  });

  it('names the first bad field', () => {
    expect(() => parseTideTrialConfig({ ...BAY_CONFIG, bankTopCm: 'tall' })).toThrow('bankTopCm');
    expect(() => parseTideTrialConfig({ ...BAY_CONFIG, ageBands: ['TODDLER'] })).toThrow(
      'ageBands[0]',
    );
    expect(() => parseTideTrialConfig({ ...BAY_CONFIG, bridge: { minZ: 2, maxZ: 1 } })).toThrow(
      'bridge.minZ',
    );
  });

  it('returns null instead of throwing for callers that should quietly do nothing', () => {
    expect(tryParseTideTrialConfig({})).toBeNull();
  });
});

describe('tideTrialViewExtension.claimsInteraction', () => {
  const bridge = PIRATE_BUILDER_BAY_MANIFEST.interactions.find(
    (interaction) => interaction.id === 'bay-broken-bridge',
  )!;
  const pip = PIRATE_BUILDER_BAY_MANIFEST.interactions.find(
    (interaction) => interaction.id === 'meet-pirate-pip',
  )!;

  it('takes the broken bridge for an Explorer only', () => {
    expect(
      tideTrialViewExtension.claimsInteraction(bridge, { ageBand: 'EXPLORER', config: BAY_CONFIG }),
    ).toBe(true);
    expect(
      tideTrialViewExtension.claimsInteraction(bridge, {
        ageBand: 'PATHFINDER',
        config: BAY_CONFIG,
      }),
    ).toBe(false);
    expect(
      tideTrialViewExtension.claimsInteraction(bridge, { ageBand: 'SPROUT', config: BAY_CONFIG }),
    ).toBe(false);
  });

  it('leaves every other interaction alone', () => {
    expect(
      tideTrialViewExtension.claimsInteraction(pip, { ageBand: 'EXPLORER', config: BAY_CONFIG }),
    ).toBe(false);
  });

  it('claims nothing when its config is broken', () => {
    expect(
      tideTrialViewExtension.claimsInteraction(bridge, { ageBand: 'EXPLORER', config: {} }),
    ).toBe(false);
  });
});
