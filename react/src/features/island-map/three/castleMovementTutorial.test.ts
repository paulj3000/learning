import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TUTORIAL_COPY,
  TUTORIAL_DONE_LINE,
  TUTORIAL_OPTIONAL_LINE,
  TUTORIAL_RECOVERED_LINE,
  startTutorial,
  tutorialLine,
  tutorialReducer,
  tutorialSteps,
  tutorialVisible,
  type TutorialEvent,
  type TutorialState,
} from './castleMovementTutorial';
import type { AgeBandValue } from '../../child-profile/constants';

const gait = (value: 'idle' | 'walk' | 'run' | 'sprint'): TutorialEvent => ({
  name: 'PlayerGaitChanged',
  detail: { gait: value },
});
const JUMPED: TutorialEvent = { name: 'PlayerJumped', detail: { airJump: false } };
const LANDED: TutorialEvent = { name: 'PlayerLanded', detail: { impactSpeed: 4 } };
const RECOVERED: TutorialEvent = {
  name: 'PlayerRecovered',
  detail: { reason: 'LEFT_PLAYABLE_AREA' },
};

function run(events: readonly TutorialEvent[], band: AgeBandValue): TutorialState {
  return events.reduce((state, event) => tutorialReducer(state, event, band), startTutorial());
}

describe('castle movement tutorial (SC-JMP-06 preparation)', () => {
  it('walks a Pathfinder through walk, faster, hop and land, on the engine’s own events', () => {
    expect(tutorialSteps('PATHFINDER')).toEqual(['walk', 'faster', 'jump', 'land', 'done']);
    const states = [gait('walk'), gait('run'), JUMPED, LANDED].reduce<TutorialState[]>(
      (seen, event) => [...seen, tutorialReducer(seen[seen.length - 1], event, 'PATHFINDER')],
      [startTutorial()],
    );
    expect(states.map((state) => state.step)).toEqual(['walk', 'faster', 'jump', 'land', 'done']);
    expect(tutorialVisible(states[4])).toBe(false);
    expect(tutorialLine(states[4], 'keyboard')).toBe(TUTORIAL_DONE_LINE);
  });

  it('never asks a Sprout to go faster', () => {
    expect(tutorialSteps('SPROUT')).not.toContain('faster');
    expect(run([gait('walk'), JUMPED, LANDED], 'SPROUT').step).toBe('done');
  });

  it('advances only on the right action, in order, and never on time', () => {
    expect(run([JUMPED, LANDED, gait('idle')], 'EXPLORER').step).toBe('walk');
    expect(run([gait('walk'), JUMPED], 'EXPLORER').step).toBe('faster');
    expect(run([gait('walk'), gait('sprint')], 'EXPLORER').step).toBe('jump');
    // The module takes no clock: the reducer's inputs are state, event and band only.
    expect(tutorialReducer.length).toBe(3);
  });

  it('explains a recovery kindly, once, and keeps the step', () => {
    const recovered = run([gait('walk'), RECOVERED], 'PATHFINDER');
    expect(recovered.step).toBe('faster');
    expect(tutorialLine(recovered, 'touch')).toBe(TUTORIAL_RECOVERED_LINE);
    const next = tutorialReducer(recovered, gait('walk'), 'PATHFINDER');
    expect(next.recovered).toBe(false);
    expect(tutorialLine(next, 'touch')).toBe(TUTORIAL_COPY.faster.touch);
  });

  it('can be skipped at any step, and stays skipped', () => {
    for (const before of [[], [gait('walk')], [gait('walk'), gait('run')]] as TutorialEvent[][]) {
      const skipped = run(
        [...before, { name: 'Skip' }, gait('walk'), JUMPED, LANDED],
        'PATHFINDER',
      );
      expect(skipped.skipped).toBe(true);
      expect(tutorialVisible(skipped)).toBe(false);
      expect(tutorialLine(skipped, 'gamepad')).toBeNull();
    }
  });

  it('has a line for every step and input, readable aloud, without em dashes', () => {
    const lines = [
      ...Object.values(TUTORIAL_COPY).flatMap((byInput) => Object.values(byInput)),
      TUTORIAL_DONE_LINE,
      TUTORIAL_RECOVERED_LINE,
      TUTORIAL_OPTIONAL_LINE,
    ];
    for (const line of lines) {
      expect(line.trim().length).toBeGreaterThan(0);
      expect(line).not.toMatch(/[—–]/);
    }
  });

  it('gates nothing: no requirement, reward, record or storage in the module', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/island-map/three/castleMovementTutorial.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of [
      'localStorage',
      'fetch(',
      'requirements',
      'grant',
      'setTimeout',
      'Date.now',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});
