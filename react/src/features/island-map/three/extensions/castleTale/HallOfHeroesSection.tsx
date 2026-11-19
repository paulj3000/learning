import { useId } from 'react';
import type { HallOfHeroes } from '../../../../great-storybook/hallOfHeroes';
import styles from './CastleGuide.module.css';

/**
 * The Hall of Heroes as text (SC-R07-03): the accessible equivalent of the
 * Character Gallery's record of completed stories. Read-only: it lists what
 * the child's own records say, offers no action, and grants nothing. A hall
 * with nothing in it yet is "ready", never a gap or a count of what is left.
 */
export function HallOfHeroesSection({ hall }: { hall: HallOfHeroes }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.title}>
        The Hall of Heroes
      </h3>
      {hall.rank ? <p className={styles.where}>Your castle title: {hall.rank.title}.</p> : null}
      {hall.isEmpty ? (
        <p className={styles.note}>
          The Hall of Heroes is ready for your first story. Tell one with Keeper Quill and it will
          be remembered here.
        </p>
      ) : (
        <>
          {hall.stories.length > 0 ? (
            <>
              <h4 className={styles.title}>Stories you finished</h4>
              <ul className={styles.list}>
                {hall.stories.map((story) => (
                  <li key={story.id}>{story.title}</li>
                ))}
              </ul>
            </>
          ) : null}
          {hall.pages.length > 0 ? (
            <>
              <h4 className={styles.title}>Pages you brought home</h4>
              <ul className={styles.list}>
                {hall.pages.map((page) => (
                  <li key={page.id}>
                    <strong>{page.title}</strong>
                    <span className={styles.note}>{page.text}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {hall.artifacts.length > 0 ? (
            <>
              <h4 className={styles.title}>Keepsakes in the Trophy Room</h4>
              <ul className={styles.list}>
                {hall.artifacts.map((artifact) => (
                  <li key={artifact.itemId}>
                    <strong>{artifact.name}</strong>
                    <span className={styles.note}>{artifact.description}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
