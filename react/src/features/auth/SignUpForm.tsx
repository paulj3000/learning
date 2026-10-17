import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signUp } from 'aws-amplify/auth';
import styles from './AuthForm.module.css';
import { describeAuthError } from './errors';
import { validateDisplayName, validateEmail, validatePassword } from './validators';

interface FieldErrors {
  displayName?: string;
  email?: string;
  password?: string;
}

export function SignUpForm() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const errors: FieldErrors = {
      displayName: validateDisplayName(displayName) ?? undefined,
      email: validateEmail(email) ?? undefined,
      password: validatePassword(password) ?? undefined,
    };
    setFieldErrors(errors);
    if (errors.displayName || errors.email || errors.password) return;

    setIsSubmitting(true);
    try {
      await signUp({
        username: email.trim(),
        password,
        options: {
          userAttributes: { name: displayName.trim(), email: email.trim() },
          autoSignIn: true,
        },
      });
      navigate('/confirm', { state: { email: email.trim() } });
    } catch (error) {
      setFormError(describeAuthError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit} noValidate>
        <h1 className={styles.heading}>Create a parent account</h1>
        <p className={styles.lead}>Sign up to set up child profiles and manage the island.</p>
        {formError ? (
          <p className={styles.error} role="alert">
            {formError}
          </p>
        ) : null}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="displayName">
            Your name
          </label>
          <input
            id="displayName"
            className={styles.input}
            type="text"
            autoComplete="name"
            value={displayName}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setDisplayName(event.target.value)}
          />
          {fieldErrors.displayName ? (
            <p className={styles.fieldError}>{fieldErrors.displayName}</p>
          ) : null}
        </div>
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
            autoComplete="new-password"
            value={password}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
          />
          {fieldErrors.password ? (
            <p className={styles.fieldError}>{fieldErrors.password}</p>
          ) : null}
        </div>
        <button className={styles.button} type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account...' : 'Create account'}
        </button>
        <p className={styles.linkRow}>
          Already have an account? <Link to="/sign-in">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
