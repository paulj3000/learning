import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { autoSignIn, confirmSignUp, resendSignUpCode } from 'aws-amplify/auth';
import styles from './AuthForm.module.css';
import { describeAuthError } from './errors';
import { validateConfirmationCode, validateEmail } from './validators';

interface LocationState {
  email?: string;
}

export function ConfirmSignUpForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;

  const [email, setEmail] = useState(state?.email ?? '');
  const [code, setCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; code?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);

    const errors = {
      email: validateEmail(email) ?? undefined,
      code: validateConfirmationCode(code) ?? undefined,
    };
    setFieldErrors(errors);
    if (errors.email || errors.code) return;

    setIsSubmitting(true);
    try {
      const { nextStep } = await confirmSignUp({
        username: email.trim(),
        confirmationCode: code.trim(),
      });
      if (nextStep.signUpStep === 'COMPLETE_AUTO_SIGN_IN') {
        await autoSignIn();
      }
      navigate('/parent', { replace: true });
    } catch (error) {
      setFormError(describeAuthError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    setFormError(null);
    setNotice(null);
    const emailError = validateEmail(email);
    if (emailError) {
      setFieldErrors((current) => ({ ...current, email: emailError }));
      return;
    }
    setIsResending(true);
    try {
      await resendSignUpCode({ username: email.trim() });
      setNotice('A new confirmation code is on its way to your inbox.');
    } catch (error) {
      setFormError(describeAuthError(error));
    } finally {
      setIsResending(false);
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit} noValidate>
        <h1 className={styles.heading}>Confirm your email</h1>
        <p className={styles.lead}>Enter the confirmation code we sent to your email address.</p>
        {formError ? (
          <p className={styles.error} role="alert">
            {formError}
          </p>
        ) : null}
        {notice ? <p className={styles.notice}>{notice}</p> : null}
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
        <button className={styles.button} type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Confirming...' : 'Confirm account'}
        </button>
        <button
          className={styles.buttonSecondary}
          type="button"
          disabled={isResending}
          onClick={() => void handleResend()}
        >
          {isResending ? 'Sending...' : 'Resend code'}
        </button>
      </form>
    </div>
  );
}
