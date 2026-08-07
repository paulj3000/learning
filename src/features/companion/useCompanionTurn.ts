import { useCallback, useState } from 'react';
import { requestCompanionTurn } from './api';
import type { RequestCompanionTurnInput } from './api';
import type { CompanionTurn } from './schema';

export type CompanionTurnState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; turn: CompanionTurn; source: 'AI' | 'FALLBACK' }
  | { status: 'error' };

export interface UseCompanionTurn {
  state: CompanionTurnState;
  request: (input: RequestCompanionTurnInput) => Promise<void>;
}

/**
 * Presentation-layer state machine around `requestCompanionTurn`
 * (docs/TESTING_STRATEGY.md component tests: "companion loading, response,
 * invalid-output, and fallback states"). `requestCompanionTurn` itself
 * never throws — it resolves to authored fallback content on any failure —
 * so `'error'` only surfaces for a genuinely unexpected bug, not for a
 * normal AI-unavailable case (that renders as `'ready'` with
 * `source: 'FALLBACK'` instead).
 */
export function useCompanionTurn(): UseCompanionTurn {
  const [state, setState] = useState<CompanionTurnState>({ status: 'idle' });

  const request = useCallback(async (input: RequestCompanionTurnInput) => {
    setState({ status: 'loading' });
    try {
      const result = await requestCompanionTurn(input);
      setState({ status: 'ready', turn: result.turn, source: result.source });
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  return { state, request };
}
