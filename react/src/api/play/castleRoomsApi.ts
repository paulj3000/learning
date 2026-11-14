import { getAccessToken } from '../auth';
import { createApiClient, type ApiClient } from '../client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../config';
import { ApiError } from '../errors';
import { read } from '../parse';

/**
 * `GET` and `POST /api/v1/children/<id>/castle/rooms/` (SC-R03-06,
 * docs/PLAY_API.md): which rooms of Storykeeper Castle this child has been in.
 *
 * The server decides everything: which ids it accepts, whether a secret room may be
 * recorded, whether this was the first time. A refusal for a secret not yet found is
 * the same `not_found` as for an unknown room, so a caller must treat any refusal as
 * "not saved" and never show it to a child.
 */
export interface DiscoverRoomOutcome {
  roomId: string;
  newlyDiscovered: boolean;
}

/** The two calls the castle needs, so a test can pass a fake and the view can pass nothing. */
export interface CastleRoomsApi {
  list(): Promise<readonly string[]>;
  record(roomId: string): Promise<DiscoverRoomOutcome>;
}

const base = (childId: string) => `children/${encodeURIComponent(childId)}/castle/rooms/`;

function requireId(value: string, name: string): void {
  if (!value) throw new ApiError('invalid_request', { code: `empty_${name}` });
}

export async function getDiscoveredRooms(
  client: ApiClient,
  childId: string,
): Promise<readonly string[]> {
  requireId(childId, 'id');
  const response = await client.request('GET', base(childId));
  return read(response.data, (r) => r.field('rooms').array((room) => room.string()));
}

export async function discoverRoom(
  client: ApiClient,
  childId: string,
  roomId: string,
): Promise<DiscoverRoomOutcome> {
  requireId(childId, 'id');
  requireId(roomId, 'room');
  const response = await client.request('POST', base(childId), { body: { roomId } });
  return read(response.data, (r) => ({
    roomId: r.field('roomId').string(),
    newlyDiscovered: r.field('newlyDiscovered').boolean(),
  }));
}

/**
 * The castle rooms API for one child (Django, the only backend).
 */
export function castleRoomsApiFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): CastleRoomsApi {
  const client = createApiClient({
    baseUrl: config.baseUrl,
    getAccessToken,
    provisionAccount: true,
  });
  return {
    list: () => getDiscoveredRooms(client, childId),
    record: (roomId) => discoverRoom(client, childId, roomId),
  };
}
