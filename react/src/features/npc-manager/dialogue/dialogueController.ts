import { ApiError } from '../../../api/errors';
import type { InteractionResponse, RuntimeChoice, RuntimeNode } from '../contracts/types';
import type { ChoiceAction, DialogueEventName, Trigger } from '../contracts/vocabulary';
import type { NpcDialogueApi } from './npcDialogueApi';

/**
 * The NPC dialogue controller (LAI-NPC-012): a framework-free state machine over the
 * interaction API. It holds no copy and decides nothing: the server picks every line and every
 * visible choice. Presentational components (workstream B's `NpcDialoguePanel`) render
 * `DialogueView`; the engine listens to the dialogue events.
 *
 *   idle -> loading -> showing(node, choices) -> loading -> ... -> ended
 *                   \-> ended (no dialogue for the trigger)
 *                   \-> error (network or API failure: a calm fallback, then nothing more)
 *
 * - One request at a time: a choose, advance or end while one is in flight is ignored, so a
 *   double tap never submits twice.
 * - `interrupt()` ends locally at once (the child walked away, a menu opened) and tells the
 *   server best-effort; a late response from before the interruption is dropped.
 * - An error never shows an error screen: the view gets `fallback: true` (the panel shows the
 *   calm line `DIALOGUE_COPY.fallback` from `./dialogueCopy`) and the conversation is over.
 *   `conversation_ended` / `conversation_not_found` (for example after a release change) end
 *   quietly with `endReason: 'stale'` and no fallback.
 */

export type DialogueStatus = 'idle' | 'loading' | 'showing' | 'ended' | 'error';

export type DialogueEndReason = 'completed' | 'no_dialogue' | 'stale' | 'error';

export interface DialogueView {
  status: DialogueStatus;
  npcId: string | null;
  conversationId: string | null;
  dialogueKey: string | null;
  node: RuntimeNode | null;
  choices: RuntimeChoice[];
  /** Set after an OFFER_QUEST choice; accepting is the child's own tap on the quests API. */
  questOffer: { questId: string } | null;
  /** True while a request is in flight (buttons should be disabled). */
  busy: boolean;
  /** True after a failure: show the calm fallback line instead of an error. */
  fallback: boolean;
  endReason: DialogueEndReason | null;
}

export type DialogueEvent =
  | { type: 'dialogue.started'; npcId: string; conversationId: string; dialogueKey: string }
  | { type: 'dialogue.node_entered'; npcId: string; conversationId: string; node: RuntimeNode }
  | {
      type: 'dialogue.choice_made';
      npcId: string;
      conversationId: string;
      choiceKey: string;
      action: ChoiceAction;
    }
  | {
      type: 'dialogue.ended';
      npcId: string;
      conversationId: string | null;
      reason: DialogueEndReason;
    }
  | { type: 'dialogue.interrupted'; npcId: string; conversationId: string | null };

// Compile-time guard: every event the controller emits is a frozen DIALOGUE_EVENTS name.
type _EventNamesAreFrozen = DialogueEvent['type'] extends DialogueEventName ? true : never;
const _eventNamesAreFrozen: _EventNamesAreFrozen = true;
void _eventNamesAreFrozen;

export interface DialogueController {
  getView(): DialogueView;
  /** Called with the new view after every change. Returns an unsubscribe function. */
  subscribe(listener: (view: DialogueView) => void): () => void;
  /** Dialogue lifecycle events (DIALOGUE_EVENTS). Returns an unsubscribe function. */
  onEvent(listener: (event: DialogueEvent) => void): () => void;
  start(npcId: string, trigger: Trigger, placementKey?: string): Promise<void>;
  choose(choiceKey: string): Promise<void>;
  advance(): Promise<void>;
  end(): Promise<void>;
  interrupt(): void;
  /** Interrupts anything open and drops every listener. */
  dispose(): void;
}

export const IDLE_VIEW: DialogueView = Object.freeze({
  status: 'idle',
  npcId: null,
  conversationId: null,
  dialogueKey: null,
  node: null,
  choices: [],
  questOffer: null,
  busy: false,
  fallback: false,
  endReason: null,
}) as DialogueView;

/** API codes that mean "this conversation is already over", not a failure. */
const STALE_CODES: ReadonlySet<string> = new Set(['conversation_ended', 'conversation_not_found']);

