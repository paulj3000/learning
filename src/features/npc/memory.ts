/**
 * Per-child NPC memory flags (docs/ROADMAP.md Phase 23: "persistent per-child
 * memory flags (for example `bridgeQuestCompleted`)").
 *
 * Pure reducers over an authored boolean map. Two rules make this safe to
 * persist for a child:
 *
 * 1. Flags are authored keys, never child input. CLAUDE.md section 13
 *    forbids storing child free-text, so a flag records *that* something
 *    happened, never what a child said or wrote.
 * 2. Flags are additive within a conversation. Nothing here clears a flag,
 *    so an NPC cannot forget the child mid-visit; deliberate resets are a
 *    parent-facing data action (`clearNpcState` in `api.ts`), not gameplay.
 */
import type { NpcMemoryFlags } from './types';

export const EMPTY_MEMORY_FLAGS: NpcMemoryFlags = Object.freeze({});

/** `flags` with every key in `flagsToSet` set true. Returns a new object. */
export function setMemoryFlags(
  flags: NpcMemoryFlags,
  flagsToSet: readonly string[],
): NpcMemoryFlags {
  if (flagsToSet.length === 0) return flags;
  const next: Record<string, boolean> = { ...flags };
  for (const flag of flagsToSet) next[flag] = true;
  return next;
}

export function hasMemoryFlag(flags: NpcMemoryFlags, flag: string): boolean {
  return flags[flag] ?? false;
}

/**
 * Parses the `memoryFlags` JSON column into a trusted shape. Stored JSON is
 * external data at read time (CLAUDE.md section 13: validate all external
 * data at runtime), so anything that is not a plain boolean map degrades to
 * empty rather than propagating a malformed value into condition evaluation.
 */
export function parseMemoryFlags(raw: unknown): NpcMemoryFlags {
  // `a.json()` is AppSync's AWSJSON, which travels as a JSON-encoded *string*
  // (see `serializeMemoryFlags`). A live read therefore hands back a string,
  // while an already-decoded object arrives from tests and from any client
  // that parsed it first, so both are accepted.
  const value = typeof raw === 'string' ? safeParse(raw) : raw;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return EMPTY_MEMORY_FLAGS;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, entry]) => typeof entry === 'boolean',
  ) as [string, boolean][];
  return Object.fromEntries(entries);
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Encodes flags for the `memoryFlags` column.
 *
 * AppSync rejects a raw object for an `AWSJSON` variable outright
 * ("Variable 'memoryFlags' has an invalid value"), and `recordDialogueNode`
 * swallows write failures so a child never sees an error for saying hello -
 * so passing an object here failed silently, and every NPC memory and
 * friendship point was being dropped. Nothing caught it until Phase 26.5
 * gave children a way to hold a conversation and the flow was run against a
 * live sandbox; unit tests mock the client, which accepts anything.
 */
export function serializeMemoryFlags(flags: NpcMemoryFlags): string {
  return JSON.stringify(flags);
}
