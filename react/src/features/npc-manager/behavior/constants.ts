/** Tuning constants for the NPC behaviour controller (LAI-NPC-019 to 024). Units: metres, seconds. */

/** Faster than this (m/s) the NPC runs; at or below it walks (animation synchronisation input). */
export const RUN_SPEED_THRESHOLD = 2.5;

/** Bounded turn rate (radians per second) toward the travel direction or a facing target. */
export const TURN_RATE = 6;

/** A frame longer than this (a tab coming back from the background) is clamped to it. */
export const MAX_DELTA_SECONDS = 0.25;

/** Collision probes are taken at most this far apart, so a fast NPC cannot tunnel a thin wall. */
export const COLLISION_STEP = 0.25;

/** How long a `reacting` beat holds movement before the behaviour carries on. */
export const REACTION_SECONDS = 1.5;

/** A stationary NPC with `facePlayer` turns toward the player within this distance. */
export const FACE_PLAYER_DISTANCE = 6;

/** Follow: once stopped within `stopDistance`, the player must be this much farther to restart. */
export const FOLLOW_RESTART_MARGIN = 0.25;

/** A leg taking longer than `slack x` its straight-line time (plus a second) counts as blocked. */
export const LEG_TIME_SLACK = 2;

/** Arrival tolerance in metres. */
export const ARRIVAL_EPSILON = 1e-4;

/** Wander tries this many random targets before giving up for one pause. */
export const WANDER_TARGET_ATTEMPTS = 6;
