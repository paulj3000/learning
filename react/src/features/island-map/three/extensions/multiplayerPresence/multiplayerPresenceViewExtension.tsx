import { getAmplifyIdentity } from '../../../../multiplayer/amplifyIdentity';
import { createColyseusTransport } from '../../../../multiplayer/colyseusTransport';
import { MULTIPLAYER_CONFIG } from '../../../../multiplayer/config';
import {
  createMultiplayerClient,
  type MultiplayerClient,
} from '../../../../multiplayer/multiplayerClient';
import type {
  LocationCompanionProps,
  LocationViewExtension,
} from '../../runtime/viewExtensionRegistry';
import { MultiplayerPresencePanel } from './MultiplayerPresencePanel';

export const MULTIPLAYER_PRESENCE_EXTENSION_ID = 'multiplayer-presence';

/** One stable factory per build, so the panel's effect does not rejoin on every render. */
function buildClientFactory(): (() => MultiplayerClient) | null {
  const config = MULTIPLAYER_CONFIG;
  if (!config.enabled) return null;
  return () =>
    createMultiplayerClient({
      transport: createColyseusTransport(config.serverUrl),
      getIdentity: getAmplifyIdentity,
    });
}

const createBuildClient = buildClientFactory();

function MultiplayerPresenceCompanion({ regionId, childId }: LocationCompanionProps) {
  return (
    <MultiplayerPresencePanel
      regionId={regionId}
      childId={childId}
      createClient={createBuildClient}
    />
  );
}

/**
 * `multiplayer-presence` has only a React half in Phase 1: it joins the
 * family's room and lists who is here. A manifest opts in by binding it;
 * the build must also have multiplayer switched on (ADR-026 part H), or it
 * renders nothing and opens no connection.
 */
export const multiplayerPresenceViewExtension: LocationViewExtension = {
  id: MULTIPLAYER_PRESENCE_EXTENSION_ID,
  claimsInteraction: () => false,
  Companion: MultiplayerPresenceCompanion,
};
