/**
 * The room server's only telemetry (docs/DECISIONS.md ADR-026 part E):
 * lifecycle events with a room id and counts. The type has no field for a
 * child id, name, token or position, so one cannot be logged by accident.
 */
export type RoomEvent =
  | { event: 'room-created' | 'room-disposed' | 'player-reconnected'; roomId: string }
  | { event: 'player-joined' | 'player-left'; roomId: string; players: number }
  | { event: 'auth-rejected'; roomId: string; reason: string };

export type RoomEventLog = (event: RoomEvent) => void;

/** One JSON line per event on stdout, for CloudWatch once deployed. */
export const consoleRoomEventLog: RoomEventLog = (event) => {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
};
