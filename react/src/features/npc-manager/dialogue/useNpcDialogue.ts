import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  createDialogueController,
  type DialogueController,
  type DialogueEvent,
  type DialogueView,
} from './dialogueController';
import type { NpcDialogueApi } from './npcDialogueApi';

/**
 * A thin React binding for one dialogue controller. The controller is created once per `api`
 * (memoise the api) and interrupted when the component unmounts or the api changes (the child
 * left the scene). Pass `onEvent` to forward dialogue events, for example to NPC engine
 * commands. Listeners are removed by their own effects, so StrictMode's double effects are safe.
 */
export function useNpcDialogue(
  api: NpcDialogueApi,
  onEvent?: (event: DialogueEvent) => void,
): { view: DialogueView; controller: DialogueController } {
  const controller = useMemo(() => createDialogueController(api), [api]);

  useEffect(() => () => controller.interrupt(), [controller]);

  useEffect(() => {
    if (!onEvent) return undefined;
    return controller.onEvent(onEvent);
  }, [controller, onEvent]);

  const view = useSyncExternalStore(controller.subscribe, controller.getView, controller.getView);
  return { view, controller };
}
