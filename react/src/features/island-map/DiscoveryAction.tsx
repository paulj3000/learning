import { useEffect, useRef, useState } from 'react';
import { getDiscoveryDefinition, recordDiscovery } from '../discovery/api';
import type { DiscoveryOutcome } from '../discovery/discovery';

interface DiscoveryActionProps {
  childId: string;
  discoveryId: string;
  /** Re-reads the world after a successful find, so a newly opened door stops being locked. */
  onDiscovered: () => void;
}

/**
 * Renders one `DISCOVER` world action (docs/ROADMAP.md Phase 26).
 *
 * Shared by the four regions that hide something, rather than copied into
 * each `InteractionPanelAction` the way `SHOW_MESSAGE` is, because unlike
 * that one it makes a write and has three outcomes to render. The world
 * views stay parallel in every other respect.
 *
 * It records on mount rather than behind a button: the child already did the
 * thing that finds a secret, which was walking there or tapping it. Asking
 * them to confirm "yes, discover it" would put a step between the action and
 * its consequence for no gain.
 *
 * A locked secret is not an error and is not styled as one. It shows the
 * authored `lockedMessage`, which describes what is there and leaves a
 * thread to pull (docs/UX_AND_ACCESSIBILITY.md, calm engagement).
 */
export function DiscoveryAction({ childId, discoveryId, onDiscovered }: DiscoveryActionProps) {
  const [outcome, setOutcome] = useState<DiscoveryOutcome | null>(null);
  const [rewardMessages, setRewardMessages] = useState<readonly string[]>([]);
  const [failed, setFailed] = useState(false);

  /**
   * Held in a ref rather than named as a dependency below. The parent passes
   * a fresh arrow on every render, and a successful find calls it, which
   * re-renders the parent - so depending on it directly would re-run the
   * write in a loop. `childId` and `discoveryId` are what identify this
   * look, and they are the only things that should re-run it.
   */
  const onDiscoveredRef = useRef(onDiscovered);
  onDiscoveredRef.current = onDiscovered;

  useEffect(() => {
    let cancelled = false;
    const definition = getDiscoveryDefinition(discoveryId);
    if (!definition) {
      setFailed(true);
      return;
    }

    void recordDiscovery(childId, definition)
      .then((result) => {
        if (cancelled) return;
        setOutcome(result.outcome);
        setRewardMessages(result.rewardMessages);
        if (result.outcome.status === 'FOUND_NOW') {
          onDiscoveredRef.current();
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [childId, discoveryId]);

  if (failed) {
    return <p>You look around, but it is too dark to see anything just now.</p>;
  }
  if (!outcome) {
    return <p>You look closer...</p>;
  }

  return (
    <div>
      <p>{outcome.message}</p>
      {rewardMessages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}
