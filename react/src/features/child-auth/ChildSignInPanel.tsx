import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSensitiveAction } from '../auth/recentSignIn/useSensitiveAction';
import type { SensitivePrompt } from '../auth/recentSignIn/RecentSignInDialog';
import styles from './ChildSignInPanel.module.css';
import {
  createSignInManagement,
  describeManagementError,
  validateNewPassword,
  validateUsername,
  type RememberedDevice,
  type SignInManagement,
  type SignInOverview,
} from './signInManagementApi';

interface Props {
  childId: string;
  nickname: string;
  /** Injected in tests. */
  management?: SignInManagement;
}

const STATUS_WORDS = {
  PROVISIONING: 'Being set up',
  ACTIVE: 'On: can sign in',
  SUSPENDED: 'Paused: cannot sign in',
} as const;

const CHANGE_LABELS: Record<string, string> = {
  consent_given: 'Consent given',
  consent_withdrawn: 'Consent withdrawn',
  sign_in_enabled: 'Sign-in turned on',
  sign_in_removed: 'Sign-in removed',
  username_changed: 'Username changed',
  password_reset: 'Password reset',
  sign_in_suspended: 'Sign-in paused',
  sign_in_resumed: 'Sign-in resumed',
  signed_out_everywhere: 'Signed out everywhere',
  device_forgotten: 'Device forgotten',
};

