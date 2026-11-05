import { ApiError } from '../../../api/errors';
import type { InteractionResponse, RuntimeChoice } from '../contracts/types';
import { DIALOGUE_EVENTS } from '../contracts/vocabulary';
import { createDialogueController, IDLE_VIEW, type DialogueEvent } from './dialogueController';
import { DIALOGUE_COPY, dialogueFallbackLine } from './dialogueCopy';
import type { NpcDialogueApi } from './npcDialogueApi';

const CONVERSATION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function response(
  nodeKey: string | null,
  choices: RuntimeChoice[] = [],
  overrides: Partial<InteractionResponse> = {},
): InteractionResponse {
  return {
    contractVersion: 1,
    release: 3,
    npcId: 'pirate-pip',
    conversationId: CONVERSATION,
    dialogueKey: 'greeting',
    node:
      nodeKey === null
        ? null
        : {
            nodeKey,
            text: `Line ${nodeKey}.`,
            emotion: 'happy',
            animationState: 'talk',
            audio: null,
            speech: null,
            allowAiHint: false,
          },
    choices,
    ended: nodeKey === null,
    questOffer: null,
    ...overrides,
  };
}

const OK: RuntimeChoice = { choiceKey: 'ok', label: 'Okay', action: 'NONE' };
const QUEST: RuntimeChoice = { choiceKey: 'help', label: 'I will help', action: 'OFFER_QUEST' };

function fakeApi() {
  return {
    start: vi.fn<NpcDialogueApi['start']>(),
    choose: vi.fn<NpcDialogueApi['choose']>(),
    advance: vi.fn<NpcDialogueApi['advance']>(),
    end: vi.fn<NpcDialogueApi['end']>(),
  };
}

