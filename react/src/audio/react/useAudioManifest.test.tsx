import { StrictMode, useMemo } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSoundManager } from '../SoundManager';
import { resetSharedSoundManager } from '../sharedSoundManager';
import { FakeEngine } from '../testing/fakes';
import type { ManifestScope } from '../manifest/manifestTypes';
import { SoundProvider, useAudioManifest, type AudioManifestSource } from '.';

afterEach(() => resetSharedSoundManager());

const manifest = (scope: ManifestScope, revision = 'r1') => ({
  schemaVersion: 1,
  revision,
  scope,
  sounds: [{ id: 'sfx.chest.open', assetId: 'chest@1', channel: 'sfx', volume: 1, loop: false }],
  assignments: [
    { event: 'on_open', targetType: 'chest', targetId: 'c1', soundId: 'sfx.chest.open' },
  ],
});

function build() {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine });
  const fetchManifest = vi.fn(async (scope: ManifestScope) => manifest(scope));
  const source: AudioManifestSource = {
    fetchManifest,
    resolver: { resolve: async (id) => ({ id, url: `signed://${id}` }) },
  };
  return { engine, manager, fetchManifest, source };
}

function Probe({
  source,
  scope,
}: {
  source: AudioManifestSource | null;
  scope: ManifestScope | null;
}) {
  const audio = useAudioManifest(source, scope);
  return (
    <div>
      <p data-testid="status">{audio.status}</p>
      <p data-testid="revision">{audio.revision ?? 'none'}</p>
      <button onClick={() => void audio.trigger('on_open', 'chest', 'c1')}>open</button>
    </div>
  );
}

const REGION: ManifestScope = { type: 'region', id: 'treasure-cove' };

describe('useAudioManifest', () => {
  it('loads the manifest, reports ready, and plays an assigned sound', async () => {
    const { manager, engine, source } = build();
    render(
      <SoundProvider manager={manager}>
        <Probe source={source} scope={REGION} />
      </SoundProvider>,
    );
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('revision')).toHaveTextContent('r1');
    expect(manager.has('sfx.chest.open')).toBe(true);
    await act(async () => screen.getByRole('button', { name: 'open' }).click());
    await waitFor(() => expect(engine.voices).toHaveLength(1));
  });

  it('is idle, and fetches nothing, without a source or a scope', () => {
    const { manager, source, fetchManifest } = build();
    render(
      <SoundProvider manager={manager}>
        <Probe source={null} scope={REGION} />
        <Probe source={source} scope={null} />
      </SoundProvider>,
    );
    expect(screen.getAllByTestId('status').map((node) => node.textContent)).toEqual([
      'idle',
      'idle',
    ]);
    expect(fetchManifest).not.toHaveBeenCalled();
  });

  it('reports failed and keeps the game going when the manifest cannot be loaded', async () => {
    const { manager, source } = build();
    source.fetchManifest = async () => {
      throw new Error('offline');
    };
    render(
      <SoundProvider manager={manager}>
        <Probe source={source} scope={REGION} />
      </SoundProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('failed'));
    expect(manager.has('sfx.chest.open')).toBe(false);
  });

  it('removes the sounds and the resolver and stops playback on unmount', async () => {
    const { manager, engine, source } = build();
    const view = render(
      <SoundProvider manager={manager}>
        <Probe source={source} scope={REGION} />
      </SoundProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    await act(async () => screen.getByRole('button', { name: 'open' }).click());
    await waitFor(() => expect(engine.voices).toHaveLength(1));
    view.unmount();
    expect(manager.has('sfx.chest.open')).toBe(false);
    expect(engine.voices[0]?.stopped).toBe(true);
    await expect(manager.play('sfx.chest.open')).resolves.toBeNull();
  });

  it('swaps the manifest when the scope changes', async () => {
    const { manager, source, fetchManifest } = build();
    const other: ManifestScope = { type: 'place', id: 'pirate-bay' };
    const view = render(
      <SoundProvider manager={manager}>
        <Probe source={source} scope={REGION} />
      </SoundProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    view.rerender(
      <SoundProvider manager={manager}>
        <Probe source={source} scope={other} />
      </SoundProvider>,
    );
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(fetchManifest).toHaveBeenCalledTimes(2);
    expect(manager.has('sfx.chest.open')).toBe(true);
  });

  it('under StrictMode leaves exactly one live registration', async () => {
    const { manager, source } = build();
    const view = render(
      <StrictMode>
        <SoundProvider manager={manager}>
          <Probe source={source} scope={REGION} />
        </SoundProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(manager.has('sfx.chest.open')).toBe(true);
    view.unmount();
    expect(manager.has('sfx.chest.open')).toBe(false);
  });

  it('does not refetch when a parent re-renders with the same source and scope', async () => {
    const { manager, source, fetchManifest } = build();
    function Parent({ tick }: { tick: number }) {
      const scope = useMemo(() => ({ ...REGION }), []);
      return (
        <SoundProvider manager={manager}>
          <span>{tick}</span>
          <Probe source={source} scope={scope} />
        </SoundProvider>
      );
    }
    const view = render(<Parent tick={1} />);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    view.rerender(<Parent tick={2} />);
    expect(fetchManifest).toHaveBeenCalledTimes(1);
  });
});
