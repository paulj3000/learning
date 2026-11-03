import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldInteractionContext } from '../../../worldObjects';
import {
  CASTLE_DOORS,
  CASTLE_ROOMS,
  SECRET_PASSAGE_DISCOVERY_ID,
  visibleCastleRooms,
  getCastleRoom,
  planTravel,
  type CastleDoor,
  type CastleRoomId,
} from '../../castleLayout';
import { OPEN_PEDESTAL_TEXT, trophyDisplay } from '../../castleTrophies';
import { CastleGuide } from './CastleGuide';
import type { CastleTaleSceneApi } from './castleTaleScene';

/**
 * The guide is HUD only: it owns no rules. These tests use a fake scene so
 * they prove what the guide does with the castle's answers (shows them,
 * speaks them, never goes around them), not the answers themselves, which
 * `castleLayout.test.ts` covers.
 */

const NOTHING: WorldInteractionContext = {
  worldChangeKeys: [],
  ownedItemIds: [],
  discoveryIds: [],
};

interface FakeScene {
  api: CastleTaleSceneApi;
  setRoom(id: CastleRoomId | undefined): void;
  goToRoom: ReturnType<typeof vi.fn>;
}

/** A scene whose `goToRoom` follows the real planner, so a refusal is the castle's own refusal. */
function fakeScene(
  start: CastleRoomId | undefined,
  doors: readonly CastleDoor[] = CASTLE_DOORS,
): FakeScene {
  let room = start;
  const goToRoom = vi.fn((target: string, world: WorldInteractionContext) => {
    const plan = planTravel(room, target, world, doors);
    if (plan.ok) room = plan.room.id;
    return plan;
  });
  return {
    api: { currentRoomId: () => room, goToRoom } as unknown as CastleTaleSceneApi,
    setRoom: (id) => {
      room = id;
    },
    goToRoom,
  };
}

