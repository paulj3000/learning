import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { confirmResetPassword, resetPassword } from 'aws-amplify/auth';
import styles from './AuthForm.module.css';
import { describeAuthError } from './errors';
import { validateConfirmationCode, validateEmail, validatePassword } from './validators';

type Step = 'request' | 'confirm';

export function ForgotPasswordForm() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    code?: string;
    password?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRequestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const emailError = validateEmail(email);
    setFieldErrors({ email: emailError ?? undefined });
    if (emailError) return;

    setIsSubmitting(true);
    try {
      await resetPassword({ username: email.trim() });
      setStep('confirm');
    } catch (error) {
      setFormError(describeAuthError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const errors = {
      code: validateConfirmationCode(code) ?? undefined,
      password: validatePassword(newPassword) ?? undefined,
    };
    setFieldErrors((current) => ({ ...current, ...errors }));
    if (errors.code || errors.password) return;

    setIsSubmitting(true);
    try {
      await confirmResetPassword({
        username: email.trim(),
        confirmationCode: code.trim(),
        newPassword,
      });
      navigate('/sign-in', { replace: true });
    } catch (error) {
      setFormError(describeAuthError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (step === 'confirm') {
    return (
      <div className={styles.page}>
        <form className={styles.card} onSubmit={handleConfirmSubmit} noValidate>
          <h1 className={styles.heading}>Choose a new password</h1>
          <p className={styles.lead}>Enter the code we sent to {email} and a new password.</p>
          {formError ? (
            <p className={styles.error} role="alert">
              {formError}
            </p>
          ) : null}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="code">
              Confirmation code
            </label>
            <input
              id="code"
              className={styles.input}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setCode(event.target.value)}
            />
            {fieldErrors.code ? <p className={styles.fieldError}>{fieldErrors.code}</p> : null}
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="newPassword">
              New password
            </label>
            <input
              id="newPassword"
              className={styles.input}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setNewPassword(event.target.value)
              }
            />
            {fieldErrors.password ? (
              <p className={styles.fieldError}>{fieldErrors.password}</p>
            ) : null}
          </div>
          <button className={styles.button} type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save new password'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleRequestSubmit} noValidate>
        <h1 className={styles.heading}>Reset your password</h1>
        <p className={styles.lead}>We will send a confirmation code to your email address.</p>
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
        <button className={styles.button} type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Sending...' : 'Send code'}
        </button>
        <p className={styles.linkRow}>
          <Link to="/sign-in">Back to sign in</Link>
        </p>
      </form>
    </div>
  );
}
