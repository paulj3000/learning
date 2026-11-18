import { useId } from 'react';
import type { GreatStorybook } from '../../../../great-storybook/useGreatStorybook';
import { pageState, type PageState, type PageStateContext } from '../../../../great-storybook/pageStates';
import { getCastleRoom, type CastleRoomId } from '../../castleLayout';
import { CASTLE_RANKS, shownRank, type CastleRanksConfig } from '../../../../great-storybook/castleRanks';
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
  /** What the child has visited and started, so each missing page can say where they are with it. */
  context?: PageStateContext;
  /** Rank titles (SC-R07-04): a derived title on the page tracker, only while switched on. */
  ranks?: CastleRanksConfig;
}

const STATE_WORDS: Record<PageState, string> = {
  UNDISCOVERED: 'Not found yet.',
  DISCOVERED: 'You know where to look.',
  IN_PROGRESS: 'You have started this one.',
  RESTORED: 'Back in the book.',
};

export function StorybookSection({
  storybook,
  access,
  onGo,
  context,
  ranks = CASTLE_RANKS,
}: StorybookSectionProps) {
  const { progress, entries, status, retry } = storybook;
  const rank = shownRank(progress.restoredRequired, progress.totalRequired, ranks);
  const headingId = useId();
  // A child who restored the book in an earlier edition is never told it is incomplete: the book
  // is restored, and a newly found page is an invitation, not a loss.
  const morePages = progress.state === 'RESTORED_MORE_PAGES';
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.title}>
        The Great Storybook
      </h3>
      <p className={styles.where}>
        {progress.complete
          ? 'The Great Storybook is whole again.'
          : morePages
            ? 'The Great Storybook is restored. A new page was found!'
            : `${progress.restoredRequired} of ${progress.totalRequired} missing pages are back.`}
      </p>
      {rank ? <p className={styles.where}>Your castle title: {rank.title}.</p> : null}
      {progress.complete ? (
        <p role="status" className={styles.celebrate}>
          Every missing page is back. Well done, storykeeper!
        </p>
      ) : null}
      {status === 'loading' ? (
        <p role="status" className={styles.note}>
          Checking the book with the castle...
        </p>
      ) : null}
      {status === 'offline' ? (
        <p role="status" className={styles.note}>
          We could not check the book just now. The pages you have are still shown.{' '}
          <button type="button" className={styles.button} onClick={retry}>
            Try again
          </button>
        </p>
      ) : null}
      {entries.length === 0 ? (
        <p className={styles.note}>There are no pages to look for yet. Come back soon.</p>
      ) : null}
      {morePages ? null : (
        <progress
          max={progress.totalRequired}
          value={progress.restoredRequired}
          aria-label="Missing pages that are back in the Great Storybook"
        />
      )}
      <ul className={styles.list}>
        {entries.map(({ page, restored }) => {
          const room = getCastleRoom(page.roomId);
          const reach = access(page.roomId);
          return (
            <li key={page.id}>
              <strong>{page.title}</strong>
              <span className={styles.note}>
                {restored
                  ? `${STATE_WORDS.RESTORED} ${page.restoredText}`
                  : `${morePages ? 'A new page.' : 'Missing.'} ${STATE_WORDS[pageState({ page, restored }, context)]} ${page.hint}`}
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
