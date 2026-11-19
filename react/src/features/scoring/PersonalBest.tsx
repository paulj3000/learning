import type { PersonalBestRecord as PersonalBestValue } from './types';

/** A private mark of the child's own best visit. Never compared with anyone. */
export function PersonalBest({ best }: { best: PersonalBestValue | null }) {
  if (best === null) return null;
  return <p>Your best visit: {best.xpInOneVisit} XP</p>;
}
