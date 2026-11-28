import type { JsonObject, JsonValue } from '../../api/parse';
import type { PuzzleKind } from '../../api/play/types';

/**
 * The client half of 3D Area puzzles (ADR-047 F, LAI-0812): typed parameters and the same rules
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

/** Symbols that tell options apart without colour (FPV, UX_AND_ACCESSIBILITY). */
export const PUZZLE_SYMBOLS = [
  'circle',
  'square',
  'triangle',
  'star',
  'diamond',
  'hexagon',
  'heart',
  'moon',
] as const;
export type PuzzleSymbol = (typeof PUZZLE_SYMBOLS)[number];

export interface ChoiceOption {
  id: string;
  label: string;
  symbol: PuzzleSymbol | null;
}

export interface ChoiceVariant {
  id: string;
  prompt: string;
  options: ChoiceOption[];
  answer: string;
  explanation: string;
}

export interface ChooseAnswerParams extends BandCommon {
  kind: 'CHOOSE_ANSWER';
  presentation: string;
  subject: string;
  skill: string;
  /** Option id -> scene entity id, when the options are objects in the world. */
  optionEntities: Record<string, string>;
  variants: ChoiceVariant[];
}

export interface OrderVariant {
  id: string;
  prompt: string;
  items: ChoiceOption[];
  answer: string[];
  explanation: string;
}

export interface OrderSequenceParams extends BandCommon {
  kind: 'ORDER_SEQUENCE';
  presentation: string;
  subject: string;
  skill: string;
  /** Item id -> scene entity id. */
  itemEntities: Record<string, string>;
  variants: OrderVariant[];
}

/** The two kinds that hold many questions and can be practised after they are solved. */
export type ChoiceKindParams = ChooseAnswerParams | OrderSequenceParams;

export type PuzzleParams =
  | ObserveParams
  | PlatformParams
  | ValveParams
  | CollectParams
  | ReturnParams
  | ChooseAnswerParams
  | OrderSequenceParams;

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

const MAX_VARIANTS = 8;

function option(item: Rec): ChoiceOption | null {
  const head = labelled(item);
  if (!head) return null;
  if (item.symbol === undefined || item.symbol === null) return { ...head, symbol: null };
  const symbol = PUZZLE_SYMBOLS.find((candidate) => candidate === item.symbol);
  return symbol ? { ...head, symbol } : null;
}

