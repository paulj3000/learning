/** Shared, internal validation helpers for the SDK contracts. Pure; never throw. */

import type { ValidationIssue } from '../core/errors';
import { SEMANTIC_ID } from '../contracts/gameplayEvents';

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A localisation key such as `realm.sunnyShore.title`: never literal child-facing copy. */
export const LOCALISATION_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_-]+)+$/;
export const SEMVER_EXACT = /^\d+\.\d+\.\d+$/;

/** Field names that look like a timer. ADR-053: children are never counted down. */
export const TIMER_FIELD = /(time_?limit|count_?down|deadline|timer|time_?remaining|time_?left)/i;

export function checkId(value: unknown, path: string, issues: ValidationIssue[]): value is string {
  if (typeof value !== 'string' || !SEMANTIC_ID.test(value)) {
    issues.push({ path, message: 'must be a semantic id (letters, digits, . _ : -; no spaces)' });
    return false;
  }
  return true;
}

export function checkLocalisationKey(value: unknown, path: string, issues: ValidationIssue[]): value is string {
  if (typeof value !== 'string' || !LOCALISATION_KEY.test(value)) {
    issues.push({ path, message: 'must be a localisation key like "realm.name.title", never literal copy' });
    return false;
  }
  return true;
}

export function checkSemver(value: unknown, path: string, issues: ValidationIssue[]): value is string {
  if (typeof value !== 'string' || !SEMVER_EXACT.test(value)) {
    issues.push({ path, message: 'must be a semver version like "1.0.0"' });
    return false;
  }
  return true;
}

/** Validates an array of semantic ids. Returns the ids that were valid. */
export function checkIdArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  options: { min?: number } = {},
): string[] {
  if (value === undefined && !options.min) {
    return [];
  }
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'must be an array' });
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (checkId(item, `${path}[${index}]`, issues)) {
      if (seen.has(item)) {
        issues.push({ path: `${path}[${index}]`, message: `duplicate id "${item}"` });
      }
      seen.add(item);
      out.push(item);
    }
  });
  if (options.min && out.length < options.min) {
    issues.push({ path, message: `needs at least ${options.min} entr${options.min === 1 ? 'y' : 'ies'}` });
  }
  return out;
}

export function checkStrictKeys(value: UnknownRecord, allowed: readonly string[], path: string, issues: ValidationIssue[]): void {
  const set = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!set.has(key)) {
      issues.push({ path: path ? `${path}.${key}` : key, message: 'is not part of this contract' });
    }
  }
}

/** Dotted paths of every key (at any depth) that looks like a timer. Depth-limited, cycle-safe. */
export function findTimerFields(value: unknown, path = '', found: string[] = [], depth = 0, seen = new Set<unknown>()): string[] {
  if (depth > 12 || typeof value !== 'object' || value === null || seen.has(value)) {
    return found;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => findTimerFields(item, `${path}[${index}]`, found, depth + 1, seen));
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (TIMER_FIELD.test(key)) {
      found.push(childPath);
    }
    findTimerFields(child, childPath, found, depth + 1, seen);
  }
  return found;
}
