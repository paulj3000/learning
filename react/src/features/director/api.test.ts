import { describe, expect, it, vi } from 'vitest';

const { fetchNext } = vi.hoisted(() => ({ fetchNext: vi.fn() }));
vi.mock('../../api/director', () => ({ directorApi: { fetchNextLearningActivity: fetchNext } }));

import { unsupported } from '../../api/select';
import { getNextLearningActivity, NO_SUGGESTION } from './api';

describe('getNextLearningActivity', () => {
  it('maps the server ranking and keeps the personalized flag', async () => {
    fetchNext.mockResolvedValueOnce({
      hasPersonalizedSignal: true,
      suggestions: [
        {
          adventureSlug: 'repair-the-moonlight-bridge',
          title: 'Repair the Moonlight Bridge',
          score: 3,
          reasons: [{ kind: 'CONTINUES_STORY', storyId: 's1' }, null, { kind: 'WHO_KNOWS' }],
        },
      ],
    });
    await expect(getNextLearningActivity('child-1')).resolves.toEqual({
      hasPersonalizedSignal: true,
      ranking: [
        {
          adventureSlug: 'repair-the-moonlight-bridge',
          title: 'Repair the Moonlight Bridge',
          score: 3,
          reasons: [{ kind: 'CONTINUES_STORY', storyId: 's1' }, { kind: 'NO_SKILLS_NEEDED' }],
        },
      ],
    });
    expect(fetchNext).toHaveBeenCalledWith('child-1');
  });

  it('shows no suggestion, never an invented one, when the backend has no Director', async () => {
    fetchNext.mockRejectedValueOnce(unsupported('director'));
    await expect(getNextLearningActivity('child-1')).resolves.toBe(NO_SUGGESTION);
  });
});
