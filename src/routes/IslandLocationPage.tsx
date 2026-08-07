import { Link, useParams } from 'react-router-dom';
import styles from './IslandLocationPage.module.css';
import { IslandLayout } from '../features/island/IslandLayout';
import { getIslandLocation } from '../features/island/locations';

export function IslandLocationPage() {
  const { childId, locationSlug } = useParams<{ childId: string; locationSlug: string }>();
  const location = locationSlug ? getIslandLocation(locationSlug) : undefined;

  if (!childId) {
    return null;
  }

  if (!location) {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">We could not find that part of the island.</p>
        <Link className={styles.backLink} to={`/island/${childId}`}>
          Back to the map
        </Link>
      </IslandLayout>
    );
  }

  return (
    <IslandLayout childId={childId}>
      <div className={styles.content}>
        <h1 className={styles.heading}>{location.title}</h1>
        <p className={styles.tagline}>{location.tagline}</p>
        <p className={styles.description}>{location.description}</p>
        <ul className={styles.skills}>
          {location.skills.map((skill) => (
            <li className={styles.skill} key={skill}>
              {skill}
            </li>
          ))}
        </ul>
        <p className={styles.decoration}>{location.decoration}</p>
        <Link className={styles.backLink} to={`/island/${childId}`}>
          Back to the map
        </Link>
      </div>
    </IslandLayout>
  );
}
