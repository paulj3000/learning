import { Link } from 'react-router-dom';
import styles from './Home.module.css';
import { isCognitoConfigured } from '../lib/cognito';

export function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <img className={styles.badge} src="/favicon.svg" alt="" />
        <p className={styles.title}>Learning Adventure Island</p>
      </header>
      <main className={styles.main} id="main-content">
        <h1 className={styles.heading}>An island that grows when your child learns</h1>
        <p className={styles.lead}>
          Learning Adventure Island is a guided, AI-powered adventure world for children ages 3 to
          8. Create a parent account to set up child profiles and get started.
        </p>
        {isCognitoConfigured ? (
          <div className={styles.actions}>
            <Link className={styles.primaryAction} to="/sign-up">
              Create a parent account
            </Link>
            <Link className={styles.secondaryAction} to="/sign-in">
              Sign in
            </Link>
          </div>
        ) : (
          <p className={styles.notice}>
            Parent accounts need sign-in settings. Set <code>VITE_COGNITO_USER_POOL_ID</code> and{' '}
            <code>VITE_COGNITO_CLIENT_ID</code> to enable sign-up and sign-in.
          </p>
        )}
      </main>
      <footer className={styles.footer}>
        <p>Learning Adventure Island</p>
      </footer>
    </div>
  );
}
