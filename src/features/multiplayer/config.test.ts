import { readMultiplayerConfig } from './config';

describe('readMultiplayerConfig', () => {
  it('is off by default', () => {
    expect(readMultiplayerConfig({})).toEqual({ enabled: false });
    expect(readMultiplayerConfig({ VITE_MULTIPLAYER_URL: 'wss://mp.example.org' })).toEqual({
      enabled: false,
    });
  });

  it('turns on with a secure URL', () => {
    expect(
      readMultiplayerConfig({
        VITE_MULTIPLAYER_ENABLED: 'true',
        VITE_MULTIPLAYER_URL: 'wss://mp.example.org/',
      }),
    ).toEqual({ enabled: true, serverUrl: 'wss://mp.example.org', devRegionIds: [] });
  });

  it('only accepts ws:// in development', () => {
    const insecure = {
      VITE_MULTIPLAYER_ENABLED: 'true',
      VITE_MULTIPLAYER_URL: 'ws://localhost:2567',
    };
    expect(readMultiplayerConfig(insecure)).toEqual({ enabled: false });
    expect(readMultiplayerConfig({ ...insecure, DEV: true })).toMatchObject({ enabled: true });
  });

  it('rejects other protocols and garbage', () => {
    expect(
      readMultiplayerConfig({
        VITE_MULTIPLAYER_ENABLED: 'true',
        VITE_MULTIPLAYER_URL: 'https://x',
        DEV: true,
      }),
    ).toEqual({ enabled: false });
    expect(
      readMultiplayerConfig({
        VITE_MULTIPLAYER_ENABLED: 'true',
        VITE_MULTIPLAYER_URL: 'not a url',
        DEV: true,
      }),
    ).toEqual({ enabled: false });
  });

  it('honours dev regions only in development', () => {
    const env = {
      VITE_MULTIPLAYER_ENABLED: 'true',
      VITE_MULTIPLAYER_URL: 'wss://mp.example.org',
      VITE_MULTIPLAYER_DEV_REGIONS: ' welcome-harbor, ,pirate-builder-bay ',
    };
    expect(readMultiplayerConfig(env)).toMatchObject({ devRegionIds: [] });
    expect(readMultiplayerConfig({ ...env, DEV: true })).toMatchObject({
      devRegionIds: ['welcome-harbor', 'pirate-builder-bay'],
    });
  });
});
