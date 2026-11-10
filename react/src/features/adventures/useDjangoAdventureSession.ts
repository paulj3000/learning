import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  stepRunnerApiFor,
  type StepRunnerApi,
  type StepRunnerView,
  type CompletionView,
} from '../../api/play/stepRunnerApi';
import { servedStepToAdventureStep } from './servedStep';
import type { AdventureStep, Correctness } from './engine/types';
import type { StepAnswer } from './engine/validators';

type LoadState = 'loading' | 'ready' | 'error';

export interface DjangoAdventureSessionState {
  loadState: LoadState;
  currentStep: AdventureStep | null;
  completed: boolean;
  hintLevel: number;
  hintText: string | undefined;
  submitting: boolean;
  error: string | null;
  /** The server's verdict, or null when nothing was graded (no open session, or it failed). */
  submitAnswer: (answer: StepAnswer) => Promise<Correctness | null>;
  requestHint: () => void;
  /** What finishing changed on the island, once the server reports it. */
  completion: CompletionView | null;
}

const CALM_ERROR = 'Something went wrong. Let us try that again.';

const LOWER: Record<string, Correctness> = {
  CORRECT: 'correct',
  INCORRECT: 'incorrect',
  PARTIAL: 'partial',
  NOT_APPLICABLE: 'not_applicable',
};

function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Plays one published adventure through the Django step runner (LAI-0816). It starts or resumes
 * the child's session, shows the server's current step, sends answers and hint requests, and
 * shows what the server decided. It never grades, never picks the next step and never keeps the
 * answer: all of that is Django's, so a refresh, a second tab or a lost connection can only
 * ever resume where the server says the child is.
 */
export function useDjangoAdventureSession(
  childId: string,
  adventureSlug: string,
  api: StepRunnerApi = stepRunnerApiFor(childId),
): DjangoAdventureSessionState {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [view, setView] = useState<StepRunnerView | null>(null);
  const [hintLevel, setHintLevel] = useState(0);
  const [hintText, setHintText] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completion, setCompletion] = useState<CompletionView | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState('loading');
    api
      .start(adventureSlug, controller.signal)
      .then((started) => {
        setView(started);
        setHintLevel(started.hintLevel);
        setLoadState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadState('error');
      });
    return () => controller.abort();
  }, [api, adventureSlug]);

  const currentStep = useMemo(
    () => (view?.step ? servedStepToAdventureStep(view.step) : null),
    [view],
  );
  const completed = view?.session.status === 'COMPLETED';

  const submitAnswer = useCallback(
    async (answer: StepAnswer): Promise<Correctness | null> => {
      if (!view?.step || completed || inFlight.current) return null;
      inFlight.current = true;
      setSubmitting(true);
      setError(null);
      try {
        const verdict = await api.submitAnswer(
          view.session.id,
          view.step.id,
          answer,
          newRequestId(),
        );
        setHintLevel(verdict.supportLevel);
        if (verdict.action === 'ADVANCE') {
          setHintText(undefined);
          setHintLevel(0);
          if (verdict.completion) setCompletion(verdict.completion);
          setView(await api.getStep(view.session.id));
        }
        return LOWER[verdict.correctness] ?? null;
      } catch {
        setError(CALM_ERROR);
        return null;
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
    },
    [api, view, completed],
  );

  const requestHint = useCallback(() => {
    if (!view?.step || completed) return;
    const { id } = view.session;
    const stepId = view.step.id;
    void api
      .requestHint(id, stepId, hintLevel)
      .then((hint) => {
        setHintLevel(hint.hintLevel);
        setHintText(hint.hintText ?? undefined);
      })
      .catch(() => setError(CALM_ERROR));
  }, [api, view, completed, hintLevel]);

  return {
    loadState,
    currentStep,
    completed,
    hintLevel,
    hintText,
    submitting,
    error,
    submitAnswer,
    requestHint,
    completion,
  };
}