function when(value: string | null): string {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * A parent's controls for one child's own sign-in (LAI-AUTH child sign-in): consent, username
 * and password, pause, sign out everywhere, remembered devices and the change history. Changes
 * that need a fresh parent sign-in go through the existing recent sign-in dialog. Passwords are
 * held only in the form while typing and are cleared after every submit.
 */
export function ChildSignInPanel({ childId, nickname, management }: Props) {
  const api = management ?? createSignInManagement();
  const sensitive = useSensitiveAction();
  const [overview, setOverview] = useState<SignInOverview | null>(null);
  const [devices, setDevices] = useState<RememberedDevice[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api.overview(childId);
      setOverview(next);
      setDevices(
        next.signIn && next.signIn.rememberedDevices > 0 ? await api.devices(childId) : [],
      );
      setLoadError(null);
    } catch (error) {
      setLoadError(describeManagementError(error));
    }
    // `api` is rebuilt each render when not injected; the child id is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childId]);

  useEffect(() => {
    void load();
  }, [load]);

  function clearSecrets() {
    setPassword('');
    setConfirm('');
    setResetPassword('');
    setResetConfirm('');
  }

  /** Runs one management call, asking for a recent sign-in when Django does. */
  async function act(
    run: () => Promise<SignInOverview>,
    success: string,
    prompt?: SensitivePrompt,
  ): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    setFieldError(null);
    try {
      const result = prompt
        ? await sensitive.run(run, prompt)
        : ({ status: 'done', value: await run() } as const);
      if (result.status === 'cancelled') return false;
      setOverview(result.value);
      setDevices(
        result.value.signIn && result.value.signIn.rememberedDevices > 0
          ? await api.devices(childId).catch(() => [])
          : [],
      );
      const syncNote =
        result.value.providerSynced === false
          ? ' The sign-in service could not be updated yet, so please check again soon.'
          : '';
      setMessage({ kind: 'ok', text: success + syncNote });
      return true;
    } catch (error) {
      setMessage({ kind: 'error', text: describeManagementError(error) });
      return false;
    } finally {
      clearSecrets();
      setBusy(false);
    }
  }

  async function handleEnable(event: FormEvent) {
    event.preventDefault();
    const login = username.trim().toLowerCase();
    const problem =
      validateUsername(login, nickname) ?? validateNewPassword(password, confirm, login);
    if (problem) {
      setFieldError(problem);
      clearSecrets();
      return;
    }
    const pass = password;
    if (
      await act(() => api.enable(childId, login, pass), `${nickname} can now sign in.`, {
        title: `Turn on sign-in for ${nickname}`,
        description: `${nickname} will be able to sign in alone with the username and password you chose.`,
        confirmLabel: 'Turn on sign-in',
      })
    ) {
      setUsername('');
    }
  }

  async function handleReset(event: FormEvent) {
    event.preventDefault();
    const login = overview?.signIn?.username ?? '';
    const problem = validateNewPassword(resetPassword, resetConfirm, login);
    if (problem) {
      setFieldError(problem);
      clearSecrets();
      return;
    }
    const pass = resetPassword;
    await act(() => api.resetPassword(childId, pass), 'The password was changed.', {
      title: `Reset ${nickname}'s password`,
      description: `${nickname} will use the new password the next time they sign in.`,
      confirmLabel: 'Reset password',
    });
  }

  async function handleRename(event: FormEvent) {
    event.preventDefault();
    const login = newUsername.trim().toLowerCase();
    const problem = validateUsername(login, nickname);
    if (problem) {
      setFieldError(problem);
      return;
    }
    if (
      await act(() => api.changeUsername(childId, login), 'The username was changed.', {
        title: `Change ${nickname}'s username`,
        description: `${nickname} will sign in with the new username.`,
        confirmLabel: 'Change username',
      })
    ) {
      setNewUsername('');
    }
  }

  async function handleForget(device: RememberedDevice) {
    setBusy(true);
    setMessage(null);
    try {
      await api.forgetDevice(childId, device.id);
      await load();
      setMessage({ kind: 'ok', text: 'That device was forgotten.' });
    } catch (error) {
      setMessage({ kind: 'error', text: describeManagementError(error) });
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <p className={styles.error} role="alert">
        {loadError}
      </p>
    );
  }
  if (!overview) return <p role="status">Loading sign-in settings...</p>;

  const { consent, signIn } = overview;

  return (
    <div className={styles.panel}>
      {message ? (
        <p
          className={message.kind === 'error' ? styles.error : styles.notice}
          role={message.kind === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      ) : null}
      {fieldError ? (
        <p className={styles.error} role="alert">
          {fieldError}
        </p>
      ) : null}

      <section className={styles.section} aria-labelledby="signin-status">
        <h2 id="signin-status">{nickname}&apos;s own sign-in</h2>
        <p>
          Status: <strong>{signIn ? STATUS_WORDS[signIn.status] : 'Not set up'}</strong>
        </p>
        {signIn ? (
          <dl className={styles.facts}>
            <dt>Username</dt>
            <dd>{signIn.username}</dd>
            <dt>Created</dt>
            <dd>{when(signIn.createdAt)}</dd>
            <dt>Password last set</dt>
            <dd>{when(signIn.passwordSetAt)}</dd>
            <dt>Signed in now</dt>
            <dd>{signIn.activeSessions}</dd>
            <dt>Remembered devices</dt>
            <dd>{signIn.rememberedDevices}</dd>
          </dl>
        ) : (
          <p className={styles.muted}>
            {nickname} can sign in on their own with a username and password that you create. Their
            progress and settings stay as they are.
          </p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="signin-consent">
        <h2 id="signin-consent">Consent</h2>
        {!consent.available ? (
          <p className={styles.muted}>
            Independent sign-in is not available yet. The consent text has not been approved.
          </p>
        ) : consent.given ? (
          <>
            <p>You have given consent for {nickname} to sign in alone.</p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.buttonSecondary}
                disabled={busy}
                onClick={() =>
                  void act(() => api.withdrawConsent(childId), 'Consent withdrawn.', {
                    title: 'Withdraw consent',
                    description: `${nickname} will no longer be able to sign in alone, right away.`,
                    confirmLabel: 'Withdraw consent',
                    destructive: true,
                  })
                }
              >
                Withdraw consent
              </button>
            </div>
          </>
        ) : (
          <>
            <p>
              To let {nickname} sign in without you, we need your consent. You stay in charge: you
              can pause or remove it at any time.
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.button}
                disabled={busy}
                onClick={() =>
                  void act(() => api.giveConsent(childId), 'Consent given.', {
                    title: 'Give consent',
                    description: `Allow ${nickname} to sign in alone with their own username and password.`,
                    confirmLabel: 'Give consent',
                  })
                }
              >
                Give consent
              </button>
            </div>
          </>
        )}
      </section>

      {consent.given && !signIn ? (
        <section className={styles.section} aria-labelledby="signin-enable">
          <h2 id="signin-enable">Create {nickname}&apos;s sign-in</h2>
          <form className={styles.form} onSubmit={(event) => void handleEnable(event)} noValidate>
            <div className={styles.field}>
              <label htmlFor="new-child-username">Username</label>
              <input
                id="new-child-username"
                className={styles.input}
                autoComplete="off"
                autoCapitalize="none"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="new-child-password">Password</label>
              <input
                id="new-child-password"
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="new-child-password-confirm">Confirm password</label>
              <input
                id="new-child-password-confirm"
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </div>
            <p className={styles.muted}>
              Username: 4 to 20 lowercase letters, numbers, dots, dashes or underscores. Password: 8
              to 64 characters. We never show a password again.
            </p>
            <div className={styles.actions}>
              <button type="submit" className={styles.button} disabled={busy}>
                Turn on sign-in
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {signIn ? (
        <section className={styles.section} aria-labelledby="signin-manage">
          <h2 id="signin-manage">Manage sign-in</h2>
          <form className={styles.form} onSubmit={(event) => void handleReset(event)} noValidate>
            <div className={styles.field}>
              <label htmlFor="reset-child-password">New password</label>
              <input
                id="reset-child-password"
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="reset-child-password-confirm">Confirm new password</label>
              <input
                id="reset-child-password-confirm"
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={resetConfirm}
                onChange={(event) => setResetConfirm(event.target.value)}
              />
            </div>
            <div className={styles.actions}>
              <button type="submit" className={styles.button} disabled={busy}>
                Reset password
              </button>
            </div>
          </form>
          <form className={styles.form} onSubmit={(event) => void handleRename(event)} noValidate>
            <div className={styles.field}>
              <label htmlFor="rename-child-username">New username</label>
              <input
                id="rename-child-username"
                className={styles.input}
                autoComplete="off"
                autoCapitalize="none"
                value={newUsername}
                onChange={(event) => setNewUsername(event.target.value)}
              />
            </div>
            <div className={styles.actions}>
              <button type="submit" className={styles.buttonSecondary} disabled={busy}>
                Change username
              </button>
            </div>
          </form>
          <div className={styles.actions}>
            {signIn.status === 'SUSPENDED' ? (
              <button
                type="button"
                className={styles.button}
                disabled={busy}
                onClick={() =>
                  void act(() => api.resume(childId), 'Sign-in resumed.', {
                    title: `Resume ${nickname}'s sign-in`,
                    description: `${nickname} will be able to sign in alone again.`,
                    confirmLabel: 'Resume sign-in',
                  })
                }
              >
                Resume sign-in
              </button>
            ) : (
              <button
                type="button"
                className={styles.buttonSecondary}
                disabled={busy}
                onClick={() => void act(() => api.suspend(childId), 'Sign-in paused.')}
              >
                Pause sign-in
              </button>
            )}
            <button
              type="button"
              className={styles.buttonSecondary}
              disabled={busy}
              onClick={() =>
                void act(() => api.signOutEverywhere(childId), 'Signed out everywhere.')
              }
            >
              Sign out everywhere
            </button>
            <button
              type="button"
              className={styles.buttonDanger}
              disabled={busy}
              onClick={() => setConfirmingRemove(true)}
            >
              Remove sign-in
            </button>
          </div>
          {confirmingRemove ? (
            <div role="alertdialog" aria-labelledby="remove-title" className={styles.notice}>
              <p id="remove-title">
                <strong>Remove {nickname}&apos;s sign-in?</strong> {nickname} will not be able to
                sign in alone. Their profile and progress stay.
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.buttonDanger}
                  disabled={busy}
                  onClick={() => {
                    setConfirmingRemove(false);
                    void act(() => api.remove(childId), 'Sign-in removed.', {
                      title: `Remove ${nickname}'s sign-in`,
                      description: `${nickname}'s profile and progress stay.`,
                      confirmLabel: 'Remove sign-in',
                      destructive: true,
                    });
                  }}
                >
                  Yes, remove sign-in
                </button>
                <button
                  type="button"
                  className={styles.buttonSecondary}
                  onClick={() => setConfirmingRemove(false)}
                >
                  Keep sign-in
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {signIn ? (
        <section className={styles.section} aria-labelledby="signin-devices">
          <h2 id="signin-devices">Remembered devices</h2>
          {devices.length === 0 ? (
            <p className={styles.muted}>No devices are remembered.</p>
          ) : (
            <ul className={styles.list}>
              {devices.map((device, index) => (
                <li key={device.id}>
                  Device {index + 1}: remembered {when(device.rememberedAt)}, last used{' '}
                  {when(device.lastUsedAt)}, until {when(device.expiresAt)}{' '}
                  <button
                    type="button"
                    className={styles.buttonSecondary}
                    disabled={busy}
                    onClick={() => void handleForget(device)}
                    aria-label={`Forget device ${index + 1}`}
                  >
                    Forget
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="signin-changes">
        <h2 id="signin-changes">Recent changes</h2>
        {overview.recentChanges.length === 0 ? (
          <p className={styles.muted}>Nothing has changed yet.</p>
        ) : (
          <ul className={styles.list}>
            {overview.recentChanges.map((change, index) => (
              <li key={`${change.occurredAt}-${index}`}>
                {CHANGE_LABELS[change.action] ?? 'Sign-in changed'}, {when(change.occurredAt)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="signin-more">
        <h2 id="signin-more">Other controls for {nickname}</h2>
        <p className={styles.muted}>
          AI, voice, learning settings and deleting {nickname}&apos;s data are not changed by
          signing in alone. They stay under your control.
        </p>
        <ul className={styles.list}>
          <li>
            <Link to={`/home/children/${childId}/edit`}>Profile, voice and AI settings</Link>
          </li>
          <li>
            <Link to={`/home/children/${childId}/dashboard`}>
              Progress, learning settings and deletion
            </Link>
          </li>
        </ul>
      </section>
      {sensitive.dialog}
    </div>
  );
}
