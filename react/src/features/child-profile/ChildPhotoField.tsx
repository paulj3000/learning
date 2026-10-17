import { useEffect, useState, type ChangeEvent } from 'react';
import styles from './ChildPhotoField.module.css';
import { ChildAvatar } from './ChildAvatar';
import { prepareIconBlob, validatePhotoFile, type PhotoSelection } from './avatarPhoto';

interface ChildPhotoFieldProps {
  /** The authored character shown whenever there is no photo to preview. */
  avatarKey: string;
  /** The photo already stored for this child, if any. */
  existingPhotoKey: string | null;
  selection: PhotoSelection;
  onSelectionChange: (selection: PhotoSelection) => void;
  disabled?: boolean;
}

/**
 * The parent-only "use a photo as the icon" control on the child profile
 * form (CLAUDE.md section 2: profile pictures are parent-managed).
 *
 * Nothing is uploaded here. The chosen picture is cropped and re-encoded
 * in the browser for preview, and only reaches S3 when the parent actually
 * saves the profile - so abandoning the form leaves no photo of a child
 * stored anywhere.
 */
export function ChildPhotoField({
  avatarKey,
  existingPhotoKey,
  selection,
  onSelectionChange,
  disabled = false,
}: ChildPhotoFieldProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    if (selection.kind !== 'replace') {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selection.icon);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [selection]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Lets the parent pick the same file again after removing it.
    event.target.value = '';
    if (!file) return;

    setPhotoError(null);
    const validationMessage = validatePhotoFile(file);
    if (validationMessage) {
      setPhotoError(validationMessage);
      return;
    }

    setIsPreparing(true);
    try {
      const icon = await prepareIconBlob(file);
      onSelectionChange({ kind: 'replace', icon });
    } catch (error) {
      setPhotoError(
        error instanceof Error ? error.message : 'We could not read that image. Please try again.',
      );
    } finally {
      setIsPreparing(false);
    }
  }

  const showsPhoto =
    selection.kind === 'replace' || (selection.kind === 'unchanged' && Boolean(existingPhotoKey));

  return (
    <fieldset className={styles.field}>
      <legend className={styles.label}>Profile photo</legend>
      <p className={styles.hint}>
        Optional. Upload a photo of your child to use as their icon, or keep the island character
        above. The photo is stored privately for your account only, is never sent to the AI
        companion, and you can remove it at any time.
      </p>

      <div className={styles.row}>
        <ChildAvatar
          avatarKey={avatarKey}
          photoKey={selection.kind === 'unchanged' ? existingPhotoKey : null}
          previewUrl={previewUrl}
          size="large"
          label="Current profile icon"
        />
        <div className={styles.controls}>
          <label className={styles.label} htmlFor="avatarPhoto">
            {showsPhoto ? 'Choose a different photo' : 'Choose a photo'}
          </label>
          <input
            id="avatarPhoto"
            className={styles.input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={disabled || isPreparing}
            onChange={(event) => {
              void handleFileChange(event);
            }}
          />
          {isPreparing ? <p className={styles.hint}>Preparing photo...</p> : null}
          {showsPhoto ? (
            <button
              className={styles.removeButton}
              type="button"
              disabled={disabled}
              onClick={() => {
                setPhotoError(null);
                onSelectionChange(existingPhotoKey ? { kind: 'remove' } : { kind: 'unchanged' });
              }}
            >
              Remove photo
            </button>
          ) : null}
          {selection.kind === 'remove' && existingPhotoKey ? (
            <p className={styles.hint}>The photo is deleted when you save this profile.</p>
          ) : null}
        </div>
      </div>

      {photoError ? (
        <p className={styles.fieldError} role="alert">
          {photoError}
        </p>
      ) : null}
    </fieldset>
  );
}
