import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  IDLE_SNAPSHOT,
  type MultiplayerClient,
  type MultiplayerSnapshot,
} from '../../../../multiplayer/multiplayerClient';
import { MultiplayerPresencePanel } from './MultiplayerPresencePanel';

/** A client whose snapshot the test drives by hand. */
function controllableClient() {
  let snapshot: MultiplayerSnapshot = IDLE_SNAPSHOT;
  const listeners = new Set<() => void>();
  const client: MultiplayerClient & { set(next: Partial<MultiplayerSnapshot>): void } = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    join: vi.fn(async () => {
      client.set({ status: 'CONNECTING' });
    }),
    leave: vi.fn(async () => undefined),
    set(next) {
      snapshot = { ...snapshot, ...next };
      listeners.forEach((listener) => listener());
    },
  };
  return client;
}

describe('MultiplayerPresencePanel', () => {
  it('renders nothing and connects to nothing when multiplayer is off', () => {
    const { container } = render(
      <MultiplayerPresencePanel regionId="welcome-harbor" childId="child-a" createClient={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('joins on mount, lists the family, and leaves on unmount', async () => {
    const client = controllableClient();
    const createClient = () => client;
    const { unmount } = render(
      <MultiplayerPresencePanel
        regionId="welcome-harbor"
        childId="child-a"
        createClient={createClient}
      />,
    );
    expect(client.join).toHaveBeenCalledWith('welcome-harbor', 'child-a');
    expect(await screen.findByRole('status')).toHaveTextContent('Looking for your family');

    act(() =>
      client.set({
        status: 'CONNECTED',
        selfPlayerId: 'p1',
        players: [
          { playerId: 'p1', avatarKey: 'FOX', slot: 0, status: 'HERE' },
          { playerId: 'p2', avatarKey: 'OWL', slot: 1, status: 'RECONNECTING' },
        ],
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('2 explorers are here.');
    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual([
      expect.stringContaining('You'),
      expect.stringContaining('Owl explorer, coming back'),
    ]);

    unmount();
    expect(client.leave).toHaveBeenCalled();
  });

  it('says when the child is alone', async () => {
    const client = controllableClient();
    render(<MultiplayerPresencePanel regionId="r" childId="c" createClient={() => client} />);
    act(() =>
      client.set({
        status: 'CONNECTED',
        selfPlayerId: 'p1',
        players: [{ playerId: 'p1', avatarKey: 'FOX', slot: 0, status: 'HERE' }],
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'You are the only explorer here right now.',
    );
  });

  it('offers a calm retry after a failure, with no error jargon', async () => {
    const client = controllableClient();
    render(<MultiplayerPresencePanel regionId="r" childId="c" createClient={() => client} />);
    act(() => client.set({ status: 'FAILED', failure: 'UNAVAILABLE' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'You are exploring on your own for now.',
    );
    expect(screen.getByRole('status').textContent).not.toMatch(/error|fail|unavailable/i);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(client.join).toHaveBeenCalledTimes(2);
  });

  it('explains a seat taken by another screen', async () => {
    const client = controllableClient();
    render(<MultiplayerPresencePanel regionId="r" childId="c" createClient={() => client} />);
    act(() => client.set({ status: 'DISCONNECTED', failure: 'REPLACED' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'You are exploring from another screen now.',
    );
  });
});
