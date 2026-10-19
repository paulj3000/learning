/**
 * Strict, deterministic JSON for content export (LAI-0302).
 *
 * `toJsonValue` refuses anything that is not plain data (functions, class instances, Dates, Maps,
 * NaN, undefined inside arrays...) and says where it was found, so an unsupported shape fails the
 * export instead of being silently dropped or coerced. Optional (undefined) object properties are
 * omitted, which is how the TypeScript content expresses "absent".
 */

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export class UnsupportedContentError extends Error {
  readonly path: string;
  readonly reason: string;

  constructor(path: string, reason: string) {
    super(`Cannot export content at ${path}: ${reason}`);
    this.name = 'UnsupportedContentError';
    this.path = path;
    this.reason = reason;
  }
}

export function toJsonValue(value: unknown, path = '$'): JsonValue {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) throw new UnsupportedContentError(path, 'non-finite number');
      return value;
    case 'object':
      break;
    default:
      throw new UnsupportedContentError(path, `${typeof value} values cannot be exported`);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (item === undefined) throw new UnsupportedContentError(`${path}[${index}]`, 'undefined');
      return toJsonValue(item, `${path}[${index}]`);
    });
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new UnsupportedContentError(path, 'only plain objects and arrays can be exported');
  }
  const out: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(value as object).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child === undefined) continue;
    out[key] = toJsonValue(child, `${path}.${key}`);
  }
  return out;
}

/** Keys sorted (done by `toJsonValue`), two-space indent, newline at the end. */
export function canonicalJson(value: JsonValue): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
