import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styles from './AuthForm.module.css';
import { useAuth } from './AuthContext';
import { LocalSignInError } from './authAdapters';
import { LOCAL_SIGN_IN_COPY } from './localSignInCopy';

interface LocationState {
  from?: { pathname?: string };
}

/**
 * Sign-in for `VITE_AUTH_PROVIDER=django` builds (ADR-038, local development
 * only). There is no sign-up, confirmation or recovery here: local parents
 * are made with `manage.py create_local_parent`.
 */
export function LocalSignInForm() {
  const { signInLocally } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!username.trim() || !password) {
      setFormError(LOCAL_SIGN_IN_COPY.missing);
      return;
    }
    if (!signInLocally) {
      setFormError(LOCAL_SIGN_IN_COPY.unavailable);
      return;
    }
    setIsSubmitting(true);
    try {
      await signInLocally(username.trim(), password);
      navigate(state?.from?.pathname ?? '/home', { replace: true });
    } catch (error) {
      const refused = error instanceof LocalSignInError && error.reason === 'invalid_credentials';
      setFormError(refused ? LOCAL_SIGN_IN_COPY.refused : LOCAL_SIGN_IN_COPY.unavailable);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit} noValidate>
        <h1 className={styles.heading}>{LOCAL_SIGN_IN_COPY.heading}</h1>
        <p className={styles.lead}>{LOCAL_SIGN_IN_COPY.lead}</p>
        {formError ? (
          <p className={styles.error} role="alert">
            {formError}
          </p>
        ) : null}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="local-username">
            {LOCAL_SIGN_IN_COPY.username}
          </label>
          <input
            id="local-username"
            className={styles.input}
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setUsername(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="local-password">
            {LOCAL_SIGN_IN_COPY.password}
          </label>
          <input
            id="local-password"
            className={styles.input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
          />
        </div>
        <button className={styles.button} type="submit" disabled={isSubmitting}>
          {isSubmitting ? LOCAL_SIGN_IN_COPY.submitting : LOCAL_SIGN_IN_COPY.submit}
        </button>
      </form>
    </div>
  );
}
