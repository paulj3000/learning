import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import styles from './IslandLayout.module.css';
import { CalmStop } from '../session/CalmStop';
import { useSessionClock } from '../session/useSessionClock';
import { ChildShell } from '../portal/shell';
import { PortalButton } from '../portal/ui';
import {
  IslandExitProvider,
  LeaveIslandButton,
  LEAVE_ISLAND_COPY,
  isIslandExplorerPath,
  useIslandExit,
} from '../portal/exit';

interface IslandLayoutProps {
  childId: string;
  children: ReactNode;
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
 * back to the Island Explorer: leaving an Island, Place, 3D Area or Adventure
 * is navigation, not a learning check. The adult exit goes to the parent
 * space; by the owner's decision of 2026-11-10 it has no arithmetic check
 * either (docs/THREAT_MODEL.md, Spoofing, records the accepted risk). Both
 * first flush any save still in flight (`IslandExitProvider`) and only
 * confirm, with two plain buttons, when an encounter is open. Unmounting the
 * route tears down any 3D scene.
 *
 * It is also where the session clock lives, for the same reason: it wraps
 * every child-mode screen, so there is exactly one clock and it survives
 * walking from the map into an adventure and back. A region that stages the
 * stop in its own world (Storykeeper Castle does) reads the same clock
 * rather than starting a second one.
 */
export function IslandLayout({ childId, children }: IslandLayoutProps) {
  const { pathname } = useLocation();
  const { limitReached } = useSessionClock(childId);
  const onExplorer = isIslandExplorerPath(pathname, childId);

  return (
    <IslandExitProvider childId={childId}>
      <ChildShell
        childId={childId}
        mainClassName={styles.main}
        actions={
          <>
            {onExplorer ? null : <LeaveIslandButton className="mr-auto" />}
            <ParentSpaceButton />
          </>
        }
        overlays={<CalmStop limitReached={limitReached} />}
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