function setup() {
  const api = fakeApi();
  const controller = createDialogueController(api);
  const events: DialogueEvent[] = [];
  controller.onEvent((event) => events.push(event));
  return { api, controller, events, types: () => events.map((e) => e.type) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('NPC dialogue controller', () => {
  it('walks a branching conversation and emits the frozen dialogue events', async () => {
    const { api, controller, events, types } = setup();
    api.start.mockResolvedValueOnce(response('hello', [OK]));
    api.choose.mockResolvedValueOnce(response('more'));
    api.advance.mockResolvedValueOnce(response(null));

    await controller.start('pirate-pip', 'on_interact', 'cove-pip');
    expect(api.start).toHaveBeenCalledWith(
      'pirate-pip',
      { trigger: 'on_interact', placementKey: 'cove-pip' },
      expect.any(AbortSignal),
    );
    expect(controller.getView()).toMatchObject({
      status: 'showing',
      node: { nodeKey: 'hello' },
      choices: [OK],
      busy: false,
    });

    await controller.choose('ok');
    expect(api.choose).toHaveBeenCalledWith(
      'pirate-pip',
      CONVERSATION,
      'ok',
      expect.any(AbortSignal),
    );
    expect(controller.getView().node?.nodeKey).toBe('more');

    await controller.advance();
    expect(controller.getView()).toMatchObject({
      status: 'ended',
      endReason: 'completed',
      node: null,
    });
    expect(types()).toEqual([
      'dialogue.started',
      'dialogue.node_entered',
      'dialogue.choice_made',
      'dialogue.node_entered',
      'dialogue.ended',
    ]);
    for (const event of events) expect(DIALOGUE_EVENTS).toContain(event.type);
    expect(events[2]).toMatchObject({ choiceKey: 'ok', action: 'NONE' });
  });

  it('ends quietly when no dialogue answers the trigger', async () => {
    const { api, controller, events } = setup();
    api.start.mockResolvedValueOnce(
      response(null, [], { conversationId: null, dialogueKey: null }),
    );
    await controller.start('pirate-pip', 'on_spawn');
    expect(api.start).toHaveBeenCalledWith(
      'pirate-pip',
      { trigger: 'on_spawn' },
      expect.any(AbortSignal),
    );
    expect(controller.getView()).toMatchObject({
      status: 'ended',
      endReason: 'no_dialogue',
      fallback: false,
    });
    expect(events).toEqual([
      { type: 'dialogue.ended', npcId: 'pirate-pip', conversationId: null, reason: 'no_dialogue' },
    ]);
  });

  it('never chooses something the server did not offer, and never advances past choices', async () => {
    const { api, controller } = setup();
    api.start.mockResolvedValueOnce(response('hello', [OK]));
    await controller.start('pirate-pip', 'on_interact');
    await controller.choose('not-offered');
    await controller.advance();
    expect(api.choose).not.toHaveBeenCalled();
    expect(api.advance).not.toHaveBeenCalled();
  });

  it('ignores a second tap while a request is in flight', async () => {
    const { api, controller } = setup();
    api.start.mockResolvedValueOnce(response('hello', [OK]));
    await controller.start('pirate-pip', 'on_interact');
    const pending = deferred<InteractionResponse>();
    api.choose.mockReturnValueOnce(pending.promise);
    const first = controller.choose('ok');
    expect(controller.getView().busy).toBe(true);
    await controller.choose('ok');
    await controller.end();
    await controller.start('pirate-pip', 'on_interact');
    expect(api.choose).toHaveBeenCalledTimes(1);
    expect(api.end).not.toHaveBeenCalled();
    expect(api.start).toHaveBeenCalledTimes(1);
    pending.resolve(response(null));
    await first;
    expect(controller.getView().status).toBe('ended');
  });

  it('keeps a quest offer for the panel but never accepts it', async () => {
    const { api, controller } = setup();
    api.start.mockResolvedValueOnce(response('hello', [QUEST]));
    api.choose.mockResolvedValueOnce(response(null, [], { questOffer: { questId: 'pips-quest' } }));
    await controller.start('pirate-pip', 'on_interact');
    await controller.choose('help');
    expect(controller.getView()).toMatchObject({
      status: 'ended',
      questOffer: { questId: 'pips-quest' },
    });
    expect(api.end).not.toHaveBeenCalled();
  });

  it('shows the calm fallback on a failure, never an error screen', async () => {
    const { api, controller, events } = setup();
    api.start.mockRejectedValueOnce(new ApiError('network'));
    await controller.start('pirate-pip', 'on_interact');
    expect(controller.getView()).toMatchObject({
      status: 'error',
      fallback: true,
      endReason: 'error',
      busy: false,
    });
    expect(dialogueFallbackLine(controller.getView())).toBe(DIALOGUE_COPY.fallback);
    expect(events.at(-1)).toMatchObject({ type: 'dialogue.ended', reason: 'error' });

    // A later start works again.
    api.start.mockResolvedValueOnce(response('hello'));
    await controller.start('pirate-pip', 'on_interact');
    expect(controller.getView()).toMatchObject({ status: 'showing', fallback: false });
    expect(dialogueFallbackLine(controller.getView())).toBeNull();
  });

  it('treats an invalid choice as a calm failure', async () => {
    const { api, controller } = setup();
    api.start.mockResolvedValueOnce(response('hello', [OK]));
    api.choose.mockRejectedValueOnce(
      new ApiError('conflict', { status: 409, code: 'invalid_choice' }),
    );
    await controller.start('pirate-pip', 'on_interact');
    await controller.choose('ok');
    expect(controller.getView()).toMatchObject({ status: 'error', fallback: true });
  });

  it.each(['conversation_ended', 'conversation_not_found'])(
    'ends a stale conversation (%s, e.g. after a release change) without a fallback',
    async (code) => {
      const { api, controller } = setup();
      api.start.mockResolvedValueOnce(response('hello'));
      api.advance.mockRejectedValueOnce(
        new ApiError(code === 'conversation_ended' ? 'conflict' : 'not_found', { code }),
      );
      await controller.start('pirate-pip', 'on_interact');
      await controller.advance();
      expect(controller.getView()).toMatchObject({
        status: 'ended',
        endReason: 'stale',
        fallback: false,
      });
    },
  );

  it('interrupts at once, ends on the server best-effort, and drops a late answer', async () => {
    const { api, controller, types } = setup();
    api.start.mockResolvedValueOnce(response('hello'));
    api.end.mockRejectedValueOnce(new ApiError('network'));
    await controller.start('pirate-pip', 'on_interact');
    const pending = deferred<InteractionResponse>();
    let aborted: AbortSignal | undefined;
    api.advance.mockImplementationOnce((_npc, _conversation, signal) => {
      aborted = signal;
      return pending.promise;
    });
    const advancing = controller.advance();
    controller.interrupt();
    expect(aborted?.aborted).toBe(true);
    expect(api.end).toHaveBeenCalledWith('pirate-pip', CONVERSATION);
    expect(controller.getView()).toMatchObject({ status: 'ended', node: null, busy: false });
    pending.resolve(response('late'));
    await advancing;
    expect(controller.getView().node).toBeNull();
    expect(types().at(-1)).toBe('dialogue.interrupted');
  });

  it('starting another conversation interrupts the open one first', async () => {
    const { api, controller, types } = setup();
    api.start.mockResolvedValueOnce(response('hello'));
    api.end.mockResolvedValueOnce(response(null));
    api.start.mockResolvedValueOnce(
      response('hi', [], { npcId: 'keeper-quill', dialogueKey: 'hi' }),
    );
    await controller.start('pirate-pip', 'on_interact');
    await controller.start('keeper-quill', 'on_player_near');
    expect(api.end).toHaveBeenCalledWith('pirate-pip', CONVERSATION);
    expect(controller.getView()).toMatchObject({ npcId: 'keeper-quill', node: { nodeKey: 'hi' } });
    expect(types()).toContain('dialogue.interrupted');
  });

  it('ends on request and notifies subscribers; dispose drops every listener', async () => {
    const { api, controller } = setup();
    const views: string[] = [];
    const unsubscribe = controller.subscribe((view) => views.push(view.status));
    api.start.mockResolvedValueOnce(response('hello', [OK]));
    api.end.mockResolvedValueOnce(response(null));
    await controller.start('pirate-pip', 'on_interact');
    await controller.end();
    expect(api.end).toHaveBeenCalledWith('pirate-pip', CONVERSATION, expect.any(AbortSignal));
    expect(views).toEqual(['loading', 'showing', 'showing', 'ended']);
    unsubscribe();
    controller.dispose();
    expect(controller.getView().status).toBe('ended');
    expect(IDLE_VIEW.status).toBe('idle');
  });
});
