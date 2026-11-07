import { Link } from 'react-router-dom';
import styles from './IslandExplorer.module.css';
import type { ExplorerIsland } from '../worlds/islandExplorer';

interface IslandExplorerProps {
  islands: readonly ExplorerIsland[];
}

/**
 * The Island Explorer on the child's homepage (LAI-0808).
 *
 * Presentational only: `buildIslandExplorer` decides what is here, open, and
 * locked. Links are real links; a locked island is plain text, never a
 * button that refuses (CLAUDE.md sections 4 and 13).
 */
export function IslandExplorer({ islands }: IslandExplorerProps) {
  return (
    <section className={styles.explorer} aria-labelledby="island-explorer-heading">
      <h2 className={styles.heading} id="island-explorer-heading">
        Where to next?
      </h2>
      <ul className={styles.islands}>
        {islands.map((island) => (
          <li
            className={island.status === 'HERE' ? styles.hereItem : styles.item}
            key={island.slug}
          >
            {island.status === 'HERE' ? <HereIsland island={island} /> : null}
            {island.status === 'OPEN' && island.href ? (
              <Link className={styles.openCard} to={island.href}>
                <span className={styles.title}>{island.title}</span>
                <span className={styles.tagline}>{island.tagline}</span>
                <span className={styles.action}>Sail here</span>
              </Link>
            ) : null}
            {island.status === 'LOCKED' ? (
              <div className={styles.lockedCard}>
                <p className={styles.title}>{island.title}</p>
                <p className={styles.badge}>Not open yet</p>
                <p className={styles.tagline}>{island.lockedHint}</p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function HereIsland({ island }: { island: ExplorerIsland }) {
  const placesHeadingId = `island-explorer-places-${island.slug}`;
  return (
    <div className={styles.hereCard}>
      <p className={styles.title}>{island.title}</p>
      <p className={styles.badge}>You are here</p>
      <p className={styles.tagline}>{island.tagline}</p>
      <h3 className={styles.placesHeading} id={placesHeadingId}>
        Places to visit
      </h3>
      {island.places.length > 0 ? (
        <ul className={styles.places} aria-labelledby={placesHeadingId}>
          {island.places.map((place) => (
            <li key={place.slug}>
              <Link className={styles.placeCard} to={place.href}>
                <span className={styles.title}>{place.title}</span>
                <span className={styles.tagline}>{place.tagline}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.tagline}>New places are on their way. Come back soon.</p>
      )}
    </div>
  );
}
