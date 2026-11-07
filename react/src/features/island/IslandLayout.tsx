import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styles from './IslandLayout.module.css';
import { ParentGate } from '../child-profile/ParentGate';
import { CalmStop } from '../session/CalmStop';
import { useSessionClock } from '../session/useSessionClock';
import { ChildShell } from '../portal/shell';
import { PortalButton } from '../portal/ui';
import {
  IslandExitProvider,
  LeaveIslandButton,
  LEAVE_ISLAND_COPY,
  isIslandExplorerPath,
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
 * The two exits are different promises. "Leave island" is the child's own
 * way back to the Island Explorer and never asks a question (AP-04): leaving
 * an Island, Place, 3D Area or Adventure is navigation, not a learning
 * check. It first flushes any save still in flight (`IslandExitProvider`),
 * and only confirms, with two plain buttons, when an encounter is open.
 * Unmounting the route tears down any 3D scene. The adult exit goes to the
 * parent space, whose profile and settings pages have no gate of their own,
 * so it keeps the `ParentGate` (docs/THREAT_MODEL.md, Spoofing).
 *
 * It is also where the session clock lives, for the same reason: it wraps
 * every child-mode screen, so there is exactly one clock and it survives
 * walking from the map into an adventure and back. A region that stages the
 * stop in its own world (Storykeeper Castle does) reads the same clock
 * rather than starting a second one.
 */
export function IslandLayout({ childId, children }: IslandLayoutProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [showGate, setShowGate] = useState(false);
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
            <PortalButton tone="quiet" onClick={() => setShowGate(true)}>
              Adults: exit to parent space
            </PortalButton>
          </>
        }
        overlays={
          <>
            <CalmStop limitReached={limitReached} />
            {showGate ? (
              <ParentGate
                title="Return to parent space?"
                description="Answer this quick check to leave the island and manage profiles."
                onCancel={() => setShowGate(false)}
                onSuccess={() => navigate('/home')}
              />
            ) : null}
          </>
        }
      >
        {children}
      </ChildShell>
    </IslandExitProvider>
  );
}
