import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { WorldInteractionContext } from '../../../worldObjects';
import {
  CASTLE_DOORS,
  CASTLE_ROOMS,
  doorLabel,
  getCastleRoom,
  otherSide,
  planTravel,
  type CastleDoor,
  type CastleRoomId,
} from '../../castleLayout';
import { trophyDisplay } from '../../castleTrophies';
import type { CastleTaleSceneApi } from './castleTaleScene';
import styles from './CastleGuide.module.css';

/**
 * The castle guide (SC-R03-02): the accessible equivalent of walking. A
 * child who cannot comfortably steer in first person, or who is three and
 * wants to see the library now, can pick a room and be taken there. It is
 * never the only way: walking still works and nothing here is required.
 *
 * It owns no rules. Where a child may go, what is locked, and what to say
 * when they may not are the castle layout's (`planTravel`), and whether the
 * ground is standable is the runtime's (`placeChild`). This is only the
 * HUD: real buttons, a live region that says where the child is, a walking
 * route in words, and a way back to the hub that is always one press away.
 */

const HUB_ID: CastleRoomId = 'story-hall';
const POLL_MS = 400;

export interface CastleGuideProps {
  scene: CastleTaleSceneApi | null;
  worldState: WorldInteractionContext;
  /** The castle's doors. Defaults to the canonical layout; a test or a future lock can pass its own. */
  doors?: readonly CastleDoor[];
  /** How often the room the child stands in is re-read, in milliseconds. */
  pollMs?: number;
}

/** "To the story hall, then To the east corridor": the doors a walking child would pass, in order. */
function routeInWords(route: readonly CastleDoor[], from: CastleRoomId): string {
  const steps: string[] = [];
  let here = from;
  for (const door of route) {
    steps.push(doorLabel(door, here));
    here = otherSide(door, here);
  }
  return steps.join(', then ');
}

export function CastleGuide({
  scene,
  worldState,
  doors = CASTLE_DOORS,
  pollMs = POLL_MS,
}: CastleGuideProps) {
  const [open, setOpen] = useState(false);
  const [roomId, setRoomId] = useState<CastleRoomId | undefined>(undefined);
  const [message, setMessage] = useState('');
  const panelId = useId();
  const lastAnnounced = useRef<CastleRoomId | undefined>(undefined);

  // Escape closes the guide, only while it is open, so it never steals the key from anything else.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Where the child is, read often and cheaply, so the guide never describes a room they have left.
  useEffect(() => {
    if (!scene) return;
    const read = () => setRoomId(scene.currentRoomId());
    read();
    const timer = setInterval(read, pollMs);
    return () => clearInterval(timer);
  }, [scene, pollMs]);

  // Room-entry feedback, in words, once per change. Not on first read: that is not an arrival.
  useEffect(() => {
    if (!roomId) return;
    if (lastAnnounced.current !== undefined && lastAnnounced.current !== roomId) {
      setMessage(`You are in ${getCastleRoom(roomId)?.label ?? 'a room'}.`);
    }
    lastAnnounced.current = roomId;
  }, [roomId]);

  const go = useCallback(
    (target: CastleRoomId) => {
      if (!scene) return;
      const result = scene.goToRoom(target, worldState);
      if (result.ok) {
        setRoomId(result.room.id);
        lastAnnounced.current = result.room.id;
        setMessage(`You walked to ${result.room.label}.`);
      } else {
        setMessage(result.message);
      }
    },
    [scene, worldState],
  );

  // The Trophy Room's treasures as text: the accessible equivalent of looking at the pedestals.
  const treasures = useMemo(
    // An inventory that has not loaded is an empty one: the guide still opens.
    () => trophyDisplay(worldState.ownedItemIds ?? []),
    [worldState.ownedItemIds],
  );
  const shownTreasures = treasures.filter((entry) => entry.state !== 'open');
  const openPedestals = treasures.length - shownTreasures.length;

  const plans = useMemo(
    () =>
      CASTLE_ROOMS.map((room) => ({
        room,
        plan: planTravel(roomId, room.id, worldState, doors),
      })),
    [roomId, worldState, doors],
  );

  if (!scene) return null;
  const current = roomId ? getCastleRoom(roomId) : undefined;
  const hubPlan = plans.find((entry) => entry.room.id === HUB_ID)?.plan;
  const showBackToHub = roomId !== HUB_ID && hubPlan?.ok === true;

  return (
    <section className={styles.guide} aria-label="Castle guide">
      <button
        type="button"
        className={`${styles.button} ${styles.primary}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide the castle guide' : 'Open the castle guide'}
      </button>
      <output className={styles.status} aria-live="polite">
        {message}
      </output>
      {open ? (
        <div className={styles.panel} id={panelId}>
          <h2 className={styles.title}>Where would you like to go?</h2>
          <p className={styles.where}>
            {current ? `You are in ${current.label}.` : 'You are in the castle.'}
          </p>
          {showBackToHub ? (
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={() => go(HUB_ID)}
            >
              Back to the story hall
              <span className={styles.note}>Keeper Quill is waiting there.</span>
            </button>
          ) : null}
          <ul className={styles.list}>
            {plans.map(({ room, plan }) => {
              const here = !plan.ok && plan.reason === 'already-there';
              const locked = !plan.ok && plan.reason === 'locked';
              const note = plan.ok
                ? `Walking: ${routeInWords(plan.route, roomId ?? 'entry-hall')}`
                : locked
                  ? plan.message
                  : room.destination;
              const noteId = `${panelId}-${room.id}`;
              return (
                <li key={room.id}>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={!plan.ok}
                    aria-describedby={noteId}
                    onClick={() => go(room.id)}
                  >
                    {here ? `You are here: ${room.label}` : `Go to ${room.label}`}
                    <span id={noteId} className={styles.note}>
                      {here ? room.destination : note}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <section aria-labelledby={`${panelId}-treasures`}>
            <h3 id={`${panelId}-treasures`} className={styles.title}>
              Your treasures
            </h3>
            <ul className={styles.list}>
              {shownTreasures.map((entry) => (
                <li key={entry.slot.id}>{entry.text}</li>
              ))}
            </ul>
            {openPedestals > 0 ? (
              <p>
                {openPedestals} more pedestals in the Trophy Room are waiting for treasures you will
                earn.
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}
