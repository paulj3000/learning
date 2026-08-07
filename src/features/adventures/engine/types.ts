import type { AgeBandValue } from '../../child-profile/constants';

/** The 10 MVP step types from docs/ADVENTURE_ENGINE.md. */
export type AdventureStepType =
  | 'NARRATIVE'
  | 'CHOICE'
  | 'NUMBER_INPUT'
  | 'ORDERING'
  | 'MATCHING'
  | 'SHORT_RESPONSE'
  | 'CREATIVE_CHOICE'
  | 'REFLECTION'
  | 'WORLD_CHANGE'
  | 'COMPLETE';

export type Correctness = 'correct' | 'incorrect' | 'partial' | 'not_applicable';

export interface TransitionRule {
  when: 'correct' | 'incorrect' | 'partial' | 'always';
  nextStepId: string;
}

/** An ordered ladder of up to 5 hint strings (docs/ADVENTURE_ENGINE.md "Hint ladder"). */
export interface HintPolicy {
  ladder: string[];
}

export interface ChoiceOption {
  id: string;
  label: string;
}

export interface WorldChangePayload {
  changeType: string;
  changeKey: string;
  locationSlug: string;
}

/** Content each step needs to render; kept concrete rather than a generic blob. */
export type PresentationSpec =
  | { kind: 'narrative'; speaker: string; text: string }
  | { kind: 'number-input'; prompt: string; correctValue: number }
  | { kind: 'choice'; prompt: string; options: ChoiceOption[]; correctOptionId: string }
  | { kind: 'ordering'; prompt: string; items: ChoiceOption[]; correctOrder: string[] }
  | { kind: 'matching'; prompt: string; pairs: Array<{ leftId: string; rightId: string }> }
  | { kind: 'short-response'; prompt: string; options: ChoiceOption[]; acceptedOptionIds: string[] }
  | { kind: 'creative-choice'; prompt: string; options: ChoiceOption[] }
  | { kind: 'reflection'; prompt: string }
  | { kind: 'world-change'; text: string; payload: WorldChangePayload }
  | { kind: 'complete'; text: string };

/** Authored, non-AI copy shown if a step's normal presentation cannot be shown. */
export interface FallbackPresentation {
  text: string;
}

export interface AdventureStep {
  id: string;
  type: AdventureStepType;
  objectiveIds: string[];
  presentation: PresentationSpec;
  transitions: TransitionRule[];
  hintPolicy?: HintPolicy;
  fallback: FallbackPresentation;
}

export interface AdventureDefinition {
  slug: string;
  version: number;
  title: string;
  locationSlug: string;
  ageBands: AgeBandValue[];
  entryStepId: string;
  steps: AdventureStep[];
}

export function getStep(definition: AdventureDefinition, stepId: string): AdventureStep {
  const step = definition.steps.find((candidate) => candidate.id === stepId);
  if (!step) {
    throw new Error(`Adventure "${definition.slug}" has no step "${stepId}".`);
  }
  return step;
}
