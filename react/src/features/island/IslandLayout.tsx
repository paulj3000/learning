import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import styles from './IslandLayout.module.css';
import { ChildShell } from '../portal/shell';
import { PortalButton } from '../portal/ui';
import {
  IslandExitProvider,
  LeaveIslandButton,
  LEAVE_ISLAND_COPY,
  isPortalHubPath,
  useIslandExit,
} from '../portal/exit';

interface IslandLayoutProps {
  childId: string;
  children: ReactNode;
  /** The child's picture and nickname for the top bar, when the page has them (AP-03). */
  profile?: ReactNode;
}

export const LEAVE_ISLAND_LABEL = LEAVE_ISLAND_COPY.leave;

/**
 * Shared chrome for every child-mode screen: consistent navigation, a child
 * exit, and a parent-gated exit (docs/UX_AND_ACCESSIBILITY.md "Use
 * consistent placement for companion, progress path, help, and exit").
 * Since AP-01 the chrome is the Adventure Portal's `ChildShell`: a bottom bar
 * on phones, a sidebar from tablet up.
 *
 * Neither exit asks a question (AP-04). "Leave island" is the child's own way
 * back to the Realm Explorer (AP-03): leaving an Island, Place, 3D Area or Adventure
 * is navigation, not a learning check. The adult exit goes to the parent
 * space; by the owner's decision of 2026-11-10 it has no arithmetic check
 * either (docs/THREAT_MODEL.md, Spoofing, records the accepted risk). Both
 * first flush any save still in flight (`IslandExitProvider`) and only
 * confirm, with two plain buttons, when an encounter is open. Unmounting the
 * route tears down any 3D scene.
 *
 * There is no session clock here or anywhere: a child is never stopped,
 * counted down, or nudged to leave because of how long they have played.
 */
export function IslandLayout({ childId, children, profile }: IslandLayoutProps) {
  const { pathname } = useLocation();
  const onHub = isPortalHubPath(pathname, childId);

  return (
    <IslandExitProvider childId={childId}>
      <ChildShell
        childId={childId}
        mainClassName={styles.main}
        profile={profile}
        actions={
          <>
            {onHub ? null : <LeaveIslandButton />}
            <ParentSpaceButton />
          </>
        }
      >
        {children}
      </ChildShell>
    </IslandExitProvider>
  );
}

/** The adult exit: saves like "Leave island", then opens the parent space. No check. */
function ParentSpaceButton() {
  const exit = useIslandExit();
  return (
    <PortalButton
      tone="quiet"
      disabled={exit?.isLeaving}
      onClick={() => exit?.requestLeave('parent-space')}
    >
      Adults: exit to parent space
    </PortalButton>
  );
}
