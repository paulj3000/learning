/**
 * Small validation helpers shared by every gameplay capability. A capability's `validate`
 * must not throw and must clamp nothing silently (core/capabilities.ts), so each reader
 * reports an issue instead of coercing.
 */

import { SEMANTIC_ID } from '../contracts/gameplayEvents';
import type { ValidationIssue, ValidationResult } from '../core/errors';

export type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class Issues {
  readonly list: ValidationIssue[] = [];

  add(path: string, message: string): void {
    this.list.push({ path, message });
  }

  get ok(): boolean {
    return this.list.length === 0;
  }

  result<T>(value: T): ValidationResult<T> {
    return this.ok ? { ok: true, value, issues: [] } : { ok: false, issues: this.list };
  }

  /** A semantic id (the same pattern the gameplay-event contract requires). */
  id(value: unknown, path: string): string {
    if (typeof value !== 'string' || !SEMANTIC_ID.test(value)) {
      this.add(path, 'must be a semantic id (letters, digits, . _ : -)');
      return '';
    }
    return value;
  }

  optionalId(value: unknown, path: string): string | undefined {
    return value === undefined || value === null ? undefined : this.id(value, path);
  }

  num(value: unknown, path: string, min: number, max: number, fallback?: number): number {
    if (value === undefined && fallback !== undefined) {
      return fallback;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      this.add(path, `must be a number from ${min} to ${max}`);
      return fallback ?? min;
    }
    return value;
  }

  bool(value: unknown, path: string, fallback: boolean): boolean {
    if (value === undefined) {
      return fallback;
    }
    if (typeof value !== 'boolean') {
      this.add(path, 'must be true or false');
      return fallback;
    }
    return value;
  }

  oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[], fallback?: T): T {
    if (value === undefined && fallback !== undefined) {
      return fallback;
    }
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      this.add(path, `must be one of ${allowed.join(', ')}`);
      return fallback ?? allowed[0]!;
    }
    return value as T;
  }

  vec3(value: unknown, path: string, bound = 1000): { x: number; y: number; z: number } {
    if (!isRecord(value)) {
      this.add(path, 'must be an object with x, y and z');
      return { x: 0, y: 0, z: 0 };
    }
    return {
      x: this.num(value.x, `${path}.x`, -bound, bound),
      y: this.num(value.y, `${path}.y`, -bound, bound),
      z: this.num(value.z, `${path}.z`, -bound, bound),
    };
  }

  /** Reads a list of records, reporting duplicate ids. */
  records<T>(
    value: unknown,
    path: string,
    read: (item: Json, itemPath: string) => T,
    idOf: (item: T) => string,
    max = 256,
  ): T[] {
    if (value === undefined) {
      return [];
    }
    if (!Array.isArray(value)) {
      this.add(path, 'must be a list');
      return [];
    }
    if (value.length > max) {
      this.add(path, `has more than ${max} entries`);
    }
    const seen = new Set<string>();
    const out: T[] = [];
    value.slice(0, max).forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      if (!isRecord(item)) {
        this.add(itemPath, 'must be an object');
        return;
      }
      const read_ = read(item, itemPath);
      const id = idOf(read_);
      if (id) {
        if (seen.has(id)) {
          this.add(`${itemPath}.id`, `duplicate id "${id}"`);
        }
        seen.add(id);
      }
      out.push(read_);
    });
    return out;
  }

  rect(value: unknown, path: string): { minX: number; maxX: number; minZ: number; maxZ: number } {
    if (!isRecord(value)) {
      this.add(path, 'must be a rect with minX, maxX, minZ and maxZ');
      return { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
    }
    const rect = {
      minX: this.num(value.minX, `${path}.minX`, -1000, 1000),
      maxX: this.num(value.maxX, `${path}.maxX`, -1000, 1000),
      minZ: this.num(value.minZ, `${path}.minZ`, -1000, 1000),
      maxZ: this.num(value.maxZ, `${path}.maxZ`, -1000, 1000),
    };
    if (rect.minX >= rect.maxX || rect.minZ >= rect.maxZ) {
      this.add(path, 'min must be less than max on both axes');
    }
    return rect;
  }
}

export function configRoot(input: unknown, issues: Issues): Json {
  if (input === undefined || input === null) {
    return {};
  }
  if (!isRecord(input)) {
    issues.add('', 'must be an object');
    return {};
  }
  return input;
}
