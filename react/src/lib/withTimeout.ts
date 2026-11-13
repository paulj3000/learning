/**
 * Bounds a promise in time, so a call that never settles (a stalled network request, a proxy
 * that never answers) becomes a typed failure the UI can show, instead of a page that waits
 * forever. The underlying work is not cancelled; its late result is ignored.
 */

export class TimeoutError extends Error {
  readonly label: string;
  readonly ms: number;

  constructor(label: string, ms: number) {
    super(`${label} did not finish within ${ms} ms`);
    this.name = 'TimeoutError';
    this.label = label;
    this.ms = ms;
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
