import styles from './scoring.module.css';

export function StarRating({ stars, maxStars }: { stars: number; maxStars: number }) {
  const max = Math.max(0, Math.floor(maxStars));
  const earned = Math.min(max, Math.max(0, Math.floor(stars)));
  return (
    <span className={styles.row} role="img" aria-label={`${earned} of ${max} stars`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} aria-hidden="true" data-earned={i < earned}>
          {i < earned ? '★' : '☆'}
        </span>
      ))}
    </span>
  );
}
