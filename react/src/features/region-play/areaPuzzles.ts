import type { JsonObject, JsonValue } from '../../api/parse';
import type { PuzzleKind } from '../../api/play/types';

/**
 * The client half of 3D Area puzzles (ADR-043 F, LAI-0812): typed parameters and the same rules
 * the server grades with (`lai/apps/regions/puzzles.py`), for instant, local feedback only. The
 * server is the only judge: nothing here records progress or grants anything. The two halves are
 * kept in step by the `area-puzzles` golden vectors (`tests/golden/area-puzzles.json`).
 *
 * Pure: no React, no Three.js, no API. Parameters are read, never trusted: a malformed one parses
 * to `null`, and the puzzle is shown as not available rather than half-built.
 */

export interface BandCommon {
  intro: string;
  hints: string[];
  hintAfterAttempts: number;
  completeMessage: string | null;
  scienceNote: string | null;
}

export interface ObserveFeature {
  id: string;
  label: string;
  explanation: string;
}

export interface ObserveParams extends BandCommon {
  kind: 'OBSERVE_FEATURES';
  features: ObserveFeature[];
}

export interface Stone {
  id: string;
  label: string;
  size: number;
}

export interface Slot {
  id: string;
  label: string;
  gap: number;
}

export interface PlatformParams extends BandCommon {
  kind: 'PLACE_PLATFORMS';
  stones: Stone[];
  slots: Slot[];
  showOutlines: boolean;
}

export interface Channel {
  id: string;
  label: string;
}

export interface Valve {
  id: string;
  label: string;
  from: string;
  to: string;
}

export interface ValveParams extends BandCommon {
  kind: 'VALVE_SEQUENCE';
  channels: Channel[];
  start: string;
  goal: string;
  valves: Valve[];
  showSteamPath: boolean;
}

export interface CollectParams extends BandCommon {
  kind: 'COLLECT_OBJECT';
  discoveryMessage: string;
}

export interface ReturnParams extends BandCommon {
  kind: 'RETURN_TO_NPC';
  npcEntityId: string;
}

export type PuzzleParams =
  ObserveParams | PlatformParams | ValveParams | CollectParams | ReturnParams;

const DEFAULT_HINT_AFTER = 2;

type Rec = { readonly [key: string]: JsonValue };

function rec(value: JsonValue | undefined): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}

