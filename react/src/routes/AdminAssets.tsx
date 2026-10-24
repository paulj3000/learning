import { Link } from 'react-router-dom';
import parentStyles from './ParentDashboard.module.css';
import styles from '../features/assets/AssetAdmin.module.css';

interface AssetTypeEntry {
  title: string;
  description: string;
  /** Present only for asset types the manager can handle today. */
  to?: string;
}

/**
 * The asset types docs/android/ASSET_MANAGEMENT.md section 2 plans for.
 * Only models are built; the rest are listed so the admin can see where
 * they will live, not linked to empty pages.
 */
const ASSET_TYPES: AssetTypeEntry[] = [
  {
    title: 'Models',
    description: 'GLB models for characters, props, buildings, and environments.',
    to: '/admin/assets/models',
  },
  { title: 'Textures', description: 'Shared PNG, JPG, WEBP, and KTX2 textures. Not built yet.' },
  { title: 'Animations', description: 'Reusable animation clips. Not built yet.' },
  { title: 'Audio', description: 'Voices, music, and sound effects. Not built yet.' },
  { title: 'Images', description: 'Illustrations and interface art. Not built yet.' },
  { title: 'Environments', description: 'Skyboxes and lighting setups. Not built yet.' },
];

/** `/admin/assets`: the Model Asset Manager's entry point. Reachable only through `RequireAdmin`. */
export function AdminAssets() {
  return (
    <div className={parentStyles.page}>
      <header className={parentStyles.header}>
        <h1 className={parentStyles.title}>Game assets</h1>
        <Link to="/admin">Back to admin</Link>
      </header>
      <main className={parentStyles.main} id="main-content">
        <div className={styles.content}>
          <p className={styles.hint}>
            Assets are stored in S3 and referenced by id. Uploading an asset never makes it visible
            to children; an administrator has to publish it first.
          </p>
          <ul className={styles.typeGrid}>
            {ASSET_TYPES.map((type) => (
              <li className={styles.typeCard} key={type.title}>
                <h2 className={styles.typeTitle}>
                  {type.to ? (
                    <Link className={styles.link} to={type.to}>
                      {type.title}
                    </Link>
                  ) : (
                    type.title
                  )}
                </h2>
                <p className={styles.hint}>{type.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
