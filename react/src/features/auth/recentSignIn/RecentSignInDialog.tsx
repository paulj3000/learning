import {
  useEffect,
  useId,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import styles from './RecentSignInDialog.module.css';
import {
  currentIdentity,
  endReauthentication,
  isRecentAuthRequired,
  verifyRecentSignIn,
  type ReauthDeps,
  type ReauthIdentity,
} from './recentSignIn';

/** What the parent is asked to confirm after verifying. Plain words, no private details. */
export interface SensitivePrompt {
  /** For example "Delete Bramble's profile". */
  title: string;
  /** What will happen, for example "This deletes every adventure and cannot be undone." */
  description: string;
  /** The confirm button, for example "Delete profile". */
  confirmLabel: string;
  /** Styles the confirm button as destructive. */
  destructive?: boolean;
}

type Stage =
  | { name: 'checking' }
  | { name: 'password'; error: string | null }
  | { name: 'verifying' }
  | { name: 'confirm' }
  | { name: 'running' }
  | { name: 'ended'; message: string };

export const RECENT_SIGN_IN_COPY = {
  heading: 'Please confirm it is you',
  explain:
    'For your safety, this change needs a fresh sign-in. Enter your password to continue. Nothing has been changed yet.',
  verify: 'Confirm sign-in',
  verifying: 'Checking...',
  cancel: 'Cancel',
  verified: 'Thank you. Your sign-in is confirmed.',
  running: 'Working on it...',
  close: 'Close',
  passwordMissing: 'Please enter your password.',
  expired: 'Your sign-in has ended. Please sign in again, then try once more.',
  incomplete: 'Your account needs another step to sign in. Please sign in from the sign-in page.',
  wrongAccount: 'That sign-in was for a different account. Please sign in again.',
  stillRequired:
    'We still could not confirm your sign-in, so nothing was changed. Please try again in a few minutes.',
} as const;

interface RecentSignInDialogProps {
  prompt: SensitivePrompt;
  /** Runs the action once, after the parent confirms. */
  onConfirm: () => Promise<unknown>;
  onDone: (value: unknown) => void;
  onCancel: () => void;
  onError: (error: unknown) => void;
  deps?: ReauthDeps;
}

/**
 * Shown when Django answers `recent_auth_required` (LAI-0209). Three steps:
 * sign in again with Cognito, confirm the action explicitly, then run it
 * once. It never retries by itself, and a second `recent_auth_required`
 * ends the attempt instead of asking again.
 */
export function RecentSignInDialog({
  prompt,
  onConfirm,
  onDone,
  onCancel,
  onError,
  deps,
}: RecentSignInDialogProps) {
  const ids = useId();
  const [stage, setStage] = useState<Stage>({ name: 'checking' });
  const [identity, setIdentity] = useState<ReauthIdentity | null>(null);
  const [password, setPassword] = useState('');

  useEffect(() => {
    let active = true;
    void currentIdentity(deps).then((found) => {
      if (!active) return;
      setIdentity(found);
      setStage(
        found
          ? { name: 'password', error: null }
          : { name: 'ended', message: RECENT_SIGN_IN_COPY.expired },
      );
    });
    return () => {
      active = false;
    };
  }, [deps]);

  const busy = stage.name === 'checking' || stage.name === 'verifying' || stage.name === 'running';

  function cancel() {
    if (busy) return;
    setPassword('');
    endReauthentication();
    onCancel();
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!identity || busy) return;
    if (!password) {
      setStage({ name: 'password', error: RECENT_SIGN_IN_COPY.passwordMissing });
      return;
    }
    const attempt = password;
    setPassword(''); // the password is used once and never kept
    setStage({ name: 'verifying' });
    const outcome = await verifyRecentSignIn(identity, attempt, deps);
    switch (outcome.status) {
      case 'verified':
        setStage({ name: 'confirm' });
        return;
      case 'failed':
        setStage({ name: 'password', error: outcome.message });
        return;
      case 'incomplete':
        setStage({ name: 'ended', message: RECENT_SIGN_IN_COPY.incomplete });
        return;
      case 'wrong_account':
        setStage({ name: 'ended', message: RECENT_SIGN_IN_COPY.wrongAccount });
        return;
    }
  }

  async function handleConfirm() {
    if (busy) return;
    setStage({ name: 'running' });
    let value: unknown;
    try {
      value = await onConfirm();
    } catch (error) {
      if (isRecentAuthRequired(error)) {
        setStage({ name: 'ended', message: RECENT_SIGN_IN_COPY.stillRequired });
        return;
      }
      endReauthentication();
      onError(error);
      return;
    }
    endReauthentication();
    onDone(value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancel();
    }
  }

  const titleId = `${ids}-title`;
  const descriptionId = `${ids}-description`;
  const passwordId = `${ids}-password`;
  const confirmClass = prompt.destructive ? styles.buttonDanger : styles.button;

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.card}>
        <h2 className={styles.heading} id={titleId}>
          {stage.name === 'confirm' || stage.name === 'running'
            ? prompt.title
            : RECENT_SIGN_IN_COPY.heading}
        </h2>

        {stage.name === 'checking' ? (
          <output className={styles.status} id={descriptionId}>
            {RECENT_SIGN_IN_COPY.verifying}
          </output>
        ) : null}

        {stage.name === 'password' || stage.name === 'verifying' ? (
          <form className={styles.form} onSubmit={(e) => void handleVerify(e)} noValidate>
            <p className={styles.lead} id={descriptionId}>
              {RECENT_SIGN_IN_COPY.explain}
            </p>
            <label className={styles.label} htmlFor={passwordId}>
              Password
            </label>
            <input
              id={passwordId}
              className={styles.input}
              type="password"
              autoComplete="current-password"
              autoFocus
              disabled={stage.name === 'verifying'}
              value={password}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
            />
            {stage.name === 'password' && stage.error ? (
              <p className={styles.error} role="alert">
                {stage.error}
              </p>
            ) : null}
            <div className={styles.actions}>
              <button
                className={styles.buttonSecondary}
                type="button"
                disabled={stage.name === 'verifying'}
                onClick={cancel}
              >
                {RECENT_SIGN_IN_COPY.cancel}
              </button>
              <button className={styles.button} type="submit" disabled={stage.name === 'verifying'}>
                {stage.name === 'verifying'
                  ? RECENT_SIGN_IN_COPY.verifying
                  : RECENT_SIGN_IN_COPY.verify}
              </button>
            </div>
          </form>
        ) : null}

        {stage.name === 'confirm' || stage.name === 'running' ? (
          <>
            <output className={styles.status}>
              {stage.name === 'running'
                ? RECENT_SIGN_IN_COPY.running
                : RECENT_SIGN_IN_COPY.verified}
            </output>
            <p className={styles.lead} id={descriptionId}>
              {prompt.description}
            </p>
            <div className={styles.actions}>
              <button
                className={styles.buttonSecondary}
                type="button"
                disabled={stage.name === 'running'}
                onClick={cancel}
              >
                {RECENT_SIGN_IN_COPY.cancel}
              </button>
              <button
                className={confirmClass}
                type="button"
                autoFocus
                disabled={stage.name === 'running'}
                onClick={() => void handleConfirm()}
              >
                {prompt.confirmLabel}
              </button>
            </div>
          </>
        ) : null}

        {stage.name === 'ended' ? (
          <>
            <p className={styles.error} id={descriptionId} role="alert">
              {stage.message}
            </p>
            <div className={styles.actions}>
              <button className={styles.button} type="button" autoFocus onClick={cancel}>
                {RECENT_SIGN_IN_COPY.close}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
