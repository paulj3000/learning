import { useId } from 'react';
import type { GreatStorybook } from '../../../../great-storybook/useGreatStorybook';
import { getCastleRoom, type CastleRoomId } from '../../castleLayout';
import styles from './CastleGuide.module.css';

/**
 * The Great Storybook, as text a child can read, hear read, and act on (SC-R04-02 and the
 * accessible equivalent of the book in the castle, SC-R04-03).
 *
 * It owns no rules and writes nothing: whether a page is back is the records' answer
 * (`storybookProgress`), and the only action is walking to the room where a missing page's
 * challenge is, through the same request every other part of the guide makes. A page that is
 * already back is shown as back, with nothing to do and nothing to grant. The hidden bonus page
 * is listed only once found (the hook never gives this component an empty slot for it).
 */
export interface StorybookSectionProps {
  storybook: GreatStorybook;
  /** Whether the child can be taken to this room now, and whether they are already in it. */
  access: (roomId: string) => 'ok' | 'here' | 'no';
  onGo: (roomId: CastleRoomId) => void;
}

export function StorybookSection({ storybook, access, onGo }: StorybookSectionProps) {
  const { progress, entries } = storybook;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.title}>
        The Great Storybook
      </h3>
      <p className={styles.where}>
        {progress.complete
          ? 'The Great Storybook is whole again.'
          : `${progress.restoredRequired} of ${progress.totalRequired} missing pages are back.`}
      </p>
      <progress
        max={progress.totalRequired}
        value={progress.restoredRequired}
        aria-label="Missing pages that are back in the Great Storybook"
      />
      <ul className={styles.list}>
        {entries.map(({ page, restored }) => {
          const room = getCastleRoom(page.roomId);
          const reach = access(page.roomId);
          return (
            <li key={page.id}>
              <strong>{page.title}</strong>
              <span className={styles.note}>
                {restored ? `Back in the book. ${page.restoredText}` : `Missing. ${page.hint}`}
              </span>
              {!restored && room ? (
                reach === 'here' ? (
                  <span className={styles.note}>You are in the right place.</span>
                ) : (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={reach !== 'ok'}
                    onClick={() => onGo(room.id)}
                  >
                    Go to {room.label}
                  </button>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
