import { Link } from 'react-router-dom';
import { showDevHints } from '../auth/authNoticeCopy';
import { REALM_NOTICE_COPY, type RealmLoadFailure } from './realmLoadFailure';
import { PortalButton } from '../portal/ui';

/**
 * What the Realm pages say when they cannot show Realms (P0 fix). They used to send the child
 * back to Home without a word, which looked like the Realms button was broken. Now they say
 * what happened in plain words and offer the next step. Child-facing copy never names a
 * backend, a port or a setting; a local `vite dev` build adds one developer line.
 */

const DEV_FAILURE_HINT: Record<RealmLoadFailure, string> = {
  timeout:
    'Developer note: /api did not answer in time. Is Django running on the port the Vite proxy targets (DJANGO_DEV_PORT)? See the "[lai] dev" lines printed by npm run dev.',
  network:
    'Developer note: /api could not be reached. Start Django (make runserver) and check DJANGO_DEV_PORT matches it.',
  'signed-out':
    'Developer note: Django rejected the Cognito token. Check that COGNITO_* in the root .env name the same pool and client as VITE_COGNITO_*.',
  server: 'Developer note: Django answered with a server error. Check the runserver console.',
  other: 'Developer note: see the browser console and the runserver console.',
};

/** The catalog read failed. Always offers a next step; never waits forever (bounded client). */
export function RealmLoadError({
  message,
  failure,
  onRetry,
}: {
  message: string;
  failure: RealmLoadFailure;
  onRetry: () => void;
}) {
  const why = REALM_NOTICE_COPY.failure[failure];
  return (
    <div
      className="flex flex-col items-start gap-3 rounded-2xl bg-coral-50 px-4 py-4 text-ink"
      role="alert"
      data-failure={failure}
    >
      <p className="m-0">{message}</p>
      {why ? <p className="m-0">{why}</p> : null}
      {failure === 'signed-out' ? (
        <PortalButton asChild tone="ocean">
          <Link to="/sign-in">{REALM_NOTICE_COPY.signIn}</Link>
        </PortalButton>
      ) : (
        <PortalButton tone="ocean" onClick={onRetry}>
          {REALM_NOTICE_COPY.tryAgain}
        </PortalButton>
      )}
      {showDevHints() ? <p className="m-0 text-sm">{DEV_FAILURE_HINT[failure]}</p> : null}
    </div>
  );
}
