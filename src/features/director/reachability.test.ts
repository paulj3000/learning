/**
 * The Director must not suggest an adventure on an island the child has not
 * opened the route to (docs/ROADMAP.md Phase 29).
 *
 * Mocks only the Adventure Engine's world-change read, the same pattern
 * `companion/api.test.ts` uses, so the real world registry, the real travel
 * rules, and the real authored content all take part. A test that stubbed
 * the content too would prove the filter runs and nothing about whether it
 * is wired to anything real.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { listAllWorldChanges } = vi.hoisted(() => ({ listAllWorldChanges: vi.fn() }));

vi.mock('../adventures/api', () => ({
  listAllWorldChanges,
  listSessions: vi.fn(async () => []),
}));

import { listReachableAdventures } from './api';

const change = (changeKey: string) => ({ changeKey });

describe('listReachableAdventures', () => {
  beforeEach(() => {
    listAllWorldChanges.mockReset();
  });

  it('leaves out the second world until its route opens', async () => {
    listAllWorldChanges.mockResolvedValue([]);

    const slugs = (await listReachableAdventures('child-1', 'PATHFINDER')).map(
      (template) => template.slug,
    );

    expect(slugs).toContain('repair-the-moonlight-bridge');
    expect(slugs).not.toContain('the-morning-care-round');
  });

  it('includes the cove once the child has helped Pip at the bay', async () => {
    listAllWorldChanges.mockResolvedValue([change('BRIDGE_REPAIRED')]);

    const slugs = (await listReachableAdventures('child-1', 'PATHFINDER')).map(
      (template) => template.slug,
    );

    expect(slugs).toContain('the-morning-care-round');
  });

  /**
   * Explorers reach the same route by a different act, so the same
   * assertion has to hold for the key their band actually records.
   */
  it('includes the cove for an Explorer who set the tide gate', async () => {
    listAllWorldChanges.mockResolvedValue([change('TIDE_GATE_SET')]);

    const slugs = (await listReachableAdventures('child-1', 'EXPLORER')).map(
      (template) => template.slug,
    );

    expect(slugs).toContain('the-cove-care-plan');
  });

  /** Story arcs sit at pseudo-locations on no map and must never be filtered. */
  it('keeps every story arc challenge whatever the child has travelled to', async () => {
    listAllWorldChanges.mockResolvedValue([]);

    const slugs = (await listReachableAdventures('child-1', 'PATHFINDER')).map(
      (template) => template.slug,
    );

    expect(slugs).toContain('dragon-chapter-1-broken-path');
  });

  /** A failed read must not empty the island; it degrades to home only. */
  it('falls back to the always-reachable worlds when world changes cannot be read', async () => {
    listAllWorldChanges.mockRejectedValue(new Error('offline'));

    const slugs = (await listReachableAdventures('child-1', 'PATHFINDER')).map(
      (template) => template.slug,
    );

    expect(slugs).toContain('repair-the-moonlight-bridge');
    expect(slugs).not.toContain('the-morning-care-round');
  });
});
