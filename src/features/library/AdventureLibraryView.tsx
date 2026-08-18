import { Link } from 'react-router-dom';
import styles from './AdventureLibraryView.module.css';
import { selectLibraryForChild, type RecommendedArc } from './recommend';
import { ADVENTURE_THEME_LABELS } from './themes';
import type { LibraryArc } from './catalog';
import type { AgeBandValue } from '../child-profile/constants';

interface AdventureLibraryViewProps {
  childId: string;
  ageBand: AgeBandValue;
  interests: readonly (string | null)[] | null | undefined;
  /** Story slugs this child has opened but not finished. */
  startedStorySlugs: readonly string[];
  /** Story slugs this child has finished. */
  completedStorySlugs: readonly string[];
}

/**
 * The Adventure Library shelf (docs/ROADMAP.md Phase 15). Presentational
 * only: which arcs a child sees and in what order is decided by the pure,
 * separately tested `selectLibraryForChild`, so the gate can be reasoned
 * about and asserted without rendering anything.
 *
 * Two headings rather than one ranked list, because a 3-8 year old reads
 * position and grouping long before they read a sort order: "Picked for
 * you" says why an arc is at the top, and "More to explore" makes it
 * obvious that the rest are equally playable, not locked
 * (docs/UX_AND_ACCESSIBILITY.md). No progress bars, no counts, no streaks
 * (CLAUDE.md section 4's calm-engagement pillar); a card says at most that
 * a story is already finished or still going.
 */
export function AdventureLibraryView({
  childId,
  ageBand,
  interests,
  startedStorySlugs,
  completedStorySlugs,
}: AdventureLibraryViewProps) {
  const { recommended, moreToExplore, notYetForThisAge } = selectLibraryForChild({
    ageBand,
    interests,
  });
  const hasAnything = recommended.length > 0 || moreToExplore.length > 0;

  function statusOf(storySlug: string): string | null {
    if (completedStorySlugs.includes(storySlug)) return 'You finished this one';
    if (startedStorySlugs.includes(storySlug)) return 'Keep going';
    return null;
  }

  function renderCard(arc: RecommendedArc) {
    const status = statusOf(arc.story.slug);
    return (
      <li key={arc.story.slug}>
        <Link className={styles.card} to={`/island/${childId}/stories/${arc.story.slug}`}>
          <span className={styles.theme}>{ADVENTURE_THEME_LABELS[arc.entry.theme]}</span>
          <span className={styles.cardTitle}>{arc.story.title}</span>
          <span className={styles.cardBlurb}>{arc.entry.blurb}</span>
          {status ? <span className={styles.status}>{status}</span> : null}
        </Link>
      </li>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Adventure Library</h1>
      <p className={styles.intro}>Every story here is yours to start. Pick any one you like.</p>

      {recommended.length > 0 ? (
        <section className={styles.section} aria-labelledby="library-picked">
          <h2 className={styles.sectionHeading} id="library-picked">
            Picked for you
          </h2>
          <ul className={styles.grid}>{recommended.map(renderCard)}</ul>
        </section>
      ) : null}

      {moreToExplore.length > 0 ? (
        <section className={styles.section} aria-labelledby="library-more">
          <h2 className={styles.sectionHeading} id="library-more">
            More to explore
          </h2>
          <ul className={styles.grid}>{moreToExplore.map(renderCard)}</ul>
        </section>
      ) : null}

      {!hasAnything ? (
        <p className={styles.note}>
          There are no stories waiting here just yet. New ones are being written.
        </p>
      ) : null}

      {notYetForThisAge.length > 0 ? (
        <p className={styles.note}>{waitingNote(notYetForThisAge)}</p>
      ) : null}

      <Link className={styles.backLink} to={`/island/${childId}`}>
        Back to the map
      </Link>
    </div>
  );
}

/**
 * Names the age-gated arcs rather than hiding them. A child who hears about
 * a story from a sibling should find an honest "not yet" here, the same
 * calm framing `IslandLocationPage` already uses for an age-gated
 * adventure, instead of wondering why it is missing.
 *
 * The wording is deliberately direction-free ("another day", not "when you
 * are older"): the gate is `supportedAgeBands`, which can exclude an arc
 * for being written for a younger band just as easily as an older one, and
 * telling an Explorer that a Sprout story is waiting until they grow up
 * would simply be untrue.
 */
function waitingNote(arcs: LibraryArc[]): string {
  const titles = arcs.map((arc) => arc.story.title);
  const list =
    titles.length === 1
      ? titles[0]
      : `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
  return titles.length === 1
    ? `${list} is waiting here for another day.`
    : `${list} are waiting here for another day.`;
}
