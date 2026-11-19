import { humanizeKey } from './format';
import { PersonalBest } from './PersonalBest';
import { StarRating } from './StarRating';
import type { AdventureScore } from './types';
import styles from './scoring.module.css';

export function AdventureResults({ adventure }: { adventure: AdventureScore | null | undefined }) {
  if (!adventure) return null;
  const title = humanizeKey(adventure.scopeKey);
  return (
    <section className={styles.card} aria-label={`${title} results`}>
      <h3 className={styles.title}>{title}</h3>
      <p>Great exploring! Here is what you found.</p>
      <ul className={styles.list}>
        <li>XP: {adventure.xp}</li>
        <li>Learning Points: {adventure.learningPoints}</li>
        <li>
          Treasure found: {adventure.coins} {adventure.coins === 1 ? 'coin' : 'coins'}
        </li>
        <li>
          <StarRating stars={adventure.stars} maxStars={adventure.maxStars} />
        </li>
      </ul>
      <PersonalBest best={adventure.personalBest} />
    </section>
  );
}
