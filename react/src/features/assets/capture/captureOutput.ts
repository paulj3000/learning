/**
 * Output rules for the staff thumbnail capture (spec version 1 section 4 and 6, ADR-069):
 * bounded sizes, WebP by default, PNG when transparent or when the browser will not make WebP,
 * and a byte limit that matches the server's role limit.
 */

export const OUTPUT_SIZES = [256, 512, 1024] as const;
export const DEFAULT_OUTPUT_SIZE = 512;
export const MAX_OUTPUT_SIZE = 1024;
export const MAX_CAPTURE_BYTES = 512 * 1024;
export const WEBP_QUALITY = 0.85;
export const WEBP_RETRY_QUALITY = 0.7;

export type CaptureType = 'image/webp' | 'image/png';

export class CaptureError extends Error {
  readonly code: 'encode_failed' | 'too_large' | 'bad_size' | 'bad_url';
  constructor(code: CaptureError['code'], message: string) {
    super(message);
    this.name = 'CaptureError';
    this.code = code;
  }
}

/** A requested size forced into 64..1024 and a whole number; anything unusable gives the default. */
export function clampOutputSize(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_OUTPUT_SIZE;
  return Math.min(MAX_OUTPUT_SIZE, Math.max(64, Math.round(n)));
}

export interface EncodedCapture {
  blob: Blob;
  type: CaptureType;
}

export type ToBlob = (type: CaptureType, quality?: number) => Promise<Blob | null>;

export function canvasToBlob(canvas: HTMLCanvasElement): ToBlob {
  return (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Encodes through `toBlob`. Opaque captures ask for WebP (quality 0.85, retried once at 0.7 when
 * over the byte limit); a browser that answers with another type is asked for PNG instead.
 * Transparent captures are PNG. A result that is still over the limit is refused.
 */
export async function encodeCapture(
  toBlob: ToBlob,
  options: { transparent: boolean; maxBytes?: number },
): Promise<EncodedCapture> {
  const maxBytes = options.maxBytes ?? MAX_CAPTURE_BYTES;
  const png = async (): Promise<EncodedCapture> => {
    const blob = await toBlob('image/png');
    if (!blob || blob.type !== 'image/png' || blob.size === 0) {
      throw new CaptureError('encode_failed', 'The browser could not make the image.');
    }
    return { blob, type: 'image/png' };
  };
  let result: EncodedCapture;
  if (options.transparent) {
    result = await png();
  } else {
    let webp = await toBlob('image/webp', WEBP_QUALITY);
    if (webp && webp.type === 'image/webp' && webp.size > maxBytes) {
      webp = await toBlob('image/webp', WEBP_RETRY_QUALITY);
    }
    result =
      webp && webp.type === 'image/webp' && webp.size > 0
        ? { blob: webp, type: 'image/webp' }
        : await png(); // the browser gave another type (or nothing): fall back to PNG
  }
  if (result.blob.size > maxBytes) {
    throw new CaptureError(
      'too_large',
      'The image is over the 512 KiB limit. Choose a smaller size and capture again.',
    );
  }
  return result;
}

/**
 * Only the page's own origin may serve the model: same-origin, http(s), no credentials in the URL.
 * Anything else (another host, `data:`, `blob:`, `javascript:`) is refused before a request.
 */
export function assertSameOriginUrl(url: string, origin: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url, origin);
  } catch {
    throw new CaptureError('bad_url', 'The model address is not valid.');
  }
  if (
    parsed.origin !== new URL(origin).origin ||
    !(parsed.protocol === 'https:' || parsed.protocol === 'http:') ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    throw new CaptureError('bad_url', 'The model must come from this site.');
  }
  return parsed;
}
