import { type CastleDiscovery, type CastleRoomId, type CastleRoomNode } from '../../castleLayout';
import { MAP_DEPTH_METERS, MAP_WIDTH_METERS, tileBox } from './castleMapGeometry';
import styles from './CastleGuide.module.css';

/**
 * The castle map (SC-R03-06): a picture of the castle with the child's place
 * on it, what they have explored and what they have not, and a button on every
 * room they can go to. It is built from the canonical layout (`castleLayout.ts`),
 * so a tile is exactly where its room's floor is and can never drift from it,
 * and it owns no rules: whether a room can be gone to is the planner's answer,
 * passed in.
 *
 * Every tile is a real `<button>`, so it works by keyboard and by touch, and
 * its accessible name says the room and the state in words. The glyphs are
 * decoration; the legend and the names carry the meaning, so nothing depends on
 * colour or on being able to read. A secret room is not drawn until it is
 * visible: the caller passes only the rooms a child may know about.
 *
 * Narrow rooms (the east corridor is 2 m of a 32 m castle) make small tiles.
 * The room list beside the map is the full-size equivalent, so the map is a
 * picture first and a control second.
 */

/** Why a room cannot be gone to, in a form the map can show. */
export type CastleAccess =
  { ok: true } | { ok: false; reason: 'already-there' | 'locked' | 'blocked'; message: string };

export interface CastleMapProps {
  /** The rooms a child may know about now. */
  rooms: readonly CastleRoomNode[];
  currentRoomId: CastleRoomId | undefined;
  discovery: Readonly<Record<CastleRoomId, CastleDiscovery>>;
  access: (room: CastleRoomNode) => CastleAccess;
  onGo: (roomId: CastleRoomId) => void;
}

function stateWords(current: boolean, discovered: boolean, access: CastleAccess): string {
  if (current) return 'You are here.';
  if (!access.ok) return access.message;
  return discovered ? 'Explored.' : 'Not explored yet.';
}

export function CastleMap({ rooms, currentRoomId, discovery, access, onGo }: CastleMapProps) {
  return (
    <div>
      <fieldset
        className={styles.map}
        style={{ aspectRatio: `${MAP_WIDTH_METERS} / ${MAP_DEPTH_METERS}` }}
      >
        <legend className={styles.visuallyHidden}>Castle map</legend>
        {rooms.map((room) => {
          const current = room.id === currentRoomId;
          const discovered = discovery[room.id] === 'discovered';
          const reach = access(room);
          const classes = [
            styles.tile,
            current ? styles.tileHere : '',
            discovered ? '' : styles.tileUnseen,
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={room.id}
              type="button"
              className={classes}
              style={tileBox(room)}
              aria-label={`${room.label}. ${stateWords(current, discovered, reach)}`}
              aria-current={current ? 'location' : undefined}
              disabled={!reach.ok}
              onClick={() => onGo(room.id)}
            >
              <span aria-hidden="true">{current ? '●' : discovered ? '' : '?'}</span>
            </button>
          );
        })}
      </fieldset>
      <p className={styles.note}>
        The dot is where you are. A question mark is a room you have not explored yet.
      </p>
    </div>
  );
}
