import { describe, expect, it, vi } from 'vitest';

const ai = vi.hoisted(() => ({
  generateCompanionTurn: vi.fn(),
  generateTutorTurn: vi.fn(),
  recordInteractionAudit: vi.fn(),
  recordSafetyEvent: vi.fn(),
}));
vi.mock('../../api/ai', () => ({ aiApi: ai }));

import { unsupported } from '../../api/select';
import { requestCompanionTurn } from './api';

describe('companion turn on a backend with no AI service (Django, LAI-0501B)', () => {
  it('shows the authored line and keeps going when generation and auditing are unavailable', async () => {
    ai.generateCompanionTurn.mockRejectedValueOnce(unsupported('ai'));
    ai.recordInteractionAudit.mockRejectedValueOnce(unsupported('ai'));

    const result = await requestCompanionTurn({
      childProfileId: 'child-1',
      ageBand: 'PATHFINDER',
      intent: 'HINT',
      stepSummary: 'counting missing planks',
      authoredBaseText: 'Count the planks again.',
    });

    expect(result.source).toBe('FALLBACK');
    expect(result.turn.spokenText).toBe('Count the planks again.');
    expect(ai.recordInteractionAudit).toHaveBeenCalledWith(
      expect.objectContaining({ validationStatus: 'ERROR', fallbackUsed: true }),
    );
  });
});
