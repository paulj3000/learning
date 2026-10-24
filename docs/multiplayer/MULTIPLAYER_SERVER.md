# Multiplayer Room Server

_Roadmap Phase 1 (`../MATH_MAYHEM_MULTIPLAYER_ROADMAP.md`). Decision: ADR-026 in `../DECISIONS.md`._

A small Node.js process, separate from the web app and from Amplify, that
seats children of **one family** in a shared, in-memory room per region and
tells each of them who else is there. Phase 1 has presence only: no
movement, no avatars in the 3D scene, and no way to send anything to
another child.

## Layout

| Path | What it is |
|---|---|
| `src/features/multiplayer/protocol.ts` | Wire contract and runtime validators, shared by both sides |
| `src/features/multiplayer/roomRules.ts` | Pure room rules: seating, replacement, drop and reconnect, expiry, presence |
| `src/features/multiplayer/householdKey.ts` | SHA-256 family key used to group rooms without the raw Cognito `sub` |
| `src/features/multiplayer/multiplayerClient.ts` | Client service: connection states, join, leave, rejoin on token expiry |
| `src/features/multiplayer/colyseusTransport.ts` | The only client file that touches Colyseus (lazy-loaded) |
| `src/features/island-map/three/extensions/multiplayerPresence/` | `multiplayer-presence` view extension: the "Explorers here" panel |
| `server/multiplayer/index.ts` | Process entry point (`npm run mp:dev`) |
| `server/multiplayer/roomServer.ts` | Colyseus wiring: transport, origin check, CORS, room registration |
| `server/multiplayer/islandRoom.ts` | Thin Colyseus room over `roomRules.ts` |
| `server/multiplayer/auth.ts` | Seat authorization (token, household, child ownership) |

## Running it locally

1. Have a deployed sandbox (`npm run sandbox`), so `amplify_outputs.json` exists.
2. Start the room server: `npm run mp:dev` (listens on port 2567).
3. Create `.env.development.local` (gitignored) for the web app:

   ```bash
   VITE_MULTIPLAYER_ENABLED=true
   VITE_MULTIPLAYER_URL=ws://localhost:2567
   # Development only: try presence in a region whose manifest does not opt in.
   VITE_MULTIPLAYER_DEV_REGIONS=welcome-harbor
   ```

4. `npm run dev`.

No shipped manifest binds `multiplayer-presence` yet. Without
`VITE_MULTIPLAYER_DEV_REGIONS`, nothing changes in any region.

### Manual check with two browser sessions

1. Sign in to the **same parent account** in two separate browser
   profiles (or one normal and one private window). The account needs two
   child profiles.
2. In window A, pick child 1 and open `/island/<child1Id>/explore/welcome-harbor`.
   The panel under the scene says "You are the only explorer here right now."
3. In window B, pick child 2 and open the same region. Both panels say
   "2 explorers are here." and show both avatars.
4. Close window B's tab. Within a few seconds window A shows the other
   explorer as "coming back", then removes them after 20 seconds.
5. Reopen window B quickly instead: the explorer returns without a duplicate.
6. Open child 1's region in a second tab of window A. The first tab says
   "You are exploring from another screen now." and the count stays at 2.
7. Sign in as a **different** parent and open the same region: they get
   their own room and never see the first family.

## Configuration

### Room server (environment)

| Variable | Default | Notes |
|---|---|---|
| `MP_PORT` | `2567` | |
| `MP_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Exact origins. **Required in production**, and each must be `https://` |
| `MP_USER_POOL_ID` | from `amplify_outputs.json` | Cognito user pool |
| `MP_USER_POOL_CLIENT_ID` | from `amplify_outputs.json` | The web client's app client; the ID token's audience |
| `MP_APPSYNC_URL` | from `amplify_outputs.json` | Used to read the child profile as the parent |
| `NODE_ENV` | | `production` enables the strict origin rules |

The server needs **no AWS credentials**. It verifies tokens against the
pool's public keys and reads the child profile from AppSync with the
parent's own token.

### Web app (Vite)

| Variable | Notes |
|---|---|
| `VITE_MULTIPLAYER_ENABLED` | Must be `true` for anything to happen |
| `VITE_MULTIPLAYER_URL` | `wss://` in a production build; `ws://` is accepted only by `vite dev` |
| `VITE_MULTIPLAYER_DEV_REGIONS` | Comma-separated region ids; ignored outside `vite dev` |

A region gets presence only when the build is configured **and** its
manifest binds `multiplayer-presence` (or it is a dev region). From
roadmap Phase 3 a parent setting will be a third requirement.

## Security and privacy

