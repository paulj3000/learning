import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { createExitCoordinator, type ExitParticipant } from './exitCoordinator';
import { realmExplorerPath, type LeftIslandState } from './adventureRoutes';
import { LeaveIslandConfirm } from './LeaveIslandConfirm';

/**
 * Where an exit goes: the child's Realm Explorer ("Leave island", AP-03), or the
 * parent space (the adult exit, which has no check since the owner's
 * 2026-11-10 decision).
 */
export type IslandExitDestination = 'island-explorer' | 'parent-space';

export interface IslandExit {
  /**
   * Start leaving: confirm if something is mid-way, then save and go to the
   * destination (the Realm Explorer unless told otherwise).
   */
  requestLeave(destination?: IslandExitDestination): void;
  /** True between the tap and the navigation, while saves flush. */
  isLeaving: boolean;
  /** For participants: register with `useExitParticipant` instead of calling this. */
  register(participant: ExitParticipant): () => void;
}

const IslandExitContext = createContext<IslandExit | null>(null);

interface IslandExitProviderProps {
  childId: string;
  children: ReactNode;
  /** Test seam: how long a slow save may hold the exit. */
  saveTimeoutMs?: number;
}

/**
 * One exit per child-mode screen (AP-04), provided by `IslandLayout` so every
 * island, place, 3D area and adventure shares it, and the 3D stage can offer
 * the same button inside full screen.
 *
 * Leaving is navigation, never a learning check: there is no arithmetic,
 * quiz or other challenge anywhere on this path. The adult exit to the
 * parent space uses the same path (save, confirm only mid-encounter) and,
 * by the owner's decision of 2026-11-10, has no check either.
 */
export function IslandExitProvider({ childId, children, saveTimeoutMs }: IslandExitProviderProps) {
  const navigate = useNavigate();
  const coordinator = useMemo(() => createExitCoordinator(), []);
  const [confirming, setConfirming] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const leavingRef = useRef(false);
  const destinationRef = useRef<IslandExitDestination>('island-explorer');

  const leaveNow = useCallback(async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setConfirming(false);
    setIsLeaving(true);
    // Never rejects and never hangs (see exitCoordinator.ts).
    await coordinator.saveAll({ timeoutMs: saveTimeoutMs });
    if (destinationRef.current === 'parent-space') {
      navigate('/home');
      return;
    }
    const state: LeftIslandState = { leftIsland: true };
    navigate(realmExplorerPath(childId), { state });
  }, [childId, coordinator, navigate, saveTimeoutMs]);

  const requestLeave = useCallback(
    (destination: IslandExitDestination = 'island-explorer') => {
      if (leavingRef.current) return;
      destinationRef.current = destination;
      if (coordinator.needsConfirm()) {
        setConfirming(true);
        return;
      }
      void leaveNow();
    },
    [coordinator, leaveNow],
  );

  const value = useMemo<IslandExit>(
    () => ({ requestLeave, isLeaving, register: coordinator.register }),
    [coordinator, isLeaving, requestLeave],
  );

  return (
    <IslandExitContext.Provider value={value}>
      {children}
      {confirming ? (
        <LeaveIslandConfirm onLeave={() => void leaveNow()} onStay={() => setConfirming(false)} />
      ) : null}
    </IslandExitContext.Provider>
  );
}

/** The exit, or `null` outside child mode (an admin preview, a bare test render). */
export function useIslandExit(): IslandExit | null {
  return useContext(IslandExitContext);
}

/**
 * Registers something that must be saved, or confirmed, before leaving. The
 * latest `save`/`needsConfirm` are always used, so callers can pass inline
 * functions without re-registering on every render.
 */
export function useExitParticipant(participant: ExitParticipant): void {
  const exit = useIslandExit();
  const latest = useRef(participant);
  useEffect(() => {
    latest.current = participant;
  });
  const register = exit?.register;
  useEffect(() => {
    if (!register) return undefined;
    return register({
      save: () => latest.current.save(),
      needsConfirm: () => latest.current.needsConfirm?.() ?? false,
    });
  }, [register]);
}
