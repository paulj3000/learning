import { describe, expect, it, vi, beforeEach } from 'vitest';

const { list, create } = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../../lib/data-client', () => ({
  client: {
    models: {
      AdventureSession: { list, create },
    },
  },
}));

import { resumeOrStartSession } from './api';
import { REPAIR_THE_MOONLIGHT_BRIDGE } from './content';

describe('resumeOrStartSession', () => {
  beforeEach(() => {
    list.mockReset();
    create.mockReset();
  });

  it('reuses an existing active session for this child and template instead of creating a new one', async () => {
    const active = {
      id: 'session-1',
      childProfileId: 'child-1',
      templateSlug: REPAIR_THE_MOONLIGHT_BRIDGE.slug,
      status: 'ACTIVE',
    };
    list.mockResolvedValueOnce({ data: [active] });

    const result = await resumeOrStartSession('child-1', REPAIR_THE_MOONLIGHT_BRIDGE);

    expect(result).toBe(active);
    expect(create).not.toHaveBeenCalled();
  });

  it('starts a new session at the definition entry step when none is active', async () => {
    list.mockResolvedValueOnce({ data: [] });
    const created = { id: 'session-2', currentStepId: REPAIR_THE_MOONLIGHT_BRIDGE.entryStepId };
    create.mockResolvedValueOnce({ data: created, errors: undefined });

    const result = await resumeOrStartSession('child-1', REPAIR_THE_MOONLIGHT_BRIDGE);

    expect(result).toBe(created);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        childProfileId: 'child-1',
        templateSlug: REPAIR_THE_MOONLIGHT_BRIDGE.slug,
        templateVersion: REPAIR_THE_MOONLIGHT_BRIDGE.version,
        currentStepId: REPAIR_THE_MOONLIGHT_BRIDGE.entryStepId,
        status: 'ACTIVE',
      }),
    );
  });

  it('ignores another child or template active session when deciding whether to start a new one', async () => {
    list.mockResolvedValueOnce({
      data: [
        { id: 'other', childProfileId: 'child-2', templateSlug: 'other-slug', status: 'ACTIVE' },
      ],
    });
    create.mockResolvedValueOnce({ data: { id: 'session-3' }, errors: undefined });

    await resumeOrStartSession('child-1', REPAIR_THE_MOONLIGHT_BRIDGE);

    expect(create).toHaveBeenCalledTimes(1);
  });
});
