import { useContext, useEffect, useState } from 'react';
import { cn } from '../portal/ui';
import { ImageResolverContext } from './imageResolver';
import { RealmIllustration } from './RealmIllustration';
import type { RealmScene } from './realmThemes';

interface RealmPictureProps {
  assetId: string | null;
  scene: RealmScene;
  /** What the picture shows, read aloud ("Treasure Cove"). */
  label: string;
  className?: string;
  /** Above the fold: load at once instead of lazily. */
  eager?: boolean;
}

/**
 * A Realm or Place picture (AP-03). The drawn scene shows at once and stays if there is no
 * published image, the image cannot be resolved, or it fails to load, so a child never sees a
 * broken-image icon. A published image loads lazily on top of it.
 */
export function RealmPicture({
  assetId,
  scene,
  label,
  className,
  eager = false,
}: RealmPictureProps) {
  const resolve = useContext(ImageResolverContext);
  const [resolved, setResolved] = useState<{ id: string; url: string | null } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!assetId || !resolve) return undefined;
    let live = true;
    void resolve(assetId).then((url) => {
      if (live) setResolved({ id: assetId, url });
    });
    return () => {
      live = false;
    };
  }, [assetId, resolve]);

  const url = resolved && resolved.id === assetId ? resolved.url : null;
  const showImage = url !== null && url !== failedUrl;
  return (
    <div className={cn('relative overflow-hidden', className)} data-slot="realm-picture">
      <RealmIllustration
        scene={scene}
        label={showImage ? '' : label}
        className="absolute inset-0 h-full w-full"
      />
      {showImage ? (
        <img
          src={url}
          alt={label}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailedUrl(url)}
        />
      ) : null}
    </div>
  );
}
