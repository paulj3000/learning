import { PortalButton, type PortalButtonProps } from '../ui';
import { useIslandExit } from './IslandExitContext';
import { LEAVE_ISLAND_COPY } from './copy';

type LeaveIslandButtonProps = Omit<PortalButtonProps, 'onClick' | 'children' | 'asChild'>;

/**
 * The child's own way back to the Island Explorer (AP-04). Renders nothing
 * outside child mode, so a shared component (the 3D stage) can include it
 * unconditionally. While saves flush it stays visible but disabled, and says
 * so, rather than disappearing under the child's finger.
 */
export function LeaveIslandButton({ tone = 'coral', ...props }: LeaveIslandButtonProps) {
  const exit = useIslandExit();
  if (!exit) return null;
  return (
    <PortalButton
      tone={tone}
      data-leave-island=""
      disabled={exit.isLeaving}
      aria-busy={exit.isLeaving || undefined}
      onClick={() => exit.requestLeave()}
      {...props}
    >
      {exit.isLeaving ? LEAVE_ISLAND_COPY.leaving : LEAVE_ISLAND_COPY.leave}
    </PortalButton>
  );
}
