import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createChildCognitoAuth, isChildCognitoConfigured } from '../../lib/cognito';
import styles from '../auth/AuthForm.module.css';
import { CHILD_SIGN_IN_COPY as COPY } from './childSignInCopy';
import { useChildSession } from './ChildSessionContext';
import { childSessionApi, type ChildSessionApi, type SessionFailure } from './childSessionApi';

/** Where a child lands after signing in: the Realm Explorer for the child the server named. */
export function childHomePath(childId: string): string {
  return `/island/${encodeURIComponent(childId)}/realms`;
}

function messageFor(failure: SessionFailure): string {
  if (failure === 'unavailable') return COPY.unavailable;
  if (failure === 'throttled') return COPY.throttled;
  if (failure === 'network') return COPY.offline;
  return COPY.askGrownUp;
}

interface Props {
  headingId?: string;
  /** Injected in tests. */
  api?: ChildSessionApi;
}

/**
 * A child signs in with their own username and password (child Cognito pool, SRP), then trades
 * the pool's access token for a Django child session and throws the Cognito tokens away (they
 * were only ever in memory). Every failure reads the same, "ask your grown-up", and never says
 * which part was wrong.
 */
export function ChildSignInForm({ headingId, api }: Props) {
  const navigate = useNavigate();
  const { adopt } = useChildSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isChildCognitoConfigured) {
    return (
      <section className={styles.card} aria-labelledby={headingId}>
        <h2 className={styles.heading} id={headingId}>
          {COPY.heading}
        </h2>
        <p className={styles.notice} role="status">
          {COPY.notConfigured}
        </p>
      </section>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const login = username.trim().toLowerCase();
    if (login === '' || password === '') {
      setError(COPY.missing);
      return;
    }
    setBusy(true);
    const auth = createChildCognitoAuth();
    try {
      const { nextStep } = await auth.signIn({ username: login, password });
      if (nextStep.signInStep !== 'DONE') {
        setError(COPY.askGrownUp);
        return;
      }
      const tokens = await auth.getTokens();
      if (!tokens) {
        setError(COPY.askGrownUp);
        return;
      }
      const result = await (api ?? childSessionApi()).create(tokens.accessToken, remember);
      if (!result.ok) {
        setError(messageFor(result.failure));
        return;
      }
      adopt(result.session);
      navigate(childHomePath(result.session.child.id), { replace: true });
    } catch (caught) {
      const name = caught instanceof Error ? caught.name : '';
      setError(name === 'NetworkError' ? COPY.offline : COPY.askGrownUp);
    } finally {
      // The child's Cognito tokens are never kept: Django's session is the only credential.
      await auth.signOut().catch(() => undefined);
      setPassword('');
      setBusy(false);
    }
  }

  return (
    <form className={styles.card} onSubmit={handleSubmit} noValidate aria-labelledby={headingId}>
      <h2 className={styles.heading} id={headingId}>
        {COPY.heading}
      </h2>
      <p className={styles.lead}>{COPY.lead}</p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="child-username">
          {COPY.usernameLabel}
        </label>
        <input
          id="child-username"
          className={styles.input}
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={username}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setUsername(event.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="child-password">
          {COPY.passwordLabel}
        </label>
        <input
          id="child-password"
          className={styles.input}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
        />
      </div>
      <label className={styles.linkRow}>
        <input
          type="checkbox"
          checked={remember}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setRemember(event.target.checked)}
        />{' '}
        {COPY.rememberLabel}
      </label>
      <button className={styles.button} type="submit" disabled={busy}>
        {busy ? COPY.submitting : COPY.submit}
      </button>
      <p className={styles.linkRow}>{COPY.forgot}</p>
    </form>
  );
}
