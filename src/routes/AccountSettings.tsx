import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchUserAttributes } from 'aws-amplify/auth';
import parentStyles from './ParentDashboard.module.css';
import formStyles from '../features/auth/AuthForm.module.css';
import styles from './AccountSettings.module.css';
import { describeAuthError } from '../features/auth/errors';
import {
  validateConfirmationCode,
  validateDisplayName,
  validateEmail,
  validatePassword,
} from '../features/auth/validators';
import { changeEmail, changePassword, confirmEmailChange } from '../features/auth/accountSettings';
import { getOrCreateParentProfile, updateParentProfileDisplayName } from '../features/child-profile/api';
import { deleteAccountAndAllData } from '../features/child-profile/deletion';
import type { ParentProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'error';

export function AccountSettings() {
  const navigate = useNavigate();

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [parentProfile, setParentProfile] = useState<ParentProfile | null>(null);
  const [currentEmail, setCurrentEmail] = useState('');

  const [displayName, setDisplayName] = useState('');
  const [nameFieldError, setNameFieldError] = useState<string | null>(null);
  const [nameFormError, setNameFormError] = useState<string | null>(null);
  const [nameNotice, setNameNotice] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [newEmail, setNewEmail] = useState('');
  const [emailFieldError, setEmailFieldError] = useState<string | null>(null);
  const [emailFormError, setEmailFormError] = useState<string | null>(null);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);
  const [awaitingEmailCode, setAwaitingEmailCode] = useState(false);
  const [confirmationCode, setConfirmationCode] = useState('');
  const [codeFieldError, setCodeFieldError] = useState<string | null>(null);
  const [confirmingEmail, setConfirmingEmail] = useState(false);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordFieldErrors, setPasswordFieldErrors] = useState<{
    oldPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  }>({});
  const [passwordFormError, setPasswordFormError] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const [confirmingDeleteAccount, setConfirmingDeleteAccount] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [profile, attributes] = await Promise.all([
          getOrCreateParentProfile(),
          fetchUserAttributes(),
        ]);
        if (cancelled) return;
        setParentProfile(profile);
        setDisplayName(profile.displayName);
        setCurrentEmail(attributes.email ?? '');
        setLoadState('ready');
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Something went wrong.');
        setLoadState('error');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleNameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNameFormError(null);
    setNameNotice(null);

    const fieldError = validateDisplayName(displayName);
    setNameFieldError(fieldError);
    if (fieldError || !parentProfile) return;

    setSavingName(true);
    try {
      const updated = await updateParentProfileDisplayName(parentProfile.id, displayName.trim());
      setParentProfile(updated);
      setDisplayName(updated.displayName);
      setNameNotice('Your name has been updated.');
    } catch (error) {
      setNameFormError(error instanceof Error ? error.message : 'Could not update your name.');
    } finally {
      setSavingName(false);
    }
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailFormError(null);
    setEmailNotice(null);

    const fieldError = validateEmail(newEmail);
    setEmailFieldError(fieldError);
    if (fieldError) return;

    setSavingEmail(true);
    try {
      const { needsConfirmation } = await changeEmail(newEmail.trim());
      if (needsConfirmation) {
        setAwaitingEmailCode(true);
        setEmailNotice(`We sent a confirmation code to ${newEmail.trim()}.`);
      } else {
        setCurrentEmail(newEmail.trim());
        setNewEmail('');
        setEmailNotice('Your email address has been updated.');
      }
    } catch (error) {
      setEmailFormError(describeAuthError(error));
    } finally {
      setSavingEmail(false);
    }
  }

  async function handleConfirmEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailFormError(null);

    const fieldError = validateConfirmationCode(confirmationCode);
    setCodeFieldError(fieldError);
    if (fieldError) return;

    setConfirmingEmail(true);
    try {
      await confirmEmailChange(confirmationCode.trim());
      setCurrentEmail(newEmail.trim());
      setNewEmail('');
      setConfirmationCode('');
      setAwaitingEmailCode(false);
      setEmailNotice('Your email address has been updated.');
    } catch (error) {
      setEmailFormError(describeAuthError(error));
    } finally {
      setConfirmingEmail(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordFormError(null);
    setPasswordNotice(null);

    const errors = {
      oldPassword: validatePassword(oldPassword) ?? undefined,
      newPassword: validatePassword(newPassword) ?? undefined,
      confirmPassword:
        newPassword === confirmPassword ? undefined : 'Passwords do not match.',
    };
    setPasswordFieldErrors(errors);
    if (errors.oldPassword || errors.newPassword || errors.confirmPassword) return;

    setSavingPassword(true);
    try {
      await changePassword(oldPassword, newPassword);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordNotice('Your password has been updated.');
    } catch (error) {
      if (error instanceof Error && error.name === 'NotAuthorizedException') {
        setPasswordFormError('Your current password is incorrect.');
      } else {
        setPasswordFormError(describeAuthError(error));
      }
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleDeleteAccount() {
    setDeletingAccount(true);
    setDeleteAccountError(null);
    try {
      await deleteAccountAndAllData();
      navigate('/');
    } catch (error) {
      setDeleteAccountError(
        error instanceof Error ? error.message : 'Could not delete your account.',
      );
      setDeletingAccount(false);
    }
  }

  return (
    <div className={parentStyles.page}>
      <header className={parentStyles.header}>
        <h1 className={parentStyles.title}>Account settings</h1>
        <Link to="/home">Back to dashboard</Link>
      </header>
      <main className={parentStyles.main} id="main-content">
        {loadState === 'loading' ? <p>Loading your account...</p> : null}
        {loadState === 'error' ? (
          <p className={parentStyles.error} role="alert">
            {loadError}
          </p>
        ) : null}
        {loadState === 'ready' && parentProfile ? (
          <div className={parentStyles.content}>
            <section className={styles.section}>
              <h2 className={styles.sectionHeading}>Your name</h2>
              <form className={styles.form} onSubmit={(event) => void handleNameSubmit(event)}>
                {nameFormError ? (
                  <p className={formStyles.error} role="alert">
                    {nameFormError}
                  </p>
                ) : null}
                {nameNotice ? <p className={formStyles.notice}>{nameNotice}</p> : null}
                <div className={formStyles.field}>
                  <label className={formStyles.label} htmlFor="display-name">
                    Name
                  </label>
                  <input
                    id="display-name"
                    className={formStyles.input}
                    type="text"
                    autoComplete="name"
                    value={displayName}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setDisplayName(event.target.value)
                    }
                  />
                  {nameFieldError ? (
                    <p className={formStyles.fieldError}>{nameFieldError}</p>
                  ) : null}
                </div>
                <button className={formStyles.button} type="submit" disabled={savingName}>
                  {savingName ? 'Saving...' : 'Save name'}
                </button>
              </form>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionHeading}>Email address</h2>
              <p className={styles.currentValue}>Current email: {currentEmail}</p>
              {!awaitingEmailCode ? (
                <form className={styles.form} onSubmit={(event) => void handleEmailSubmit(event)}>
                  {emailFormError ? (
                    <p className={formStyles.error} role="alert">
                      {emailFormError}
                    </p>
                  ) : null}
                  {emailNotice ? <p className={formStyles.notice}>{emailNotice}</p> : null}
                  <div className={formStyles.field}>
                    <label className={formStyles.label} htmlFor="new-email">
                      New email address
                    </label>
                    <input
                      id="new-email"
                      className={formStyles.input}
                      type="email"
                      autoComplete="email"
                      value={newEmail}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setNewEmail(event.target.value)
                      }
                    />
                    {emailFieldError ? (
                      <p className={formStyles.fieldError}>{emailFieldError}</p>
                    ) : null}
                  </div>
                  <button className={formStyles.button} type="submit" disabled={savingEmail}>
                    {savingEmail ? 'Saving...' : 'Update email'}
                  </button>
                </form>
              ) : (
                <form
                  className={styles.form}
                  onSubmit={(event) => void handleConfirmEmailCode(event)}
                >
                  {emailFormError ? (
                    <p className={formStyles.error} role="alert">
                      {emailFormError}
                    </p>
                  ) : null}
                  {emailNotice ? <p className={formStyles.notice}>{emailNotice}</p> : null}
                  <div className={formStyles.field}>
                    <label className={formStyles.label} htmlFor="email-code">
                      Confirmation code
                    </label>
                    <input
                      id="email-code"
                      className={formStyles.input}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={confirmationCode}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setConfirmationCode(event.target.value)
                      }
                    />
                    {codeFieldError ? (
                      <p className={formStyles.fieldError}>{codeFieldError}</p>
                    ) : null}
                  </div>
                  <button className={formStyles.button} type="submit" disabled={confirmingEmail}>
                    {confirmingEmail ? 'Confirming...' : 'Confirm new email'}
                  </button>
                  <button
                    className={formStyles.buttonSecondary}
                    type="button"
                    onClick={() => {
                      setAwaitingEmailCode(false);
                      setEmailNotice(null);
                      setConfirmationCode('');
                    }}
                  >
                    Cancel
                  </button>
                </form>
              )}
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionHeading}>Password</h2>
              <form
                className={styles.form}
                onSubmit={(event) => void handlePasswordSubmit(event)}
              >
                {passwordFormError ? (
                  <p className={formStyles.error} role="alert">
                    {passwordFormError}
                  </p>
                ) : null}
                {passwordNotice ? <p className={formStyles.notice}>{passwordNotice}</p> : null}
                <div className={formStyles.field}>
                  <label className={formStyles.label} htmlFor="old-password">
                    Current password
                  </label>
                  <input
                    id="old-password"
                    className={formStyles.input}
                    type="password"
                    autoComplete="current-password"
                    value={oldPassword}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setOldPassword(event.target.value)
                    }
                  />
                  {passwordFieldErrors.oldPassword ? (
                    <p className={formStyles.fieldError}>{passwordFieldErrors.oldPassword}</p>
                  ) : null}
                </div>
                <div className={formStyles.field}>
                  <label className={formStyles.label} htmlFor="new-password">
                    New password
                  </label>
                  <input
                    id="new-password"
                    className={formStyles.input}
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setNewPassword(event.target.value)
                    }
                  />
                  {passwordFieldErrors.newPassword ? (
                    <p className={formStyles.fieldError}>{passwordFieldErrors.newPassword}</p>
                  ) : null}
                </div>
                <div className={formStyles.field}>
                  <label className={formStyles.label} htmlFor="confirm-password">
                    Confirm new password
                  </label>
                  <input
                    id="confirm-password"
                    className={formStyles.input}
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setConfirmPassword(event.target.value)
                    }
                  />
                  {passwordFieldErrors.confirmPassword ? (
                    <p className={formStyles.fieldError}>{passwordFieldErrors.confirmPassword}</p>
                  ) : null}
                </div>
                <button className={formStyles.button} type="submit" disabled={savingPassword}>
                  {savingPassword ? 'Saving...' : 'Update password'}
                </button>
              </form>
            </section>

            <section className={parentStyles.dangerZone}>
              <h2 className={parentStyles.dangerHeading}>Delete account</h2>
              <p className={parentStyles.hint}>
                Permanently deletes your parent account and every child profile, adventure, saved
                story, and record beneath it. This cannot be undone.
              </p>
              {deleteAccountError ? (
                <p className={parentStyles.error} role="alert">
                  {deleteAccountError}
                </p>
              ) : null}
              {confirmingDeleteAccount ? (
                <div className={parentStyles.confirm} role="alert">
                  <p className={parentStyles.confirmText}>
                    Delete your account and all family data for good?
                  </p>
                  <button
                    className={parentStyles.buttonDanger}
                    type="button"
                    disabled={deletingAccount}
                    onClick={() => void handleDeleteAccount()}
                  >
                    Yes, delete everything
                  </button>
                  <button
                    className={parentStyles.buttonSecondary}
                    type="button"
                    onClick={() => setConfirmingDeleteAccount(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className={parentStyles.buttonDanger}
                  type="button"
                  onClick={() => setConfirmingDeleteAccount(true)}
                >
                  Delete my account
                </button>
              )}
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
