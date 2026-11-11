import type { ServedStep } from '../../api/play/stepRunnerApi';
import type {
  AdventureStep,
  AdventureStepType,
  ChoiceOption,
  PresentationSpec,
} from './engine/types';

/**
 * A step Django served (no answers, hints or transitions) in the shape the existing step card
 * renders (LAI-0816: the existing runner, not a new engine).
 *
 * The card and its step components only read what a child sees. The fields a served step does
 * not carry (the correct value, the accepted options, the order, the transitions) are filled
 * with inert placeholders below, and nothing on this path reads them: the server grades.
 */

const STEP_TYPES: readonly AdventureStepType[] = [
  'NARRATIVE',
  'CHOICE',
  'NUMBER_INPUT',
  'ORDERING',
  'MATCHING',
  'SHORT_RESPONSE',
  'CREATIVE_CHOICE',
  'REFLECTION',
  'WORLD_CHANGE',
  'COMPLETE',
];

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function options(value: unknown): ChoiceOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ChoiceOption[] => {
    if (typeof item !== 'object' || item === null) return [];
    const o = item as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.label !== 'string') return [];
    const groups = Array.isArray(o.groups)
      ? o.groups.filter((g): g is number => typeof g === 'number')
      : undefined;
    return [{ id: o.id, label: o.label, ...(groups ? { groups } : {}) }];
  });
}

function presentation(served: ServedStep): PresentationSpec {
  const p = served.presentation;
  switch (p.kind) {
    case 'narrative':
      return { kind: 'narrative', speaker: text(p.speaker), text: text(p.text) };
    case 'number-input':
      return { kind: 'number-input', prompt: text(p.prompt), correctValue: 0 };
    case 'choice':
      return {
        kind: 'choice',
        prompt: text(p.prompt),
        options: options(p.options),
        correctOptionId: '',
      };
    case 'ordering':
      return {
        kind: 'ordering',
        prompt: text(p.prompt),
        items: options(p.items),
        correctOrder: [],
      };
    case 'matching':
      return { kind: 'matching', prompt: text(p.prompt), pairs: [] };
    case 'short-response':
      return {
        kind: 'short-response',
        prompt: text(p.prompt),
        options: options(p.options),
        acceptedOptionIds: [],
      };
    case 'creative-choice':
      return { kind: 'creative-choice', prompt: text(p.prompt), options: options(p.options) };
    case 'reflection':
      return { kind: 'reflection', prompt: text(p.prompt) };
    case 'world-change':
      return {
        kind: 'world-change',
        text: text(p.text),
        payload: { changeType: '', changeKey: '', locationSlug: '' },
      };
    default:
      return { kind: 'complete', text: text(p.text, 'Well done!') };
  }
}

export function servedStepToAdventureStep(served: ServedStep): AdventureStep {
  const type = (STEP_TYPES as readonly string[]).includes(served.type)
    ? (served.type as AdventureStepType)
    : 'NARRATIVE';
  return {
    id: served.id,
    type,
    objectiveIds: served.objectiveIds,
    presentation: presentation(served),
    transitions: [],
    ...(served.hasHints ? { hintPolicy: { ladder: [] } } : {}),
    fallback: { text: 'Let us try that again.' },
  };
}
