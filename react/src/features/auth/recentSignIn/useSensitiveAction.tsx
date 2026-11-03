import { useCallback, useState, type ReactNode } from 'react';
import { RecentSignInDialog, type SensitivePrompt } from './RecentSignInDialog';
import { isRecentAuthRequired, type ReauthDeps } from './recentSignIn';

export type SensitiveResult<T> = { status: 'done'; value: T } | { status: 'cancelled' };

interface Pending {
  prompt: SensitivePrompt;
  action: () => Promise<unknown>;
  resolve: (result: SensitiveResult<unknown>) => void;
  reject: (error: unknown) => void;
}

/**
 * Runs a sensitive Django request (LAI-0209). If Django answers
 * `recent_auth_required`, the returned `dialog` asks the parent to sign in
 * again and then to confirm, and only then runs `action` a second and last
 * time. Any other error is thrown to the caller as before. The caller's page
 * stays mounted throughout, so its form, file and other state are kept.
 *
 * Render `dialog` somewhere in the page.
 */
export function useSensitiveAction(deps?: ReauthDeps): {
  run: <T>(action: () => Promise<T>, prompt: SensitivePrompt) => Promise<SensitiveResult<T>>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);

  const run = useCallback(
    async <T,>(action: () => Promise<T>, prompt: SensitivePrompt): Promise<SensitiveResult<T>> => {
      try {
        return { status: 'done', value: await action() };
      } catch (error) {
        if (!isRecentAuthRequired(error)) throw error;
      }
      return new Promise<SensitiveResult<T>>((resolve, reject) => {
        setPending({
          prompt,
          action,
          resolve: resolve as (result: SensitiveResult<unknown>) => void,
          reject,
        });
      });
    },
    [],
  );

  const dialog = pending ? (
    <RecentSignInDialog
      prompt={pending.prompt}
      deps={deps}
      onConfirm={pending.action}
      onDone={(value) => {
        setPending(null);
        pending.resolve({ status: 'done', value });
      }}
      onCancel={() => {
        setPending(null);
        pending.resolve({ status: 'cancelled' });
      }}
      onError={(error) => {
        setPending(null);
        pending.reject(error);
      }}
    />
  ) : null;

  return { run, dialog };
}
