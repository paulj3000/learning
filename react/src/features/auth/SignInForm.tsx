import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cognitoAuth } from '../../lib/cognito';
import styles from './AuthForm.module.css';
import { describeAuthError } from './errors';
import { validateEmail, validatePassword } from './validators';

const UNSUPPORTED_STEP =
  'This account needs a step this app cannot finish yet. Please reset your password and try again.';

interface LocationState {
  from?: { pathname?: string };
  /** Set by the confirmation page when it could not sign in by itself. */
  confirmed?: boolean;
}

export function SignInForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const errors = {
      email: validateEmail(email) ?? undefined,
      password: validatePassword(password) ?? undefined,
    };
    setFieldErrors(errors);
    if (errors.email || errors.password) return;

    setIsSubmitting(true);
    try {
      const { nextStep } = await cognitoAuth().signIn({ username: email.trim(), password });
      if (nextStep.signInStep === 'CONFIRM_SIGN_UP') {
        navigate('/confirm', { state: { email: email.trim() } });
        return;
      }
      if (nextStep.signInStep !== 'DONE') {
        setFormError(UNSUPPORTED_STEP);
        return;
      }
      navigate(state?.from?.pathname ?? '/home', { replace: true });
    } catch (error) {
      setFormError(describeAuthError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit} noValidate>
        <h1 className={styles.heading}>Sign in</h1>
        <p className={styles.lead}>Welcome back. Sign in to reach your parent dashboard.</p>
        {state?.confirmed && !formError ? (
          <p className={styles.notice}>Your email is confirmed. Sign in to continue.</p>
        ) : null}
        {formError ? (
          <p className={styles.error} role="alert">
            {formError}
          </p>
        ) : null}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            Email address
          </label>
          <input
            id="email"
            className={styles.input}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
          />
          {fieldErrors.email ? <p className={styles.fieldError}>{fieldErrors.email}</p> : null}
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className={styles.input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
          />
          {fieldErrors.password ? (
            <p className={styles.fieldError}>{fieldErrors.password}</p>
          ) : null}
        </div>
        <button className={styles.button} type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>
        <p className={styles.linkRow}>
          <Link to="/forgot-password">Forgot your password?</Link>
        </p>
        <p className={styles.linkRow}>
          New here? <Link to="/sign-up">Create an account</Link>
        </p>
      </form>
    </div>
  );
}