export function createDialogueController(api: NpcDialogueApi): DialogueController {
  let view: DialogueView = IDLE_VIEW;
  let generation = 0;
  let inFlight: AbortController | null = null;
  const viewListeners = new Set<(view: DialogueView) => void>();
  const eventListeners = new Set<(event: DialogueEvent) => void>();

  function set(next: Partial<DialogueView>): void {
    view = { ...view, ...next };
    for (const listener of [...viewListeners]) listener(view);
  }

  function emit(event: DialogueEvent): void {
    for (const listener of [...eventListeners]) listener(event);
  }

  function isOpen(): boolean {
    return view.status === 'showing' || view.status === 'loading';
  }

  function finish(reason: DialogueEndReason, extra: Partial<DialogueView> = {}): void {
    const npcId = view.npcId;
    const conversationId = view.conversationId;
    set({
      status: reason === 'error' ? 'error' : 'ended',
      node: null,
      choices: [],
      busy: false,
      fallback: reason === 'error',
      endReason: reason,
      ...extra,
    });
    if (npcId !== null) emit({ type: 'dialogue.ended', npcId, conversationId, reason });
  }

  function show(response: InteractionResponse, started: boolean): void {
    const questOffer = response.questOffer ?? (started ? null : view.questOffer);
    if (response.ended || response.node === null || response.conversationId === null) {
      finish(started && response.conversationId === null ? 'no_dialogue' : 'completed', {
        conversationId: response.conversationId ?? view.conversationId,
        dialogueKey: response.dialogueKey ?? view.dialogueKey,
        questOffer,
      });
      return;
    }
    set({
      status: 'showing',
      conversationId: response.conversationId,
      dialogueKey: response.dialogueKey,
      node: response.node,
      choices: response.choices,
      questOffer,
      busy: false,
      fallback: false,
      endReason: null,
    });
    if (started && response.dialogueKey !== null) {
      emit({
        type: 'dialogue.started',
        npcId: response.npcId,
        conversationId: response.conversationId,
        dialogueKey: response.dialogueKey,
      });
    }
    emit({
      type: 'dialogue.node_entered',
      npcId: response.npcId,
      conversationId: response.conversationId,
      node: response.node,
    });
  }

  async function run(
    call: (signal: AbortSignal) => Promise<InteractionResponse>,
    started: boolean,
  ): Promise<void> {
    const mine = ++generation;
    const controller = new AbortController();
    inFlight = controller;
    let response: InteractionResponse;
    try {
      response = await call(controller.signal);
    } catch (error) {
      if (mine !== generation) return; // interrupted or replaced: nothing to show
      inFlight = null;
      if (error instanceof ApiError && error.kind === 'aborted') return;
      const stale = error instanceof ApiError && STALE_CODES.has(error.code);
      finish(stale ? 'stale' : 'error');
      return;
    }
    if (mine !== generation) return;
    inFlight = null;
    show(response, started);
  }

  /** `endOnServer` false: the caller's next request replaces the server cursor anyway. */
  function interrupt(endOnServer = true): void {
    if (!isOpen() || view.npcId === null) return;
    const npcId = view.npcId;
    const conversationId = view.conversationId;
    generation += 1; // drop any late response
    inFlight?.abort();
    inFlight = null;
    set({ ...IDLE_VIEW, status: 'ended', npcId, conversationId, endReason: 'completed' });
    emit({ type: 'dialogue.interrupted', npcId, conversationId });
    if (conversationId !== null && endOnServer) {
      api.end(npcId, conversationId).catch(() => undefined); // best effort
    }
  }

  return {
    getView: () => view,
    subscribe(listener) {
      viewListeners.add(listener);
      return () => {
        viewListeners.delete(listener);
      };
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    async start(npcId, trigger, placementKey) {
      if (view.busy) return;
      // An open conversation is interrupted first. With another NPC it is also ended on the
      // server (best effort). With the same NPC it is not: the server keeps one cursor per child
      // and NPC, so this start replaces it, and a racing `end` would only come back
      // 404 conversation_not_found or 409 conversation_ended (a browser console error).
      interrupt(view.npcId !== npcId);
      set({ ...IDLE_VIEW, status: 'loading', npcId, busy: true });
      const request = placementKey === undefined ? { trigger } : { trigger, placementKey };
      await run((signal) => api.start(npcId, request, signal), true);
    },
    async choose(choiceKey) {
      if (view.status !== 'showing' || view.busy) return;
      const { npcId, conversationId } = view;
      const choice = view.choices.find((c) => c.choiceKey === choiceKey);
      if (npcId === null || conversationId === null || choice === undefined) return;
      set({ busy: true, questOffer: null });
      emit({
        type: 'dialogue.choice_made',
        npcId,
        conversationId,
        choiceKey,
        action: choice.action,
      });
      await run((signal) => api.choose(npcId, conversationId, choiceKey, signal), false);
    },
    async advance() {
      if (view.status !== 'showing' || view.busy || view.choices.length > 0) return;
      const { npcId, conversationId } = view;
      if (npcId === null || conversationId === null) return;
      set({ busy: true, questOffer: null });
      await run((signal) => api.advance(npcId, conversationId, signal), false);
    },
    async end() {
      if (view.status !== 'showing' || view.busy) return;
      const { npcId, conversationId } = view;
      if (npcId === null || conversationId === null) return;
      set({ busy: true });
      await run((signal) => api.end(npcId, conversationId, signal), false);
    },
    interrupt: () => interrupt(),
    dispose() {
      interrupt();
      viewListeners.clear();
      eventListeners.clear();
    },
  };
}
