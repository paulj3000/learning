import { getAvatarEmoji } from '../../../../child-profile/constants';
import type { MultiplayerClient } from '../../../../multiplayer/multiplayerClient';
import {
  explorerName,
  PRESENCE_COPY,
  presenceStatusLine,
} from '../../../../multiplayer/presenceCopy';
import { useMultiplayerPresence } from '../../../../multiplayer/useMultiplayerPresence';
import styles from './MultiplayerPresencePanel.module.css';

export interface MultiplayerPresencePanelProps {
  regionId: string;
  childId: string;
  /** Null keeps the visit single-player and renders nothing. */
  createClient: (() => MultiplayerClient) | null;
}

/**
 * Who else from this family is in the room (roadmap Phase 1). Shows
 * avatars and an authored status line only: there is no way to send
 * anything to another child from here (ADR-006).
 *
 * Status changes are announced politely, so a screen reader hears a
 * sibling arrive or leave without the scene being interrupted.
 */
export function MultiplayerPresencePanel({
  regionId,
  childId,
  createClient,
}: MultiplayerPresencePanelProps) {
  const { snapshot, retry } = useMultiplayerPresence(regionId, childId, createClient);
  const statusLine = presenceStatusLine(snapshot);
  if (!createClient || statusLine === null) return null;

  const canRetry = snapshot.status === 'FAILED' || snapshot.status === 'DISCONNECTED';

  return (
    <section className={styles.panel} aria-labelledby="multiplayer-presence-heading">
      <h2 id="multiplayer-presence-heading" className={styles.heading}>
        {PRESENCE_COPY.heading}
      </h2>
      <p className={styles.status} role="status" aria-live="polite">
        {statusLine}
      </p>
      {snapshot.status === 'CONNECTED' || snapshot.status === 'RECONNECTING' ? (
        <ul className={styles.players}>
          {snapshot.players.map((player) => {
            const self = player.playerId === snapshot.selfPlayerId;
            return (
              <li
                key={player.playerId}
                className={styles.player}
                data-away={player.status === 'RECONNECTING' || undefined}
              >
                <span className={styles.avatar} aria-hidden="true">
                  {getAvatarEmoji(player.avatarKey)}
                </span>
                <span>
                  {self ? PRESENCE_COPY.you : explorerName(player.avatarKey)}
                  {player.status === 'RECONNECTING' ? `, ${PRESENCE_COPY.waitingToReturn}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {canRetry ? (
        <button type="button" className={styles.retry} onClick={retry}>
          {PRESENCE_COPY.retry}
        </button>
      ) : null}
    </section>
  );
}