**Who may sit in a room.** On every new seat the server:

1. verifies the Cognito ID token (signature, issuer, audience, `token_use: id`, expiry) with `aws-jwt-verify`;
2. recomputes the household key from the token's `sub` and requires it to match the room's;
3. fetches the child profile from AppSync **with the caller's token**, so
   `ChildProfile`'s owner rule must allow it, and checks `ownerSub` (or the
   `owner` field for older rows) against the token's `sub`.

Any failure is the same opaque refusal (`AUTH_FAILED`, 525). The reason is
logged server-side without the child id.

**What other players receive.** A per-room player id (`p1`, `p2`, ...), an
authored avatar key, a slot number and HERE/RECONNECTING. Never the child
id, nickname, photo, age band or parent data. `toAvatarKey` drops anything
that is not an authored avatar key.

**What is persisted.** Nothing. Rooms live in memory and disappear when
empty. The server writes no database rows. Logs are one JSON line per
lifecycle event (room created or disposed, join, leave, reconnect, refusal
reason) with a room id and counts. The `RoomEvent` type has no field for a
child id, token or position.

**Allowed origins.** WebSocket upgrades from any other origin, or with no
`Origin` header, get HTTP 403. The matchmaking route's CORS headers echo
only an allowed origin. This is defence in depth; the token is what
authorizes a seat.

**TLS.** The process speaks plain HTTP/WS. In production, TLS terminates at
the load balancer (ADR-026 part A) and the browser uses `wss://`. A
production web build refuses a `ws://` URL.

**Token expiry.** Cognito ID tokens last one hour. Every 30 seconds the
room closes seats whose token has expired, with close code 4401. The client
rejoins once with a fresh token from Amplify. A second expiry in a row
leaves the child single-player with a "Try again" button.

**Token in the URL.** The Colyseus SDK sends the token as an
`Authorization` header on the matchmaking request **and** as a `_authToken`
query parameter on the WebSocket URL. A production load balancer or proxy
must therefore not log query strings. Recorded as a deployment requirement.

**Reconnect behaviour.**

- A dropped connection keeps its seat for 20 seconds (`RECONNECT_GRACE_SECONDS`),
  shown to others as "coming back". The SDK retries automatically.
- A child joining again (reload, second tab) takes over their own seat.
  The old connection is closed with code 4409, and the player id and slot
  are kept, so there is never a duplicate.
- Colyseus only holds a seat for a client that finished the join
  handshake. A drop in the first moments after joining is treated as a
  leave; the panel offers "Try again".
- The SDK will not auto-reconnect a room younger than 1 second.

**Rate limits and sizes.**

- At most 20 messages per second per client (Colyseus disconnects above that).
  Phase 1 clients send none after joining.
- At most 4 KB per WebSocket message.
- Heartbeat every 5 seconds; three missed pings drop the client.
- At most 12 players per room. A household has at most three children.

## Known limits and risks

- **Rooms are created before authentication.** Colyseus runs `onCreate`
  before `onAuth`, so a refused request briefly creates an empty room,
  which disposes at once. Harmless at prototype scale. Production needs
  request rate limiting in front of the matchmaking route (load balancer
  or WAF).
- **Region ids are format-checked, not checked against the manifests.** A
  room can exist for any well-formed region id. It can only ever hold one
  family, so the impact is nil; Phase 2 should restrict rooms to regions
  that opt in.
- **One process.** Rooms are not shared across processes. Fine for one
  Fargate task; more needs a shared presence store.
- **Not deployed.** Hosting (ECS Fargate behind an ALB with TLS) is a later
  step and carries an always-on cost (ADR-026).
- **Not yet verified with a real signed-in parent.** The automated tests
  cover real WebSockets and the real SDK with fake Cognito and AppSync. The
  real process refuses forged and missing tokens against the live pool. The
  two-browser check above needs a person with a parent account.

## Tests

| File | Covers |
|---|---|
| `src/features/multiplayer/*.test.ts` | Protocol validation, room rules, config, household key, client state machine, copy, dev repository |
| `.../multiplayerPresence/MultiplayerPresencePanel.test.tsx` | Panel states, retry, leave on unmount |
| `server/multiplayer/auth.test.ts` | Every authorization rejection path |
| `server/multiplayer/appSyncChildProfiles.test.ts` | Lookup with the caller's token, minimal fields, error handling |
| `server/multiplayer/config.test.ts` | Server configuration and origin matching |
| `server/multiplayer/roomServer.integration.test.ts` | Real server and SDK: two players in one room, leaving, refusals, per-family rooms, seat replacement, drop and reconnect, token expiry, origin 403, logs without ids |
