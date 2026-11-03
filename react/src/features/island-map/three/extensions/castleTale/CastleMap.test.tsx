import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CASTLE_ROOMS,
  discoveryState,
  visibleCastleRooms,
  type CastleRoomId,
} from '../../castleLayout';
import type { WorldInteractionContext } from '../../../worldObjects';
import { CastleMap, type CastleAccess } from './CastleMap';

const NOTHING: WorldInteractionContext = {
  worldChangeKeys: [],
  ownedItemIds: [],
  discoveryIds: [],
};
const FOUND = { ...NOTHING, discoveryIds: ['castle-tapestry-stair'] };

const open: CastleAccess = { ok: true };

function setup(
  options: {
    current?: CastleRoomId;
    discovered?: string[];
    world?: WorldInteractionContext;
    access?: (id: string) => CastleAccess;
  } = {},
) {
  const onGo = vi.fn();
  const view = render(
    <CastleMap
      rooms={visibleCastleRooms(options.world ?? NOTHING)}
      currentRoomId={options.current ?? 'story-hall'}
      discovery={discoveryState(new Set(options.discovered ?? []))}
      access={(room) =>
        room.id === (options.current ?? 'story-hall')
          ? { ok: false, reason: 'already-there', message: 'You are already here.' }
          : (options.access?.(room.id) ?? open)
      }
      onGo={onGo}
    />,
  );
  return { onGo, ...view };
}

describe('CastleMap', () => {
  it('is one group named for what it is, with a button for every visible room', () => {
    setup();
    expect(screen.getByRole('group', { name: 'Castle map' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(visibleCastleRooms(NOTHING).length);
  });

  it('marks where the child is with aria-current, and says so in words', () => {
    setup({ current: 'great-library' });
    const here = screen.getByRole('button', { name: /the Great Library\. You are here\./ });
    expect(here).toHaveAttribute('aria-current', 'location');
    expect(
      screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-current')),
    ).toHaveLength(1);
  });

  it('says explored or not explored for every other room, never by colour alone', () => {
    setup({ current: 'story-hall', discovered: ['entry-hall', 'story-hall'] });
    expect(screen.getByRole('button', { name: /the entry hall\. Explored\./ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /the Great Library\. Not explored yet\./ }),
    ).toBeInTheDocument();
  });

  it('draws a question mark on an unexplored room and none on an explored one', () => {
    setup({ current: 'story-hall', discovered: ['entry-hall', 'story-hall'] });
    const entry = screen.getByRole('button', { name: /the entry hall/ });
    const library = screen.getByRole('button', { name: /the Great Library/ });
    expect(library.textContent).toBe('?');
    expect(entry.textContent).toBe('');
  });

  it('takes the child to a room on a press, and does nothing for the room they are in', () => {
    const { onGo } = setup({ current: 'story-hall' });
    fireEvent.click(screen.getByRole('button', { name: /the Setting Tower/ }));
    expect(onGo).toHaveBeenCalledWith('setting-tower');
    fireEvent.click(screen.getByRole('button', { name: /the story hall\. You are here/ }));
    expect(onGo).toHaveBeenCalledTimes(1);
  });

  it('shows a room the child cannot go to as disabled, with the reason in its name', () => {
    const { onGo } = setup({
      access: (id) =>
        id === 'trophy-room'
          ? { ok: false, reason: 'locked', message: 'That way is shut for now.' }
          : open,
    });
    const trophy = screen.getByRole('button', {
      name: /the Trophy Room\. That way is shut for now\./,
    });
    expect(trophy).toBeDisabled();
    fireEvent.click(trophy);
    expect(onGo).not.toHaveBeenCalled();
  });

  it('does not draw the secret chamber until it is visible', () => {
    setup({ world: NOTHING });
    expect(screen.queryByRole('button', { name: /secret chamber/i })).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/secret chamber/i);
  });

  it('draws the secret chamber once the nook is found, as an unexplored room', () => {
    setup({ world: FOUND });
    expect(
      screen.getByRole('button', { name: /the Secret Chamber\. Not explored yet\./ }),
    ).toBeInTheDocument();
  });

  it('explains the symbols in a sentence, so the picture is never the only explanation', () => {
    setup();
    expect(screen.getByText(/the dot is where you are/i)).toBeInTheDocument();
  });

  it('uses real buttons only and no em dash', () => {
    setup();
    for (const button of screen.getAllByRole('button')) expect(button.tagName).toBe('BUTTON');
    expect(document.body.textContent ?? '').not.toMatch(/—|–/);
    expect(CASTLE_ROOMS.length).toBeGreaterThan(0);
  });
});
