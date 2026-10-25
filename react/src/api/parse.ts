import { ApiError } from './errors';

/**
 * Small runtime readers for API responses (CLAUDE.md section 13: validate all
 * external data at runtime). A response that does not match the documented
 * contract becomes `ApiError('invalid_response')` naming the path, instead of
 * an `undefined` surfacing three components later. No dependency: the
 * contract is small and flat enough for these.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export class Reader {
  readonly value: unknown;
  readonly path: string;

  constructor(value: unknown, path = '$') {
    this.value = value;
    this.path = path;
  }

  private fail(expected: string): never {
    throw new ApiError('invalid_response', { code: `expected ${expected} at ${this.path}` });
  }

  private record(): Record<string, unknown> {
    if (typeof this.value !== 'object' || this.value === null || Array.isArray(this.value)) {
      this.fail('object');
    }
    return this.value as Record<string, unknown>;
  }

  /** A field of this object (which must be an object). */
  field(name: string): Reader {
    return new Reader(this.record()[name], `${this.path}.${name}`);
  }

  string(): string {
    if (typeof this.value !== 'string') this.fail('string');
    return this.value;
  }

  number(): number {
    if (typeof this.value !== 'number' || !Number.isFinite(this.value)) this.fail('number');
    return this.value;
  }

  integer(): number {
    const value = this.number();
    if (!Number.isInteger(value)) this.fail('integer');
    return value;
  }

  boolean(): boolean {
    if (typeof this.value !== 'boolean') this.fail('boolean');
    return this.value;
  }

  oneOf<T extends string>(values: readonly T[]): T {
    const value = this.string();
    if (!(values as readonly string[]).includes(value)) this.fail(`one of ${values.join(', ')}`);
    return value as T;
  }

  nullable<T>(read: (reader: Reader) => T): T | null {
    return this.value === null ? null : read(this);
  }

  array<T>(read: (reader: Reader) => T): T[] {
    if (!Array.isArray(this.value)) this.fail('array');
    return this.value.map((item, index) => read(new Reader(item, `${this.path}[${index}]`)));
  }

  /** Any JSON object, kept as data (e.g. a region's `scene` or a world change `payload`). */
  object(): JsonObject {
    return this.record() as JsonObject;
  }
}

export function read<T>(value: unknown, parse: (reader: Reader) => T): T {
  return parse(new Reader(value));
}
