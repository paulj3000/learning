import styles from './AuthForm.module.css';
import {
  AUTH_DEV_HINT,
  AUTH_UNAVAILABLE_COPY,
  AUTH_UNCONFIGURED_COPY,
  showDevHints,
} from './authNoticeCopy';

/**
 * What a parent sees when sign-in cannot run: never a backend name or a setup command. In a
 * local `vite dev` build only, one extra line names the settings a developer is missing
 * (react/.env.example); production builds compile that line away.
 */

export function AuthUnconfiguredHint({ className }: { className?: string }) {
  if (!showDevHints()) return null;
  return (
    <p className={className} data-testid="auth-dev-hint">
      {AUTH_DEV_HINT}
    </p>
  );
}

export function AuthStatusNotice({
  status,
  onRetry,
}: {
  status: 'unconfigured' | 'unavailable';
  onRetry?: () => void;
}) {
  const copy = status === 'unconfigured' ? AUTH_UNCONFIGURED_COPY : AUTH_UNAVAILABLE_COPY;
  return (
    <div className={styles.page}>
      <div className={styles.card} role="alert">
        <h1 className={styles.heading}>{copy.heading}</h1>
        <p className={styles.lead}>{copy.lead}</p>
        {status === 'unavailable' && onRetry ? (
          <button type="button" className={styles.button} onClick={onRetry}>
            {AUTH_UNAVAILABLE_COPY.retry}
          </button>
        ) : null}
        {status === 'unconfigured' ? <AuthUnconfiguredHint className={styles.notice} /> : null}
      </div>
    </div>
  );
}
