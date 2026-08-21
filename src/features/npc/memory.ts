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
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_MEMORY_FLAGS;
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    ([, value]) => typeof value === 'boolean',
  ) as [string, boolean][];
  return Object.fromEntries(entries);
}