const open = () => fireEvent.click(screen.getByRole('button', { name: /open the castle guide/i }));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('CastleGuide', () => {
  it('renders nothing until the scene exists', () => {
    const { container } = render(<CastleGuide scene={null} worldState={NOTHING} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('starts collapsed, and opens and closes with a button that says which it is', () => {
    const scene = fakeScene('story-hall');
    render(<CastleGuide scene={scene.api} worldState={NOTHING} />);
    const toggle = screen.getByRole('button', { name: /open the castle guide/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('heading', { name: /where would you like to go/i })).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /hide the castle guide/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(
      screen.getByRole('heading', { name: /where would you like to go/i }),
    ).toBeInTheDocument();
  });

  it('closes on Escape, and only listens while it is open', () => {
    render(<CastleGuide scene={fakeScene('story-hall').api} worldState={NOTHING} />);
    open();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('heading', { name: /where would you like to go/i })).toBeNull();
  });

  it('offers every room as a real button, and marks the room you are in as not a destination', () => {
    render(<CastleGuide scene={fakeScene('story-hall').api} worldState={NOTHING} />);
    open();
    expect(screen.getByText('You are in the story hall.')).toBeInTheDocument();
    for (const room of visibleCastleRooms(NOTHING)) {
      const name = room.id === 'story-hall' ? `You are here: ${room.label}` : `Go to ${room.label}`;
      const button = screen.getByRole('button', { name: new RegExp(name, 'i') });
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveProperty('disabled', room.id === 'story-hall');
    }
  });

  it('describes the walk in words, door by door, from where the child is', () => {
    render(<CastleGuide scene={fakeScene('entry-hall').api} worldState={NOTHING} />);
    open();
    const library = screen.getByRole('button', { name: /go to the great library/i });
    expect(
      within(library).getByText(
        /walking: to the story hall, then to the east corridor, then to the great library/i,
      ),
    ).toBeInTheDocument();
  });

  it('takes the child to the room they pick, and says so', () => {
    const scene = fakeScene('entry-hall');
    render(<CastleGuide scene={scene.api} worldState={NOTHING} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: /go to the setting tower/i }));
    expect(scene.goToRoom).toHaveBeenCalledWith('setting-tower', NOTHING);
    expect(screen.getByRole('status')).toHaveTextContent('You walked to the Setting Tower.');
    expect(screen.getByText('You are in the Setting Tower.')).toBeInTheDocument();
  });

  it('always offers a way back to the hub away from it, and not in it', () => {
    const scene = fakeScene('great-library');
    render(<CastleGuide scene={scene.api} worldState={NOTHING} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: /back to the story hall/i }));
    expect(scene.goToRoom).toHaveBeenCalledWith('story-hall', NOTHING);
    expect(screen.queryByRole('button', { name: /back to the story hall/i })).toBeNull();
  });

  it('shows a locked path as disabled with its own hint, and never asks the scene to go there', () => {
    const locked: CastleDoor[] = CASTLE_DOORS.map((door) =>
      door.id === 'arch-corridor'
        ? {
            ...door,
            lock: {
              requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'A_KEY_TURNED' }],
              hint: 'The way east is shut for now.',
            },
          }
        : door,
    );
    const scene = fakeScene('story-hall', locked);
    render(<CastleGuide scene={scene.api} worldState={NOTHING} doors={locked} />);
    open();
    const library = screen.getByRole('button', { name: /go to the great library/i });
    expect(library).toBeDisabled();
    expect(within(library).getByText('The way east is shut for now.')).toBeInTheDocument();
    fireEvent.click(library);
    expect(scene.goToRoom).not.toHaveBeenCalled();
    // A room that does not need that door is still open.
    expect(screen.getByRole('button', { name: /go to the character gallery/i })).toBeEnabled();
  });

  it('says why when the castle refuses, in the castle words', () => {
    const scene = fakeScene('entry-hall');
    scene.goToRoom.mockReturnValueOnce({
      ok: false,
      reason: 'blocked',
      message: 'You cannot get there yet.',
    });
    render(<CastleGuide scene={scene.api} worldState={NOTHING} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: /go to the costume room/i }));
    expect(screen.getByRole('status')).toHaveTextContent('You cannot get there yet.');
  });

  it('announces a room the child walked into, but not the first read', () => {
    const scene = fakeScene('entry-hall');
    render(<CastleGuide scene={scene.api} worldState={NOTHING} pollMs={100} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
    scene.setRoom('story-hall');
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByRole('status')).toHaveTextContent('You are in the story hall.');
  });

  it('stops polling when it unmounts', () => {
    const scene = fakeScene('entry-hall');
    const spy = vi.spyOn(scene.api, 'currentRoomId');
    const { unmount } = render(<CastleGuide scene={scene.api} worldState={NOTHING} pollMs={100} />);
    unmount();
    const calls = spy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(spy.mock.calls.length).toBe(calls);
  });

  it('uses no em dash anywhere a child could read', () => {
    render(<CastleGuide scene={fakeScene('entry-hall').api} worldState={NOTHING} />);
    open();
    expect(document.body.textContent ?? '').not.toMatch(/—|–/);
  });

  it('lists the destinations from the canonical layout, so it can never drift from the map', () => {
    render(<CastleGuide scene={fakeScene('entry-hall').api} worldState={NOTHING} />);
    open();
    // The first list is the rooms; the treasures are a second, separate list.
    expect(within(screen.getAllByRole('list')[0]).getAllByRole('listitem')).toHaveLength(
      visibleCastleRooms(NOTHING).length,
    );
    expect(getCastleRoom('great-library')?.label).toBe('the Great Library');
  });

  describe('your treasures (the Trophy Room as text)', () => {
    const owning = (...ids: string[]): WorldInteractionContext => ({
      ...NOTHING,
      ownedItemIds: ids,
    });

    it('lists each castle treasure, empty and waiting for a child who owns nothing', () => {
      render(<CastleGuide scene={fakeScene('story-hall').api} worldState={NOTHING} />);
      open();
      const list = screen.getByRole('region', { name: /your treasures/i });
      for (const entry of trophyDisplay([]).filter((e) => e.state === 'waiting')) {
        expect(within(list).getByText(entry.text)).toBeInTheDocument();
      }
    });

    it('shows an owned treasure by name with its words, from the same display the room uses', () => {
      render(
        <CastleGuide
          scene={fakeScene('story-hall').api}
          worldState={owning('storykeepers-quill')}
        />,
      );
      open();
      const owned = trophyDisplay(['storykeepers-quill']).find((e) => e.state === 'on-display')!;
      expect(screen.getByText(owned.text)).toBeInTheDocument();
      expect(owned.text).toContain("Storykeeper's Quill");
    });

    it('says how many pedestals are still open, once, not as four identical lines', () => {
      render(<CastleGuide scene={fakeScene('story-hall').api} worldState={NOTHING} />);
      open();
      const open4 = trophyDisplay([]).filter((e) => e.state === 'open').length;
      expect(
        screen.getByText(new RegExp(`${open4} more pedestals in the Trophy Room are waiting`)),
      ).toBeInTheDocument();
      expect(screen.queryAllByText(OPEN_PEDESTAL_TEXT)).toHaveLength(0);
    });

    it('still opens when the inventory has not loaded, and shows every pedestal empty', () => {
      const unloaded = {
        worldChangeKeys: [],
        discoveryIds: [],
      } as unknown as WorldInteractionContext;
      render(<CastleGuide scene={fakeScene('story-hall').api} worldState={unloaded} />);
      open();
      expect(screen.getByRole('region', { name: /your treasures/i })).toBeInTheDocument();
      expect(screen.queryByText(/a feather pen from keeper quill/i)).toBeNull();
    });

    it('updates as soon as the child owns something, with no reload', () => {
      const scene = fakeScene('story-hall');
      const { rerender } = render(<CastleGuide scene={scene.api} worldState={NOTHING} />);
      open();
      expect(screen.queryByText(/a feather pen from keeper quill/i)).toBeNull();
      rerender(<CastleGuide scene={scene.api} worldState={owning('storykeepers-quill')} />);
      expect(screen.getByText(/a feather pen from keeper quill/i)).toBeInTheDocument();
    });
  });

  describe('the secret chamber (SC-R03-05)', () => {
    const FOUND: WorldInteractionContext = {
      ...NOTHING,
      discoveryIds: [SECRET_PASSAGE_DISCOVERY_ID],
    };

    it('is not offered, not even greyed out, and not named anywhere, until the nook is found', () => {
      render(<CastleGuide scene={fakeScene('story-hall').api} worldState={NOTHING} />);
      open();
      expect(screen.queryByRole('button', { name: /secret chamber/i })).toBeNull();
      expect(document.body.textContent ?? '').not.toMatch(/secret chamber|crystal|hidden/i);
      expect(CASTLE_ROOMS.some((room) => room.id === 'secret-chamber')).toBe(true);
    });

    it('is offered once the nook is found, with the walk through the passage in words', () => {
      render(<CastleGuide scene={fakeScene('story-hall').api} worldState={FOUND} />);
      open();
      const chamber = screen.getByRole('button', { name: /go to the secret chamber/i });
      expect(chamber).toBeEnabled();
      expect(within(chamber).getByText(/walking: to the secret chamber/i)).toBeInTheDocument();
    });

    it('appears the moment the nook is found, without reopening the guide', () => {
      const scene = fakeScene('story-hall');
      const { rerender } = render(<CastleGuide scene={scene.api} worldState={NOTHING} />);
      open();
      expect(screen.queryByRole('button', { name: /secret chamber/i })).toBeNull();
      rerender(<CastleGuide scene={scene.api} worldState={FOUND} />);
      expect(screen.getByRole('button', { name: /go to the secret chamber/i })).toBeInTheDocument();
    });
  });
});