function uniqueIds(items: readonly { id: string }[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

function entityMap(
  value: JsonValue | undefined,
  ids: readonly string[][],
): Record<string, string> | null {
  if (value === undefined || value === null) return {};
  const map = rec(value);
  if (!map) return null;
  const out: Record<string, string> = {};
  for (const [key, entity] of Object.entries(map)) {
    const id = str(entity);
    if (!id) return null;
    out[key] = id;
  }
  const keys = new Set(Object.keys(out));
  // When entities are given, every variant's ids are exactly the mapped keys.
  for (const variantIds of ids) {
    if (variantIds.length !== keys.size || !variantIds.every((id) => keys.has(id))) return null;
  }
  return out;
}

function choiceBase(
  parameters: Rec,
): (BandCommon & { presentation: string; subject: string; skill: string }) | null {
  // The prompt lives in each variant, so a band `intro` is optional for these kinds.
  const rawHints = parameters.hints ?? [];
  if (!Array.isArray(rawHints) || !rawHints.every((hint) => str(hint) !== null)) return null;
  return {
    intro: str(parameters.intro) ?? '',
    hints: rawHints as string[],
    hintAfterAttempts: int(parameters.hintAfterAttempts) ?? DEFAULT_HINT_AFTER,
    completeMessage: str(parameters.completeMessage),
    scienceNote: str(parameters.scienceNote),
    presentation: str(parameters.presentation) ?? '',
    subject: str(parameters.subject) ?? '',
    skill: str(parameters.skill) ?? '',
  };
}

function parseChoose(parameters: Rec): ChooseAnswerParams | null {
  const base = choiceBase(parameters);
  const variants = list(parameters.variants, (item) => {
    const id = str(item.id);
    const prompt = str(item.prompt);
    const answer = str(item.answer);
    const explanation = str(item.explanation);
    const options = list(item.options, option);
    if (!id || !prompt || !answer || !explanation || !options) return null;
    if (options.length < 2 || options.length > 4 || !uniqueIds(options)) return null;
    if (!options.some((o) => o.id === answer)) return null;
    return { id, prompt, options, answer, explanation };
  });
  if (!base || !variants || variants.length < 1 || variants.length > MAX_VARIANTS) return null;
  if (!uniqueIds(variants)) return null;
  const optionEntities = entityMap(
    parameters.optionEntities,
    variants.map((v) => v.options.map((o) => o.id)),
  );
  return optionEntities ? { kind: 'CHOOSE_ANSWER', ...base, optionEntities, variants } : null;
}

function parseOrder(parameters: Rec): OrderSequenceParams | null {
  const base = choiceBase(parameters);
  const variants = list(parameters.variants, (item) => {
    const id = str(item.id);
    const prompt = str(item.prompt);
    const explanation = str(item.explanation);
    const items = list(item.items, option);
    const rawAnswer = item.answer;
    if (!id || !prompt || !explanation || !items || !Array.isArray(rawAnswer)) return null;
    if (items.length < 2 || items.length > 6 || !uniqueIds(items)) return null;
    const answer = rawAnswer.map((entry) => str(entry));
    if (answer.some((entry) => entry === null)) return null;
    if (
      !isPermutation(
        answer as string[],
        items.map((i) => i.id),
      )
    )
      return null;
    return { id, prompt, items, answer: answer as string[], explanation };
  });
  if (!base || !variants || variants.length < 1 || variants.length > MAX_VARIANTS) return null;
  if (!uniqueIds(variants)) return null;
  const itemEntities = entityMap(
    parameters.itemEntities,
    variants.map((v) => v.items.map((i) => i.id)),
  );
  return itemEntities ? { kind: 'ORDER_SEQUENCE', ...base, itemEntities, variants } : null;
}

/** One age band's parameters, typed for `kind`, or `null` if they are not usable. */
export function parsePuzzleParams(kind: PuzzleKind, parameters: JsonObject): PuzzleParams | null {
  if (kind === 'CHOOSE_ANSWER') return parseChoose(parameters);
  if (kind === 'ORDER_SEQUENCE') return parseOrder(parameters);
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
    default:
      return null;
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

/**
 * How many of the band's hints the child has been shown before this answer (issue #102): the
 * first one if they asked for it, and every hint `dueHint` has brought out after wrong tries. It
 * is sent as the solve request's `hintsUsed` and only lowers the evidence support level: what the
 * child earns is the same with or without hints. The server caps it at the band's hint count too.
 */
export function hintsShown(params: BandCommon, failedAttempts: number, asked: boolean): number {
  if (params.hints.length === 0) return 0;
  const due =
    failedAttempts < params.hintAfterAttempts
      ? 0
      : Math.min(Math.floor(failedAttempts / params.hintAfterAttempts), params.hints.length);
  return Math.max(due, asked ? 1 : 0);
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

// --- CHOOSE_ANSWER and ORDER_SEQUENCE -----------------------------------------------------------

function isPermutation(order: readonly string[], ids: readonly string[]): boolean {
  return (
    order.length === ids.length &&
    new Set(order).size === order.length &&
    order.every((id) => ids.includes(id))
  );
}

/**
 * CHOOSE_ANSWER: whether `choice` is the variant's answer. An unknown choice is an invalid
 * submission (the server answers 400), so it throws here too.
 */
export function chooseAnswerCorrect(variant: ChoiceVariant, choice: string): boolean {
  if (!variant.options.some((o) => o.id === choice)) throw new Error('invalid submission');
  return choice === variant.answer;
}

/**
 * ORDER_SEQUENCE: whether `order` is the variant's answer. Anything that is not a permutation of
 * the variant's items is an invalid submission and throws.
 */
export function orderSequenceCorrect(variant: OrderVariant, order: readonly string[]): boolean {
  if (
    !isPermutation(
      order,
      variant.items.map((item) => item.id),
    )
  ) {
    throw new Error('invalid submission');
  }
  return order.every((id, index) => id === variant.answer[index]);
}

/** 32-bit FNV-1a: a small, stable hash so every client picks the same first variant. */
export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The first variant of a visit: `hash(sessionId + puzzleId) % count`. */
export function firstVariantIndex(sessionId: string, puzzleId: string, count: number): number {
  return count <= 0 ? 0 : hashText(`${sessionId}${puzzleId}`) % count;
}

/** "Try a different one" and practice: the next variant, wrapping round. */
export function nextVariantIndex(current: number, count: number): number {
  return count <= 0 ? 0 : (current + 1) % count;
}
