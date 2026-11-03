import { describe, expect, it } from 'vitest';
import { AudioError } from '../AudioTypes';
import { MAX_SOUNDS, parseAudioManifest } from './parseManifest';

const sound = (overrides: Record<string, unknown> = {}) => ({
  id: 'sfx.chest.open',
  assetId: 'chest-creak@2',
  channel: 'sfx',
  volume: 0.85,
  loop: false,
  ...overrides,
});

const manifest = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  revision: 'abc123',
  scope: { type: 'region', id: 'treasure-cove' },
  sounds: [sound()],
  assignments: [
    { event: 'on_open', targetType: 'chest', targetId: 'chest-001', soundId: 'sfx.chest.open' },
  ],
  ...overrides,
});

function refusal(raw: unknown): AudioError {
  try {
    parseAudioManifest(raw);
  } catch (error) {
    if (error instanceof AudioError) return error;
  }
  throw new Error('expected the manifest to be refused');
}

describe('a valid manifest', () => {
  it('becomes sound definitions that match the Sound Manager contract', () => {
    const { manifest: parsed, skipped } = parseAudioManifest(manifest());
    expect(skipped).toEqual([]);
    expect(parsed.revision).toBe('abc123');
    expect(parsed.scope).toEqual({ type: 'region', id: 'treasure-cove' });
    expect(parsed.sounds).toEqual([
      {
        id: 'sfx.chest.open',
        assetId: 'chest-creak@2',
        channel: 'sfx',
        loop: false,
        defaultVolume: 0.85,
      },
    ]);
    expect(parsed.assignments).toHaveLength(1);
  });

  it('carries the optional playback settings through', () => {
    const { manifest: parsed } = parseAudioManifest(
      manifest({
        sounds: [
          sound({
            stream: true,
            priority: 70,
            maxConcurrent: 2,
            cooldownMs: 150,
            fadeInMs: 800,
            fadeOutMs: 400,
          }),
        ],
        assignments: [],
      }),
    );
    expect(parsed.sounds[0]).toMatchObject({
      stream: true,
      priority: 70,
      maxConcurrent: 2,
      cooldownMs: 150,
      fadeInMs: 800,
      fadeOutMs: 400,
    });
  });

  it('copies known fields only, so a url or key in the input never reaches the engine', () => {
    const { manifest: parsed } = parseAudioManifest(
      manifest({
        sounds: [sound({ url: 'https://evil.example/x.mp3', storage_key: 'assets/audio/x' })],
      }),
    );
    const entry = parsed.sounds[0] as unknown as Record<string, unknown>;
    expect(entry.url).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain('evil.example');
    expect(JSON.stringify(parsed)).not.toContain('storage_key');
  });

  it('accepts an empty manifest, which is what Django serves before anything is published', () => {
    const { manifest: parsed } = parseAudioManifest(manifest({ sounds: [], assignments: [] }));
    expect(parsed.sounds).toEqual([]);
  });
});

describe('a manifest that cannot be used', () => {
  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'sounds'],
    ['an unknown schema version', manifest({ schemaVersion: 2 })],
    ['a missing schema version', (({ schemaVersion: _s, ...rest }) => rest)(manifest())],
    ['a missing revision', manifest({ revision: undefined })],
    ['an empty revision', manifest({ revision: '' })],
    ['a missing scope', manifest({ scope: undefined })],
    ['an unknown scope type', manifest({ scope: { type: 'galaxy', id: 'x' } })],
    ['a scope id that is not a slug', manifest({ scope: { type: 'region', id: '../x' } })],
    ['sounds that are not a list', manifest({ sounds: {} })],
    ['assignments that are not a list', manifest({ assignments: 'none' })],
    ['too many sounds', manifest({ sounds: new Array(MAX_SOUNDS + 1).fill(sound()) })],
  ])('is refused whole: %s', (_name, raw) => {
    expect(refusal(raw).code).toBe('invalid-manifest');
  });
});

describe('one bad entry does not silence the rest', () => {
  it.each([
    ['an id that is not a cue id', sound({ id: 'chest-open' })],
    ['an id that lies about its channel', sound({ id: 'music.chest.open' })],
    ['an unknown channel', sound({ id: 'foley.a.b', channel: 'foley' })],
    ['an asset reference that is a url', sound({ assetId: 'https://x.example/a.mp3' })],
    ['an asset reference without a version', sound({ assetId: 'chest-creak' })],
    ['an asset reference with a path', sound({ assetId: '../chest@1' })],
    ['a volume above one', sound({ volume: 1.2 })],
    ['a volume that is not a number', sound({ volume: '0.5' })],
    ['a loop that is not a boolean', sound({ loop: 'yes' })],
    ['a negative cooldown', sound({ cooldownMs: -1 })],
    ['a fractional concurrency limit', sound({ maxConcurrent: 1.5 })],
    ['not an object', 'sound'],
    ['null', null],
  ])('skips a sound with %s', (_name, bad) => {
    const good = sound({ id: 'sfx.coin.collect', assetId: 'coin@1' });
    const { manifest: parsed, skipped } = parseAudioManifest(
      manifest({ sounds: [bad, good], assignments: [] }),
    );
    expect(parsed.sounds.map((s) => s.id)).toEqual(['sfx.coin.collect']);
    expect(skipped).toHaveLength(1);
  });

  it('skips a duplicate sound id, keeping the first', () => {
    const { manifest: parsed, skipped } = parseAudioManifest(
      manifest({ sounds: [sound(), sound({ assetId: 'other@1' })], assignments: [] }),
    );
    expect(parsed.sounds).toHaveLength(1);
    expect(parsed.sounds[0]?.assetId).toBe('chest-creak@2');
    expect(skipped[0]).toContain('duplicate');
  });

  it('skips an assignment to a sound that was skipped or never existed', () => {
    const { manifest: parsed, skipped } = parseAudioManifest(
      manifest({
        sounds: [sound({ volume: 9 })],
        assignments: [
          { event: 'on_open', targetType: 'chest', targetId: 'c1', soundId: 'sfx.chest.open' },
          { event: 'on_open', targetType: 'chest', targetId: 'c1', soundId: 'sfx.ghost.sound' },
        ],
      }),
    );
    expect(parsed.assignments).toEqual([]);
    expect(skipped).toHaveLength(3);
  });

  it.each([
    ['an event with a path', { event: '../x' }],
    ['a target type with capitals', { targetType: 'Chest' }],
    ['a target id with a slash', { targetId: 'a/b' }],
    ['a non-string event', { event: 5 }],
  ])('skips an assignment with %s', (_name, change) => {
    const { manifest: parsed } = parseAudioManifest(
      manifest({
        assignments: [
          {
            event: 'on_open',
            targetType: 'chest',
            targetId: 'c1',
            soundId: 'sfx.chest.open',
            ...change,
          },
        ],
      }),
    );
    expect(parsed.assignments).toEqual([]);
  });

  it('allows an empty target id, used by sounds that belong to the scope itself', () => {
    const { manifest: parsed } = parseAudioManifest(
      manifest({
        assignments: [
          { event: 'on_enter', targetType: 'scope', targetId: '', soundId: 'sfx.chest.open' },
        ],
      }),
    );
    expect(parsed.assignments).toHaveLength(1);
  });
});
