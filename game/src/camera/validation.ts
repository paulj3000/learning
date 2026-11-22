/**
 * A tiny, dependency-free validator for flat capability configs. It never throws, reports
 * unknown keys as issues (a typo is never silently ignored) and clamps nothing: a value out of
 * range is an issue, as in `validatePlayerPresentation`.
 */

import {
  validationFailed,
  validationOk,
  type ValidationIssue,
  type ValidationResult,
} from '../core/errors';

export interface NumberField {
  readonly kind: 'number';
  readonly min: number;
  readonly max: number;
}
export interface BooleanField {
  readonly kind: 'boolean';
}
export interface EnumField {
  readonly kind: 'enum';
  readonly values: readonly string[];
}
export interface StringField {
  readonly kind: 'string';
}
export type FieldSpec = NumberField | BooleanField | EnumField | StringField;
export type Schema = Readonly<Record<string, FieldSpec>>;

export const num = (limit: { min: number; max: number }): NumberField => ({
  kind: 'number',
  min: limit.min,
  max: limit.max,
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates `input` (a partial override, or undefined for none) against `schema`, merged over
 * `defaults`. Optional fields without a default stay absent.
 */
export function validateConfig<Config extends object>(
  input: unknown,
  defaults: Config,
  schema: Schema,
  crossCheck?: (merged: Config, issues: ValidationIssue[]) => void,
): ValidationResult<Config> {
  try {
    if (input !== undefined && input !== null && !isObject(input)) {
      return validationFailed([{ path: '', message: 'must be an object' }]);
    }
    const override = (input ?? {}) as Record<string, unknown>;
    const issues: ValidationIssue[] = [];
    const merged: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
    for (const key of Object.keys(override)) {
      const spec = Object.prototype.hasOwnProperty.call(schema, key) ? schema[key]! : undefined;
      const value = override[key];
      if (!spec) {
        issues.push({ path: key, message: 'is not a setting of this capability' });
        continue;
      }
      switch (spec.kind) {
        case 'number':
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            issues.push({ path: key, message: 'must be a number' });
          } else if (value < spec.min || value > spec.max) {
            issues.push({ path: key, message: `must be between ${spec.min} and ${spec.max}` });
          } else {
            merged[key] = value;
          }
          break;
        case 'boolean':
          if (typeof value !== 'boolean') {
            issues.push({ path: key, message: 'must be true or false' });
          } else {
            merged[key] = value;
          }
          break;
        case 'enum':
          if (typeof value !== 'string' || !spec.values.includes(value)) {
            issues.push({ path: key, message: `must be one of ${spec.values.join(', ')}` });
          } else {
            merged[key] = value;
          }
          break;
        case 'string':
          if (typeof value !== 'string' || value.trim() === '') {
            issues.push({ path: key, message: 'must be a non-empty string' });
          } else {
            merged[key] = value;
          }
          break;
      }
    }
    if (issues.length === 0 && crossCheck) {
      crossCheck(merged as Config, issues);
    }
    return issues.length === 0 ? validationOk(merged as Config) : validationFailed(issues);
  } catch (error) {
    return validationFailed([
      {
        path: '',
        message: `could not be validated: ${error instanceof Error ? error.message : 'unknown error'}`,
      },
    ]);
  }
}
