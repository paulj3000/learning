import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { WorldInteractionContext } from '../../../worldObjects';
import {
  CASTLE_DOORS,
  discoveryState,
  doorLabel,
  getCastleRoom,
  otherSide,
  planTravel,
  visibleCastleRooms,
  type CastleDoor,
  type CastleRoomId,
} from '../../castleLayout';
import { trophyDisplay } from '../../castleTrophies';
import type { CastleRoomsApi } from '../../../../../api/play/castleRoomsApi';
import type { CastleDirectorApi } from '../../../../../api/play/castleDirectorApi';
import type { AgeBandValue } from '../../../../child-profile/constants';
import { useCastleDirector } from '../../../../great-storybook/useCastleDirector';
import type { GreatStorybook } from '../../../../great-storybook/useGreatStorybook';
import { ManagerAudioControls } from '../../../../../audio/ui';
import { CastleMap } from './CastleMap';
import { StorybookSection } from './StorybookSection';
import { HallOfHeroesSection } from './HallOfHeroesSection';
import { hallOfHeroes } from '../../../../great-storybook/hallOfHeroes';
import { CASTLE_RANKS, type CastleRanksConfig } from '../../../../great-storybook/castleRanks';
import { useCastleDiscovery } from './useCastleDiscovery';
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
  /** The child, for saving which rooms they have explored. Without it nothing is saved. */
  childId?: string;
  /** Where discoveries are saved. Omit for the configured Django API; pass `null` for none. */
  roomsApi?: CastleRoomsApi | null;
  /** The child's Great Storybook (SC-R04-02), if the castle has computed it. */
  storybook?: GreatStorybook;
  /**
   * SC-R06-01: the guide (and the Storybook in it) opened or closed by the child. Called on a
   * change only, never on the first render. For sound; the guide works the same without it.
   */
  onOpenChange?: (open: boolean) => void;
  /** Rank titles (SC-R07-04). Defaults to the content config, which is switched off. */
  ranks?: CastleRanksConfig;
  /**
   * The child's age band (SC-R09-01). With it, the guide shows one authored ambient line for the
   * room the child is in; without it, nothing ambient is shown.
   */
  ageBand?: AgeBandValue;
  /** Where the ambient line is chosen. Omit for the configured Django API; `null` for none. */
  directorApi?: CastleDirectorApi | null;
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
  childId = '',
  roomsApi,
  storybook,
  onOpenChange,
  ranks = CASTLE_RANKS,
  ageBand,
  directorApi,
}: CastleGuideProps) {
  const [open, setOpen] = useState(false);
  const [roomId, setRoomId] = useState<CastleRoomId | undefined>(undefined);
  const [message, setMessage] = useState('');
  const panelId = useId();
  // Explored rooms: saved by the server, merged with this visit. Django is the record.
  const { discovered } = useCastleDiscovery({ childId, roomId, api: childId ? roomsApi : null });
  const discovery = useMemo(() => discoveryState(discovered), [discovered]);
  // One authored ambient line for this room (SC-R09-01): atmosphere, never progress or a prompt.
  const ambient = useCastleDirector({
    childId,
    ageBand,
    roomId,
    api: childId ? directorApi : null,
  });
  const lastAnnounced = useRef<CastleRoomId | undefined>(undefined);

  // Report a change of open (not the first render), for the Storybook's open and close sounds.
  const reportedOpen = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => {
    if (reportedOpen.current === open) return;
    reportedOpen.current = open;
    onOpenChangeRef.current?.(open);
  }, [open]);

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
  // The Hall of Heroes (SC-R07-03): derived from the same records, read-only.
  const hall = useMemo(
    () =>
      hallOfHeroes({
        progress: storybook?.progress,
        ownedItemIds: worldState.ownedItemIds ?? [],
        worldChangeKeys: worldState.worldChangeKeys,
        ranks,
      }),
    [storybook?.progress, worldState.ownedItemIds, worldState.worldChangeKeys, ranks],
  );
  const shownTreasures = treasures.filter((entry) => entry.state !== 'open');
  const openPedestals = treasures.length - shownTreasures.length;

  const plans = useMemo(
    () =>
      // Only rooms a child may know about: a secret not yet found is not offered, not even greyed out.
      visibleCastleRooms(worldState).map((room) => ({
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
      {ambient ? (
        <p className={styles.ambient} data-testid="castle-ambient-line">
          {ambient.lines.join(' ')}
        </p>
      ) : null}
      {open ? (
        <div className={styles.panel} id={panelId}>
          <h2 className={styles.title}>Where would you like to go?</h2>
          <p className={styles.where}>
            {current ? `You are in ${current.label}.` : 'You are in the castle.'}
          </p>
          {storybook ? (
            <StorybookSection
              storybook={storybook}
              access={(page) => {
                const plan = plans.find((entry) => entry.room.id === page)?.plan;
                if (plan?.ok) return 'ok';
                return !plan?.ok && plan?.reason === 'already-there' ? 'here' : 'no';
              }}
              onGo={go}
              ranks={ranks}
            />
          ) : null}
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
          <CastleMap
            rooms={plans.map((entry) => entry.room)}
            currentRoomId={roomId}
            discovery={discovery}
            access={(room) => {
              const plan = plans.find((entry) => entry.room.id === room.id)?.plan;
              return !plan || plan.ok
                ? { ok: true }
                : {
                    ok: false,
                    reason:
                      plan.reason === 'locked'
                        ? 'locked'
                        : plan.reason === 'already-there'
                          ? 'already-there'
                          : 'blocked',
                    message: plan.message,
                  };
            }}
            onGo={go}
          />
          <ul className={styles.list}>
            {plans.map(({ room, plan }) => {
              const here = !plan.ok && plan.reason === 'already-there';
              const locked = !plan.ok && plan.reason === 'locked';
              const explored = discovery[room.id] === 'discovered';
              const walking = plan.ok
                ? `Walking: ${routeInWords(plan.route, roomId ?? 'entry-hall')}`
                : locked
                  ? plan.message
                  : room.destination;
              // Say it in words too: the map's dashed outline and question mark are not the only cue.
              const note = plan.ok && !explored ? `Not explored yet. ${walking}` : walking;
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
          <HallOfHeroesSection hall={hall} />
          {/* SC-R06-02: the child's own sound mix (volume, mute, calmer sound), saved for them. */}
          <section aria-labelledby={`${panelId}-sound`}>
            <h3 id={`${panelId}-sound`} className={styles.title}>
              Sound
            </h3>
            <ManagerAudioControls idPrefix="castle-audio" />
          </section>
        </div>
      ) : null}
    </section>
  );
}
