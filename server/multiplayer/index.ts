import { existsSync, readFileSync } from 'node:fs';
import { householdKeyFor } from '../../react/src/features/multiplayer/householdKey';
import { createAppSyncChildProfileLookup } from './appSyncChildProfiles';
import { createPlayerAuthenticator } from './auth';
import { createCognitoIdTokenVerifier } from './cognitoVerifier';
import { readRoomServerConfig } from './config';
import { consoleRoomEventLog } from './roomEventLog';
import { createRoomServer } from './roomServer';

/**
 * Entry point: `npm run mp:dev`. See docs/multiplayer/MULTIPLAYER_SERVER.md.
 */
const outputsUrl = new URL('../../amplify_outputs.json', import.meta.url);
const outputs: unknown = existsSync(outputsUrl)
  ? JSON.parse(readFileSync(outputsUrl, 'utf8'))
  : null;
const config = readRoomServerConfig(process.env, outputs);

const server = createRoomServer({
  allowedOrigins: config.allowedOrigins,
  log: consoleRoomEventLog,
  authenticate: createPlayerAuthenticator({
    verifyIdToken: createCognitoIdTokenVerifier(config.userPoolId, config.userPoolClientId),
    fetchOwnChildProfile: createAppSyncChildProfileLookup(config.appSyncUrl),
    householdKeyFor,
  }),
});

await server.listen(config.port);
console.warn(
  `Multiplayer room server listening on port ${config.port} ` +
    `(${config.production ? 'production' : 'development'}), origins: ${config.allowedOrigins.join(', ')}`,
);

const shutdown = () => {
  void server.gracefullyShutdown(true);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
