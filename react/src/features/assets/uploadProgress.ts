/** Upload progress, shared by the Amplify and Django asset managers (no storage SDK here). */
export interface UploadProgress {
  transferredBytes: number;
  totalBytes: number;
}

/** Whole-number percentage for the progress display, clamped to 0-100. */
export function progressPercent({ transferredBytes, totalBytes }: UploadProgress): number {
  if (totalBytes <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((transferredBytes / totalBytes) * 100)));
}
