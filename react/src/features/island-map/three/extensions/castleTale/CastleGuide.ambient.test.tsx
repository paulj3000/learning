import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../api/errors';
import { CastleGuide } from './CastleGuide';
import type { CastleTaleSceneApi } from './castleTaleScene';

const scene = (room: string | undefined) =>
  ({ currentRoomId: () => room, goToRoom: vi.fn() }) as unknown as CastleTaleSceneApi;
const world = { worldChangeKeys: [], ownedItemIds: [], discoveryIds: [] };

describe('the castle guide ambient line (SC-R09-01)', () => {
  it('shows the line the Director chose, as quiet text with no prompt', async () => {
    const choose = vi.fn().mockResolvedValue({
      eventId: 'quill-hums-in-hall',
      source: 'AI',
      lines: ['Keeper Quill hums a happy tune.'],
      npcId: 'keeper-quill',
      visual: { kind: 'quill-scratch' },
    });
    render(
      <CastleGuide
        scene={scene('story-hall')}
        worldState={world}
        childId="child-1"
        roomsApi={null}
        ageBand="PATHFINDER"
        directorApi={{ choose }}
        pollMs={20}
      />,
    );
    expect(await screen.findByTestId('castle-ambient-line')).toHaveTextContent(
      'Keeper Quill hums a happy tune.',
    );
    expect(screen.queryByRole('button', { name: /come back|tomorrow|claim/i })).toBeNull();
  });

  it('shows the room quiet line (castleDefaultLines) when the Director fails', async () => {
    const choose = vi.fn().mockRejectedValue(new ApiError('network', {}));
    render(
      <CastleGuide
        scene={scene('great-library')}
        worldState={world}
        childId="child-1"
        roomsApi={null}
        ageBand="SPROUT"
        directorApi={{ choose }}
        pollMs={20}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('castle-ambient-line')).toHaveTextContent('The books rest on the shelves.'),
    );
  });

  it('shows nothing ambient without an age band', async () => {
    const choose = vi.fn();
    render(
      <CastleGuide
        scene={scene('story-hall')}
        worldState={world}
        childId="child-1"
        roomsApi={null}
        directorApi={{ choose }}
        pollMs={20}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(screen.queryByTestId('castle-ambient-line')).toBeNull();
    expect(choose).not.toHaveBeenCalled();
  });

  it("captions Quill's AI flavour line and keeps it silent (no speech for AI ambient text)", async () => {
    const choose = vi.fn().mockResolvedValue({
      eventId: 'quill-hums-in-hall',
      source: 'FALLBACK',
      lines: ['Keeper Quill hums a happy tune.'],
      npcId: 'keeper-quill',
      visual: { kind: 'quill-scratch' },
    });
    const flavour = vi.fn().mockResolvedValue({
      eventId: 'quill-hums-in-hall',
      line: 'Keeper Quill hums while the shelves settle.',
      source: 'AI',
    });
    const speak = vi.fn();
    const { setSpeechBinding } = await import('../../../../../audio/speech/speechBinding');
    setSpeechBinding({ speakTurn: speak, speakNpcNode: speak, stop: vi.fn() } as never);
    render(
      <CastleGuide
        scene={scene('story-hall')}
        worldState={world}
        childId="child-1"
        roomsApi={null}
        ageBand="PATHFINDER"
        directorApi={{ choose, flavour }}
        pollMs={20}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('castle-ambient-line')).toHaveTextContent(
        'Keeper Quill hums while the shelves settle.',
      ),
    );
    expect(speak).not.toHaveBeenCalled();
    setSpeechBinding(null);
  });
});