function str(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function int(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function list<T>(value: JsonValue | undefined, read: (item: Rec) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const item of value) {
    const entry = rec(item);
    const parsed = entry ? read(entry) : null;
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

function labelled(item: Rec): { id: string; label: string } | null {
  const id = str(item.id);
  const label = str(item.label);
  return id && label ? { id, label } : null;
}

function common(params: Rec): BandCommon | null {
  const intro = str(params.intro);
  if (!intro) return null;
  const rawHints = params.hints ?? [];
  if (!Array.isArray(rawHints) || !rawHints.every((hint) => str(hint) !== null)) return null;
  return {
    intro,
    hints: rawHints as string[],
    hintAfterAttempts: int(params.hintAfterAttempts) ?? DEFAULT_HINT_AFTER,
    completeMessage: str(params.completeMessage),
    scienceNote: str(params.scienceNote),
  };
}

/** One age band's parameters, typed for `kind`, or `null` if they are not usable. */
export function parsePuzzleParams(kind: PuzzleKind, parameters: JsonObject): PuzzleParams | null {
  const base = common(parameters);
  if (!base) return null;
  switch (kind) {
    case 'OBSERVE_FEATURES': {
      const features = list(parameters.features, (item) => {
        const head = labelled(item);
        const explanation = str(item.explanation);
        return head && explanation ? { ...head, explanation } : null;
      });
      return features && features.length > 0 ? { kind, ...base, features } : null;
    }
    case 'PLACE_PLATFORMS': {
      const stones = list(parameters.stones, (item) => {
        const head = labelled(item);
        const size = int(item.size);
        return head && size !== null ? { ...head, size } : null;
      });
      const slots = list(parameters.slots, (item) => {
        const head = labelled(item);
        const gap = int(item.gap);
        return head && gap !== null ? { ...head, gap } : null;
      });
      if (!stones || !slots || slots.length === 0) return null;
      return { kind, ...base, stones, slots, showOutlines: parameters.showOutlines === true };
    }
    case 'VALVE_SEQUENCE': {
      const channels = list(parameters.channels, labelled);
      const valves = list(parameters.valves, (item) => {
        const head = labelled(item);
        const from = str(item.from);
        const to = str(item.to);
        return head && from && to ? { ...head, from, to } : null;
      });
      const start = str(parameters.start);
      const goal = str(parameters.goal);
      if (!channels || !valves || !start || !goal) return null;
      return {
        kind,
        ...base,
        channels,
        valves,
        start,
        goal,
        showSteamPath: parameters.showSteamPath === true,
      };
    }
    case 'COLLECT_OBJECT': {
      const discoveryMessage = str(parameters.discoveryMessage);
      return discoveryMessage ? { kind, ...base, discoveryMessage } : null;
    }
    case 'RETURN_TO_NPC': {
      const npcEntityId = str(parameters.npcEntityId);
      return npcEntityId ? { kind, ...base, npcEntityId } : null;
    }
  }
}

/** The hint to offer after `failedAttempts` wrong tries, or `null` before any is due. */
export function dueHint(params: BandCommon, failedAttempts: number): string | null {
  if (params.hints.length === 0 || failedAttempts < params.hintAfterAttempts) return null;
  const index = Math.min(
    Math.floor(failedAttempts / params.hintAfterAttempts) - 1,
    params.hints.length - 1,
  );
  return params.hints[index] ?? null;
}

// --- The rules, identical to the server's ------------------------------------------------------

/** OBSERVE_FEATURES: solved once every feature has been looked at. */
export function observeSolved(featureIds: readonly string[], observed: readonly string[]): boolean {
  const seen = new Set(observed);
  return featureIds.length > 0 && featureIds.every((id) => seen.has(id));
}

/**
 * PLACE_PLATFORMS: every gap holds a different stone whose size equals the gap. `placements` maps
 * a slot id to a stone id. Unknown ids make the submission invalid (the server answers 400).
 */
export function platformsSolved(
  stones: readonly Stone[],
  slots: readonly Slot[],
  placements: Readonly<Record<string, string>>,
): boolean {
  const size = new Map(stones.map((stone) => [stone.id, stone.size]));
  const gap = new Map(slots.map((slot) => [slot.id, slot.gap]));
  const entries = Object.entries(placements);
  if (entries.some(([slot, stone]) => !gap.has(slot) || !size.has(stone))) {
    throw new Error('invalid submission');
  }
  if (entries.length !== slots.length) return false;
  if (new Set(entries.map(([, stone]) => stone)).size !== entries.length) return false;
  return entries.every(([slot, stone]) => size.get(stone) === gap.get(slot));
}

/** Whether one stone fits one gap: the visible "it fits" glow. */
export function stoneFits(stone: Stone, slot: Slot): boolean {
  return stone.size === slot.gap;
}

/** VALVE_SEQUENCE: where the steam ends. A valve whose channel has no steam does nothing. */
export function simulateValves(
  valves: readonly Valve[],
  start: string,
  sequence: readonly string[],
): string {
  const byId = new Map(valves.map((valve) => [valve.id, valve]));
  let steam = start;
  for (const id of sequence) {
    const valve = byId.get(id);
    if (!valve) throw new Error('invalid submission');
    if (valve.from === steam) steam = valve.to;
  }
  return steam;
}

export function valvesSolved(
  params: Pick<ValveParams, 'valves' | 'start' | 'goal'>,
  sequence: readonly string[],
): boolean {
  return simulateValves(params.valves, params.start, sequence) === params.goal;
}

/** The shortest valve order that brings the steam to the goal, each valve once, or `null`. */
export function solveValves(
  params: Pick<ValveParams, 'valves' | 'start' | 'goal'>,
): string[] | null {
  const frontier: Array<[string, string[]]> = [[params.start, []]];
  while (frontier.length > 0) {
    const [steam, used] = frontier.shift() as [string, string[]];
    if (steam === params.goal) return used;
    for (const valve of params.valves) {
      if (!used.includes(valve.id) && valve.from === steam)
        frontier.push([valve.to, [...used, valve.id]]);
    }
  }
  return null;
}
