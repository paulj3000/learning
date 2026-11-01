import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AssetUploadFailure,
  type AdminAssetVersion,
  type VersionUploadHandle,
} from '../../../api/assets/djangoAssetAdmin';
import { progressPercent } from '../uploadProgress';
import type { DjangoAssetManager } from '../assetBackend';

export type UploadOutcome =
  | { ok: true; version: number; alreadyUploaded: boolean; uploaded: AdminAssetVersion | null }
  | { ok: false; error: unknown };

/**
 * One model upload to Django with a progress percentage and a cancel button.
 * A file Django already holds as a version (`duplicate_version`, typically a
 * retry whose first response was lost) counts as uploaded.
 */
export function useVersionUpload(manager: DjangoAssetManager) {
  const handle = useRef<VersionUploadHandle | null>(null);
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => () => handle.current?.cancel(), []);

  const start = useCallback(
    async (assetId: string, file: File): Promise<UploadOutcome> => {
      setPercent(0);
      const current = manager.upload(assetId, file, (progress) =>
        setPercent(progressPercent(progress)),
      );
      handle.current = current;
      try {
        const uploaded = await current.result;
        return { ok: true, version: uploaded.number, alreadyUploaded: false, uploaded };
      } catch (error) {
        if (error instanceof AssetUploadFailure && error.existingVersion !== null) {
          return {
            ok: true,
            version: error.existingVersion,
            alreadyUploaded: true,
            uploaded: null,
          };
        }
        return { ok: false, error };
      } finally {
        handle.current = null;
        setPercent(null);
      }
    },
    [manager],
  );

  const cancel = useCallback(() => handle.current?.cancel(), []);

  return { start, cancel, percent, uploading: percent !== null };
}
