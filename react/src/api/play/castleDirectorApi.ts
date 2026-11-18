import { getAccessToken } from '../auth';
import { createApiClient, type ApiClient } from '../client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../config';
import { ApiError } from '../errors';
import { read } from '../parse';

/**
 * `POST /api/v1/children/<id>/castle/director/` (SC-R09-01,
 * docs/regions/prep/ai_director_prep.md).
 *
 * The client sends only a room id and an opaque id for this visit. The server recomputes which
 * ambient events are eligible, lets a model pick one of them (or uses the deterministic default)
 * and answers with the authored lines of that event. Nothing in the answer is a reward, a quest
 * or a world change. A caller treats ANY failure as "ask the local rules instead" and never
 * shows it to a child.
 */
export interface CastleDirectorEvent {
  eventId: string;
  /** `AI` when the model's pick was used, `FALLBACK` for the deterministic default. */
  source: 'AI' | 'FALLBACK';
  /** The authored lines for the child's band, readable aloud. */
  lines: readonly string[];
  npcId: string | null;
  /** The ambient cue the engine may play. Never a reward. */
  visual: { kind: string };
}

export interface CastleDirectorApi {
  choose(roomId: string, visitId: string): Promise<CastleDirectorEvent>;
}

const path = (childId: string) => `children/${encodeURIComponent(childId)}/castle/director/`;

export async function chooseCastleEvent(
  client: ApiClient,
  childId: string,
  roomId: string,
  visitId: string,
): Promise<CastleDirectorEvent> {
  if (!childId) throw new ApiError('invalid_request', { code: 'empty_id' });
  if (!roomId) throw new ApiError('invalid_request', { code: 'empty_room' });
  if (!visitId) throw new ApiError('invalid_request', { code: 'empty_visit' });
  // The body is closed on the server: nothing but these two fields may be sent.
  const response = await client.request('POST', path(childId), { body: { roomId, visitId } });
  return read(response.data, (r) => ({
    eventId: r.field('eventId').string(),
    source: r.field('source').oneOf(['AI', 'FALLBACK'] as const),
    lines: r.field('lines').array((line) => line.string()),
    npcId: r.field('npcId').nullable((npc) => npc.string()),
    visual: { kind: r.field('visual').field('kind').string() },
  }));
}

/** The Castle Director API for one child (Django, the only backend). */
export function castleDirectorApiFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): CastleDirectorApi {
  const client = createApiClient({
    baseUrl: config.baseUrl,
    getAccessToken,
    provisionAccount: true,
  });
  return { choose: (roomId, visitId) => chooseCastleEvent(client, childId, roomId, visitId) };
}
