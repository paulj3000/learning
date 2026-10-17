import { useCallback, useState } from 'react';
import { requestTutorTurn } from './api';
import type { RequestTutorTurnInput, TutorTurnResult } from './api';
import type { TutorTurn } from './types';

export type TutorTurnState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; turn: TutorTurn; source: 'AI' | 'FALLBACK' }
  | { status: 'error' };

export interface UseTutorTurn {
  state: TutorTurnState;
  request: (input: RequestTutorTurnInput) => Promise<TutorTurnResult | undefined>;
}

/**
 * Presentation-layer state machine around `requestTutorTurn`, mirroring
 * `useCompanionTurn` exactly. `requestTutorTurn` never throws - it resolves
 * to authored content on any failure - so `'error'` only surfaces for a
 * genuinely unexpected bug, not for an AI-unavailable case (that arrives as
 * `'ready'` with `source: 'FALLBACK'`).
 */
export function useTutorTurn(): UseTutorTurn {
  const [state, setState] = useState<TutorTurnState>({ status: 'idle' });

  const request = useCallback(async (input: RequestTutorTurnInput) => {
    setState({ status: 'loading' });
    try {
      const result = await requestTutorTurn(input);
      setState({ status: 'ready', turn: result.turn, source: result.source });
      return result;
    } catch {
      setState({ status: 'error' });
      return undefined;
    }
  }, []);

  return { state, request };
}
