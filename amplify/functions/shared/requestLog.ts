/**
 * Structured per-request logging for the custom Lambda resolvers
 * (`claim-coop-slot`, `submit-adventure-answer`, `get-next-learning-activity`),
 * covering `docs/android/android.md` Phase 22's observability record shape
 * (docs/ROADMAP.md "Phase 43"). One JSON line per invocation, written to
 * stdout the same way `operational-metrics/handler.ts`'s EMF lines are —
 * CloudWatch Logs is the publish mechanism, no extra IAM permission or SDK
 * client needed.
 *
 * `platform`/`appVersion` read optional request headers no client sends
 * today (`x-app-platform`/`x-app-version`) — real the moment a second
 * client exists, `null` until then. Same "wire the shape now, populate it
 * later" treatment ADR-015 already gave `DeviceRegistration`. Never logs
 * child free-text, answers, or dialogue (CLAUDE.md section 13) — only the
 * identifiers and outcome metadata already present in every model's
 * primary key.
 */

export type RequestLogResult = 'OK' | 'ERROR';

export interface RequestLogEntry {
  requestId: string;
  functionName: string;
  childProfileId: string | null;
  platform: string | null;
  appVersion: string | null;
  result: RequestLogResult;
  errorCode: string | null;
  durationMs: number;
}

type ResolverHeaders = Record<string, string | undefined> | null | undefined;

function headerValue(headers: ResolverHeaders, name: string): string | null {
  if (!headers) return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && value) return value;
  }
  return null;
}

export function clientPlatform(headers: ResolverHeaders): string | null {
  return headerValue(headers, 'x-app-platform');
}

export function clientAppVersion(headers: ResolverHeaders): string | null {
  return headerValue(headers, 'x-app-version');
}

export function errorCodeOf(error: unknown): string | null {
  return error instanceof Error ? error.name : null;
}

export function formatRequestLog(entry: RequestLogEntry): string {
  return JSON.stringify(entry);
}

function emitRequestLog(entry: RequestLogEntry): void {
  // eslint-disable-next-line no-console -- structured request log; stdout is the CloudWatch Logs publish mechanism.
  console.log(formatRequestLog(entry));
}

/**
 * Runs `run`, then emits exactly one request-log line regardless of outcome.
 * `childProfileId` is whatever the caller already knows before `run`
 * starts (an argument, when the mutation/query takes one directly) —
 * resolvers that only learn it partway through their own DynamoDB lookups
 * (`submit-adventure-answer`) log `null` rather than restructure already-
 * tested control flow just to capture it.
 */
export async function withRequestLog<TResult>(
  params: {
    functionName: string;
    requestId: string;
    headers: ResolverHeaders;
    childProfileId: string | null;
  },
  run: () => Promise<TResult>,
): Promise<TResult> {
  const startedAt = Date.now();
  const base = {
    requestId: params.requestId,
    functionName: params.functionName,
    childProfileId: params.childProfileId,
    platform: clientPlatform(params.headers),
    appVersion: clientAppVersion(params.headers),
  };
  try {
    const result = await run();
    emitRequestLog({ ...base, result: 'OK', errorCode: null, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    emitRequestLog({
      ...base,
      result: 'ERROR',
      errorCode: errorCodeOf(error),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
