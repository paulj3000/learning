import { useEffect, useRef } from 'react';
import type { AdventureDefinition, Correctness } from '../../../../adventures/engine/types';
import type { StepAnswer } from '../../../../adventures/engine/validators';
import { isPadZoneId } from '../../runtime/manifests/castleRooms/castlePlatforms';
import {
  createPadGate,
  createPadOrderCollector,
  resolvePadAnswer,
} from '../../castlePlatformAnswers';
import type { WorldEngineEventBus } from '../../worldEngineEvents';

/**
 * How long a child stays on a pad before it counts as an answer, milliseconds. A pad is a second
 * way to answer, not a trap: hopping across pads on the way somewhere, or landing on the wrong one
 * and hopping off, answers nothing. Standing still on one for this long does.
 */
export const PAD_DWELL_MS = 700;

export interface UsePadAnswersOptions {
  bus: WorldEngineEventBus;
  definition: AdventureDefinition;
  /** The id of the step that is open now, or null when none is. */
  stepId: string | null;
  /** The session's one submit, the very function the HUD card calls. */
  submit: (answer: StepAnswer) => Promise<Correctness | null>;
  /** A whole ordering was stepped out and was not right (Quill looks concerned; nothing is lost). */
  onWrongOrder?: () => void;
  dwellMs?: number;
}

/**
 * Lets castle pads answer the open step (SC-JMP). It listens for the ground-plane `pad:*` zones
 * the platforms stand in, waits for a short dwell, and hands the answer to the session's own
 * `submit`, so a pad and the HUD card cannot drift: there is one session, one submit, and the
 * engine's verdict decides everything. It grades nothing, advances nothing and grants nothing.
 *
 * One submit at a time (`createPadGate`), a stone counted once per try, and any pad for a step
 * that is not open is ignored, so a repeated landing cannot repeat a grading or a reward request.
 */
export function usePadAnswers({
  bus,
  definition,
  stepId,
  submit,
  onWrongOrder,
  dwellMs = PAD_DWELL_MS,
}: UsePadAnswersOptions): void {
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const wrongRef = useRef(onWrongOrder);
  wrongRef.current = onWrongOrder;

  useEffect(() => {
    if (!stepId) return;
    const step = definition.steps.find((candidate) => candidate.id === stepId) ?? null;
    if (!step) return;
    const collector = createPadOrderCollector();
    const gate = createPadGate();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const settle = (zoneId: string) => {
      timers.delete(zoneId);
      const resolved = resolvePadAnswer(zoneId, definition, step);
      if (!resolved) return;
      if (resolved.kind === 'answer') {
        if (!gate.begin()) return;
        void submitRef.current(resolved.answer).finally(gate.end);
        return;
      }
      const order = collector.step(resolved.optionId, resolved.itemIds);
      if (!order) return;
      if (!gate.begin()) {
        collector.reset();
        return;
      }
      void submitRef
        .current({ kind: 'ordering', order })
        .then((correctness) => {
          // `null`: nothing was graded, so no wrong-order reaction.
          if (correctness !== 'correct' && correctness !== null) wrongRef.current?.();
        })
        .finally(gate.end);
    };

    const offEnter = bus.on('PlayerEnteredZone', ({ zoneId }) => {
      if (!isPadZoneId(zoneId) || !resolvePadAnswer(zoneId, definition, step)) return;
      const pending = timers.get(zoneId);
      if (pending) clearTimeout(pending);
      timers.set(
        zoneId,
        setTimeout(() => settle(zoneId), dwellMs),
      );
    });
    const offLeave = bus.on('PlayerLeftZone', ({ zoneId }) => {
      const pending = timers.get(zoneId);
      if (!pending) return;
      clearTimeout(pending);
      timers.delete(zoneId);
    });
    return () => {
      offEnter();
      offLeave();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [bus, definition, stepId, dwellMs]);
}
