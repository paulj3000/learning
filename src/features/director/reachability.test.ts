/**
 * The Director must not suggest an adventure on an island the child has not
 * opened the route to (docs/ROADMAP.md Phase 29).
 *
 * No mocking needed: `reachableAdventures` is pure and takes the world
 * changes a caller already fetched, so the real world registry, the real
 * travel rules, and the real authored content all take part directly. A
 * test that stubbed the content too would prove the filter runs and
 * nothing about whether it is wired to anything real.
 */
import { describe, expect, it } from 'vitest';
import { reachableAdventures } from './reachability';

describe('reachableAdventures', () => {
  it('leaves out the second world until its route opens', () => {
    const slugs = reachableAdventures([], 'PATHFINDER').map((template) => template.slug);

    expect(slugs).toContain('repair-the-moonlight-bridge');
    expect(slugs).not.toContain('the-morning-care-round');
  });

  it('includes the cove once the child has helped Pip at the bay', () => {
    const slugs = reachableAdventures(['BRIDGE_REPAIRED'], 'PATHFINDER').map(
      (template) => template.slug,
    );

    expect(slugs).toContain('the-morning-care-round');
  });

  /**
   * Explorers reach the same route by a different act, so the same
   * assertion has to hold for the key their band actually records.
   */
  it('includes the cove for an Explorer who set the tide gate', () => {
    const slugs = reachableAdventures(['TIDE_GATE_SET'], 'EXPLORER').map(
      (template) => template.slug,
    );

    expect(slugs).toContain('the-cove-care-plan');
  });

  /** Story arcs sit at pseudo-locations on no map and must never be filtered. */
  it('keeps every story arc challenge whatever the child has travelled to', () => {
    const slugs = reachableAdventures([], 'PATHFINDER').map((template) => template.slug);

    expect(slugs).toContain('dragon-chapter-1-broken-path');
  });
});
