import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import type { RegionBootstrap } from '../../../../../api/play/types';
import type { RegionPlayInteractionEvent } from '../../../../region-play/regionPlayInteractions';
import { firepeakBootstrapJson, puzzleOutcomeJson } from '../../../../../test/firepeakFixtures';
import { AreaPuzzleLayer } from './AreaPuzzleLayer';
import type { AreaEffectsEvents } from './areaEffectsScene';
import type { RegionPlaySceneApi } from './regionPlayScene';

/** The puzzle layer (ADR-043 F, Firepeak FP-5 to FP-8): moves stay local, the server grades. */

function bootstrap(solved: string[] = []): RegionBootstrap {
  return read(firepeakBootstrapJson({ solved, session: true }), parse.regionBootstrap);
}

function fakeScene() {
  const listeners: Partial<AreaEffectsEvents>[] = [];
  const scene = {
    setChestOpen: vi.fn(),
    isChestOpen: () => undefined,
    effects: {
      setChangeKeys: vi.fn(),
      useReturn: vi.fn(() => false),
      previewSteamCleared: vi.fn(),
      safeCheckpoint: () => null,
      subscribe: (listener: Partial<AreaEffectsEvents>) => {
        listeners.push(listener);
        return () => undefined;
      },
    },
    puzzles: {
      showArrangement: vi.fn(),
      showValveTurns: vi.fn(),
      discover: vi.fn(async () => undefined),
      setVisible: vi.fn(),
    },
  } satisfies RegionPlaySceneApi;
  return { scene, listeners };
}

function puzzleEvent(data: RegionBootstrap, entityId: string): RegionPlayInteractionEvent {
  const puzzle = data.puzzles.find((p) => p.entityIds.includes(entityId))!;
  return { kind: 'puzzle', entityId, label: entityId, puzzle };
}

function setup(
  options: { solved?: string[]; outcome?: Record<string, unknown>; event?: string | null } = {},
) {
  const data = bootstrap(options.solved);
  const { scene, listeners } = fakeScene();
  const solvePuzzle = vi.fn(async () =>
    read(puzzleOutcomeJson(options.outcome), parse.puzzleOutcome),
  );
  const showToast = vi.fn();
  const onClose = vi.fn();
  const props = {
    bootstrap: data,
    sceneApi: scene,
    busy: false,
    solvePuzzle,
    showToast,
    onClose,
  };
  const view = render(
    <AreaPuzzleLayer {...props} event={options.event ? puzzleEvent(data, options.event) : null} />,
  );
  const open = (entityId: string) =>
    view.rerender(<AreaPuzzleLayer {...props} event={puzzleEvent(data, entityId)} />);
  return { data, scene, listeners, solvePuzzle, showToast, onClose, open, view, props };
}

