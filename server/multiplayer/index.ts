import { householdKeyFor } from '../../react/src/features/multiplayer/householdKey';
import { createPlayerAuthenticator } from './auth';
import { createCognitoAccessTokenVerifier } from './cognitoVerifier';
import { readRoomServerConfig } from './config';
import { createDjangoChildProfileLookup } from './djangoChildProfiles';
import { consoleRoomEventLog } from './roomEventLog';
import { createRoomServer } from './roomServer';

/**
 * Entry point: `npm run mp:dev`. See docs/multiplayer/MULTIPLAYER_SERVER.md.
 */
const config = readRoomServerConfig(process.env);

const server = createRoomServer({
  allowedOrigins: config.allowedOrigins,
  log: consoleRoomEventLog,
  authenticate: createPlayerAuthenticator({
    verifyAccessToken: createCognitoAccessTokenVerifier(config.userPoolId, config.userPoolClientId),
    fetchOwnChildProfile: createDjangoChildProfileLookup(config.djangoApiBase),
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
