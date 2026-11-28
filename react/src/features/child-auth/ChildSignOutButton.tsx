import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PortalButton } from '../portal/ui';
import { CHILD_SIGN_IN_COPY as COPY } from './childSignInCopy';
import { useChildSession } from './ChildSessionContext';

/** The child's own sign-out. Renders nothing unless a child signed in on their own. */
export function ChildSignOutButton() {
  const { status, signOut } = useChildSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (status !== 'signedIn') return null;
  return (
    <PortalButton
      tone="quiet"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void signOut().finally(() => {
          setBusy(false);
          navigate('/sign-in', { replace: true });
        });
      }}
    >
      {busy ? COPY.signingOut : COPY.signOut}
    </PortalButton>
  );
}
