import { describe, expect, it } from 'vitest';
import { servedStepToAdventureStep } from './servedStep';
import type { ServedStep } from '../../api/play/stepRunnerApi';

function served(presentation: ServedStep['presentation'], overrides: Partial<ServedStep> = {}) {
  return {
    id: 's',
    type: 'CHOICE',
    objectiveIds: ['o'],
    presentation,
    hasHints: false,
    ...overrides,
  } as ServedStep;
}

describe('servedStepToAdventureStep (LAI-0816)', () => {
  it('keeps what a child sees and fills what the server withholds with inert placeholders', () => {
    const step = servedStepToAdventureStep(
      served({
        kind: 'choice',
        prompt: 'Which bundle?',
        options: [
          { id: 'a', label: '2 + 2', groups: [2, 2] },
          { id: 'b', label: '1 + 2' },
        ],
      }),
    );
    expect(step.presentation).toEqual({
      kind: 'choice',
      prompt: 'Which bundle?',
      options: [
        { id: 'a', label: '2 + 2', groups: [2, 2] },
        { id: 'b', label: '1 + 2' },
      ],
      correctOptionId: '',
    });
    expect(step.transitions).toEqual([]);
    expect(step.hintPolicy).toBeUndefined();
  });

  it('shows the hint button only when the server says there are hints', () => {
    const withHints = servedStepToAdventureStep(
      served({ kind: 'reflection', prompt: 'Why?' }, { hasHints: true }),
    );
    expect(withHints.hintPolicy).toEqual({ ladder: [] });
  });

  it.each([
    [{ kind: 'number-input', prompt: 'How many?' }, 'number-input'],
    [{ kind: 'ordering', prompt: 'Order', items: [{ id: 'a', label: 'A' }] }, 'ordering'],
    [{ kind: 'narrative', speaker: 'Pip', text: 'Ahoy' }, 'narrative'],
    [{ kind: 'creative-choice', prompt: 'Pick', options: [] }, 'creative-choice'],
    [{ kind: 'complete', text: 'Done' }, 'complete'],
  ])('maps %j', (presentation, kind) => {
    expect(
      servedStepToAdventureStep(served(presentation as ServedStep['presentation'])).presentation
        .kind,
    ).toBe(kind);
  });

  it('drops malformed options rather than showing them', () => {
    const step = servedStepToAdventureStep(
      served({ kind: 'choice', prompt: 'P', options: [{ id: 1 }, null, { id: 'a', label: 'A' }] }),
    );
    expect(step.presentation).toMatchObject({ options: [{ id: 'a', label: 'A' }] });
  });

  it('falls back to a narrative step for an unknown step type', () => {
    expect(
      servedStepToAdventureStep(served({ kind: 'complete', text: 'x' }, { type: 'WAT' })).type,
    ).toBe('NARRATIVE');
  });
});
