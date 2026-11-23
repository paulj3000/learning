import type { CaptureType } from './captureOutput';

/**
 * Sends a finished capture to the Django Admin capture endpoint (ADR-069). The browser's claim
 * about the image is never trusted: the server sniffs the bytes, checks the size and dimensions,
 * and binds the image to the exact version id and SHA-256 sent here.
 */

export interface UploadCaptureOptions {
  url: string;
  csrfToken: string;
  versionId: string;
  sourceSha256: string;
  blob: Blob;
  type: CaptureType;
  fetchImpl?: typeof fetch;
}

export interface UploadResult {
  ok: boolean;
  message: string;
  artifactId?: string;
}

const FALLBACK = 'The capture could not be saved. Reload the page and try again.';

export async function uploadCapture(options: UploadCaptureOptions): Promise<UploadResult> {
  const form = new FormData();
  form.set('version_id', options.versionId);
  form.set('source_sha256', options.sourceSha256);
  form.set('image', options.blob, options.type === 'image/png' ? 'capture.png' : 'capture.webp');
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(options.url, {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
      redirect: 'error',
      headers: { 'X-CSRFToken': options.csrfToken },
    });
  } catch {
    return { ok: false, message: 'The capture could not be sent. Check your connection.' };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  if (response.ok) {
    const id = typeof record.artifact_id === 'string' ? record.artifact_id : undefined;
    return { ok: true, message: 'Capture saved for review.', artifactId: id };
  }
  const error = record.error;
  const message =
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : FALLBACK;
  return { ok: false, message };
}
