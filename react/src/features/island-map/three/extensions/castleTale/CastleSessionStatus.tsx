import { Link } from 'react-router-dom';
import styles from '../../../IslandWorldView.module.css';

/**
 * What a castle story panel shows before its session is ready (SC-R12 child-facing states): a
 * polite status while it opens, and, if it cannot open, an alert with a way back to the map, so a
 * child is never left at a dead end. The castle itself stays walkable either way.
 */
export function CastleSessionLoading({ message }: { message: string }) {
  return (
    <p className={styles.status} role="status">
      {message}
    </p>
  );
}

export function CastleSessionUnavailable({
  message,
  backToMapHref,
}: {
  message: string;
  backToMapHref: string;
}) {
  return (
    <div className={styles.status} role="alert">
      <p>{message} You can keep exploring the castle, or try again later.</p>
      <Link to={backToMapHref}>Back to the map</Link>
    </div>
  );
}
