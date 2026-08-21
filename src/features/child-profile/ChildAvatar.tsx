import { useEffect, useState } from 'react';
import styles from './ChildAvatar.module.css';
import { getAvatarEmoji } from './constants';
import { getChildPhotoUrl } from './avatarPhoto';

interface ChildAvatarProps {
  /** `ChildProfile.avatarKey` - the authored character shown when there is no photo. */
  avatarKey: string | null | undefined;
  /** `ChildProfile.avatarPhotoKey`, when the parent uploaded a photo for this child. */
  photoKey?: string | null;
  /** A resolved URL to show instead of fetching one - used for the not-yet-uploaded preview in the profile form. */
  previewUrl?: string | null;
  size?: 'small' | 'large';
  /**
   * Accessible name. Omit wherever the child's nickname is already
   * rendered next to the icon, which makes the icon decorative and keeps
   * screen readers from announcing the same name twice.
   */
  label?: string;
}

/**
 * The child's profile icon: their uploaded photo if the parent chose one,
 * otherwise the authored avatar character from their profile.
 *
 * A photo needs a short-lived signed URL, so it is resolved on mount
 * (`getChildPhotoUrl` never throws). Until it resolves - and permanently,
 * if it cannot resolve at all - the authored character is shown, so this
 * component always renders something recognizable.
 *
 * Those URLs expire (S3 signs them for minutes, not hours), and a parent
 * dashboard or a child's harbor screen can easily sit open for longer than
 * that. So a failed image load re-mints the URL once before giving up:
 * without that, an expired signature would silently turn every photo back
 * into an emoji until the page was reloaded.
 */
export function ChildAvatar({
  avatarKey,
  photoKey,
  previewUrl,
  size = 'small',
  label,
}: ChildAvatarProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** Guards the re-mint above against looping on a photo that is genuinely broken. */
  const [hasRetried, setHasRetried] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResolvedUrl(null);
    setFailed(false);
    setHasRetried(false);
    if (!photoKey || previewUrl) return;

    void getChildPhotoUrl(photoKey).then((url) => {
      if (!cancelled) setResolvedUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [photoKey, previewUrl]);

  function handleImageError() {
    // A preview URL is a local blob: there is nothing to re-mint.
    if (previewUrl || !photoKey || hasRetried) {
      setFailed(true);
      return;
    }
    setHasRetried(true);
    void getChildPhotoUrl(photoKey).then((url) => {
      if (url && url !== resolvedUrl) {
        setResolvedUrl(url);
      } else {
        setFailed(true);
      }
    });
  }

  const photoUrl = previewUrl ?? resolvedUrl;
  const className = `${styles.avatar} ${size === 'large' ? styles.large : styles.small}`;

  if (photoUrl && !failed) {
    return (
      <img className={className} src={photoUrl} alt={label ?? ''} onError={handleImageError} />
    );
  }

  return (
    <span
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {getAvatarEmoji(avatarKey)}
    </span>
  );
}