describe('the telescope', () => {
  it('asks the server once every feature has been looked at, and shows the reward', async () => {
    const { solvePuzzle } = setup({
      event: 'firepeak-telescope',
      outcome: {
        newItems: [
          {
            itemId: 'journal-lava',
            displayName: 'Lava',
            description: 'Melted rock.',
            category: 'COLLECTIBLE',
            assetId: '',
            setId: 'firepeak-discovery-journal',
            journal: {
              subject: 'EARTH_SCIENCE',
              questId: 'the-volcano-awakens',
              illustrationAssetId: null,
            },
          },
        ],
      },
    });
    const tell = screen.getByRole('button', { name: 'Tell Professor Ember' });
    expect(tell).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Crater' }));
    expect(screen.getByText(/The big bowl at the top/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lava flow' }));
    await userEvent.click(screen.getByRole('button', { name: 'Steam vent' }));
    await userEvent.click(tell);

    expect(solvePuzzle).toHaveBeenCalledWith('firepeak-telescope', {
      observed: ['crater', 'lava-flow', 'steam-vent'],
    });
    expect(
      await screen.findByRole('dialog', { name: 'Look through the telescope' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Lava')).toBeInTheDocument();
    expect(screen.getByText('You found all three!')).toBeInTheDocument();
  });

  it('says so kindly when the server does not agree, and keeps the panel open', async () => {
    setup({
      event: 'firepeak-telescope',
      outcome: { correct: false, feedback: 'TRY_AGAIN', solvedNow: false },
    });
    for (const name of ['Crater', 'Lava flow', 'Steam vent']) {
      await userEvent.click(screen.getByRole('button', { name }));
    }
    await userEvent.click(screen.getByRole('button', { name: 'Tell Professor Ember' }));
    expect(await screen.findByText('Not quite yet. Let us look again!')).toBeInTheDocument();
  });
});

describe('the lava crossing', () => {
  const solvedFirst = ['firepeak-telescope'];

  it('can be built entirely from the panel (keyboard and touch)', async () => {
    const { solvePuzzle } = setup({ solved: solvedFirst, event: 'firepeak-gap-near' });
    const place = async (stone: string, gapIndex: number) => {
      await userEvent.click(screen.getByRole('button', { name: new RegExp(`Pick up: ${stone}`) }));
      await userEvent.click(screen.getAllByRole('button', { name: 'Put it here' })[gapIndex]);
    };
    await place('Small stone', 0);
    await place('Middle stone', 1);
    await place('Long stone', 2);
    expect(screen.getAllByText(/This stone fits!/)).toHaveLength(3);

    await userEvent.click(screen.getByRole('button', { name: 'Check the crossing' }));

    expect(solvePuzzle).toHaveBeenCalledWith('firepeak-crossing', {
      placements: {
        'firepeak-gap-near': 'firepeak-stone-small',
        'firepeak-gap-middle': 'firepeak-stone-middle',
        'firepeak-gap-far': 'firepeak-stone-big',
      },
    });
  });

  it('picks a stone up and snaps it into a gap from the scene, and shows the fit', () => {
    const { open, scene } = setup({ solved: solvedFirst });
    act(() => open('firepeak-stone-middle'));
    expect(scene.puzzles.showArrangement).toHaveBeenLastCalledWith(
      expect.objectContaining({ carried: 'firepeak-stone-middle' }),
    );
    act(() => open('firepeak-gap-middle'));
    expect(scene.puzzles.showArrangement).toHaveBeenLastCalledWith(
      expect.objectContaining({
        carried: null,
        placements: { 'firepeak-gap-middle': 'firepeak-stone-middle' },
        fits: ['firepeak-gap-middle'],
        outlines: true,
      }),
    );
  });

  it('shows a returning child the bridge they built', () => {
    const { scene } = setup({ solved: ['firepeak-telescope', 'firepeak-crossing'] });
    expect(scene.puzzles.showArrangement).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fits: ['firepeak-gap-near', 'firepeak-gap-middle', 'firepeak-gap-far'],
      }),
    );
  });
});

describe('the steam valves', () => {
  const ready = ['firepeak-telescope', 'firepeak-crossing'];

  it('shows cause and effect, and sends the order once the steam reaches the vent', async () => {
    const { solvePuzzle, scene } = setup({ solved: ready, event: 'firepeak-valve-blue' });
    expect(screen.getByText(/Nothing happened/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Turn: Red valve/ }));
    expect(scene.effects.previewSteamCleared).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/The steam is in the Copper pipe/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Blue valve/ }));
    await userEvent.click(screen.getByRole('button', { name: /Turn: Green valve/ }));

    await waitFor(() =>
      expect(solvePuzzle).toHaveBeenCalledWith('firepeak-steam', {
        sequence: [
          'firepeak-valve-blue',
          'firepeak-valve-red',
          'firepeak-valve-blue',
          'firepeak-valve-green',
        ],
      }),
    );
  });

  it('can start the valves again', async () => {
    const { scene } = setup({ solved: ready, event: 'firepeak-valve-red' });
    await userEvent.click(screen.getByRole('button', { name: 'Start the valves again' }));
    expect(scene.puzzles.showValveTurns).toHaveBeenLastCalledWith([]);
    expect(scene.effects.previewSteamCleared).toHaveBeenLastCalledWith(false);
  });

  it('is not playable before the crossing, and says why', () => {
    const { solvePuzzle, showToast } = setup({ event: 'firepeak-valve-red' });
    expect(showToast).toHaveBeenCalledWith('Finish the part before this one first.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(solvePuzzle).not.toHaveBeenCalled();
  });
});

describe('the crystal and the way back', () => {
  const ready = ['firepeak-telescope', 'firepeak-crossing', 'firepeak-steam'];

  it('plays the discovery only after the server confirms it, then shows what was found', async () => {
    const { solvePuzzle, scene } = setup({ solved: ready, event: 'firepeak-crystal' });
    await userEvent.click(screen.getByRole('button', { name: 'Pick up the glowing crystal' }));
    expect(solvePuzzle).toHaveBeenCalledWith('firepeak-heart-crystal', {});
    await waitFor(() => expect(scene.puzzles.discover).toHaveBeenCalledWith('firepeak-crystal'));
    expect(
      await screen.findByRole('dialog', { name: 'You found the first Heart Crystal fragment!' }),
    ).toBeInTheDocument();
  });

  it('hides a crystal already found', () => {
    const { scene } = setup({ solved: [...ready, 'firepeak-heart-crystal'] });
    expect(scene.puzzles.setVisible).toHaveBeenCalledWith('firepeak-crystal', false);
  });

  it('says the rope lift is not ready before the crystal is found', () => {
    const { props, showToast, view } = setup({ solved: ready });
    view.rerender(
      <AreaPuzzleLayer
        {...props}
        event={{ kind: 'return', entityId: 'firepeak-return-lift', label: 'Rope lift' }}
      />,
    );
    expect(showToast).toHaveBeenCalledWith(
      'The rope lift is not ready yet. Explore the cavern first!',
    );
  });
});

describe('the lava', () => {
  it('says the child was brought back to safety, with a short flash', () => {
    const { listeners, showToast, view } = setup();
    act(() =>
      listeners.forEach((l) =>
        l.respawned?.({
          id: 'near-bank',
          label: 'the lava river',
          x: 0,
          z: 13,
          yaw: 0,
          whenChangeKey: null,
        }),
      ),
    );
    expect(showToast).toHaveBeenCalledWith('Whoa, the lava is too hot! Back to safety.');
    expect(view.container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('keeps the scene in step with the server’s world changes only', () => {
    const { scene } = setup({ solved: ['firepeak-telescope'] });
    expect(scene.effects.setChangeKeys).toHaveBeenCalledWith(['FIREPEAK_FEATURES_OBSERVED']);
  });
});
