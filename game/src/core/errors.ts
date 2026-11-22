/**
 * Typed engine errors (CLAUDE.md section 13: typed errors with safe messages).
 *
 * An `EngineError` carries a stable `code` that callers branch on and a developer-facing
 * `message`. It never carries child data: no names, free text, audio or identifiers beyond
 * semantic content ids (adventure, entity and capability ids).
 */

export type EngineErrorCode =
  | 'INVALID_STATE'
  | 'INVALID_CONFIG'
  | 'DUPLICATE_ID'
  | 'UNKNOWN_ID'
  | 'MISSING_DEPENDENCY'
  | 'DEPENDENCY_CYCLE'
  | 'DISPOSED'
  | 'VALIDATION_FAILED'
  | 'INCOMPATIBLE_VERSION'
  | 'ASSET_LOAD_FAILED';

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  /** Structured, non-sensitive details for diagnostics (ids, field paths, limits). */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: EngineErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function isEngineError(value: unknown, code?: EngineErrorCode): value is EngineError {
  return value instanceof EngineError && (code === undefined || value.code === code);
}

/** A validation issue: a dotted field path and a developer-facing message. */
export interface ValidationIssue {
  path: string;
  message: string;
}

/** The result of validating untrusted data: the typed value, or the issues found. */
export type ValidationResult<T> =
  { ok: true; value: T; issues: readonly [] } | { ok: false; issues: readonly ValidationIssue[] };

export function validationOk<T>(value: T): ValidationResult<T> {
  return { ok: true, value, issues: [] };
}

export function validationFailed<T>(issues: readonly ValidationIssue[]): ValidationResult<T> {
  return { ok: false, issues };
}
