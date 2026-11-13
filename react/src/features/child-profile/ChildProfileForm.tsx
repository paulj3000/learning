import { useState, type ChangeEvent, type FormEvent } from 'react';
import styles from './ChildProfileForm.module.css';
import {
  AGE_BAND_OPTIONS,
  AVATAR_OPTIONS,
  INTEREST_OPTIONS,
  MAX_INTERESTS,
  READING_MODE_OPTIONS,
  type AgeBandValue,
  type AvatarValue,
  type ReadingModeValue,
} from './constants';
import { validateInterests, validateNickname } from './validators';
import { ChildPhotoField } from './ChildPhotoField';
import { persistPhotoSelection, type PhotoSelection } from './avatarPhoto';
import {
  applyChildPhotoSelection,
  profilePhotosSupported,
  profilePhotoWrite,
  updateChildProfile,
  type ChildProfile,
  type ChildProfileInput,
} from './api';
import { PHOTO_AFTER_SAVE_PREFIX } from './photoMessages';

interface ChildProfileFormProps {
  initialValue?: Partial<ChildProfileInput>;
  submitLabel: string;
  /**
   * Saves the profile. Return the saved profile: `after-save` stores (Django) need its id to
   * upload the photo afterwards.
   */
  onSubmit: (input: ChildProfileInput) => Promise<ChildProfile | void>;
  /** Called once the profile and its photo are both saved (for example, to navigate away). */
  onSaved?: () => void;
  /** Offer the photo upload. Defaults to whether this build's profile store keeps photos. */
  photosEnabled?: boolean;
  /** How photos are written; defaults to this build's store (`ProfileStore.photoWrite`). */
  photoWrite?: 'before-save' | 'after-save';
}

interface FieldErrors {
  nickname?: string;
  interests?: string;
}

export function ChildProfileForm({
  initialValue,
  submitLabel,
  onSubmit,
  onSaved,
  photosEnabled = profilePhotosSupported(),
  photoWrite = profilePhotoWrite(),
}: ChildProfileFormProps) {
  const [nickname, setNickname] = useState(initialValue?.nickname ?? '');
  const [ageBand, setAgeBand] = useState<AgeBandValue>(initialValue?.ageBand ?? 'SPROUT');
  const [avatarKey, setAvatarKey] = useState<AvatarValue>(
    (initialValue?.avatarKey as AvatarValue) ?? AVATAR_OPTIONS[0].value,
  );
  const [interests, setInterests] = useState<string[]>(initialValue?.interests ?? []);
  const [readingMode, setReadingMode] = useState<ReadingModeValue>(
    initialValue?.readingMode ?? 'VOICE_FIRST',
  );
  const [photoSelection, setPhotoSelection] = useState<PhotoSelection>({ kind: 'unchanged' });
  const existingPhotoKey = initialValue?.avatarPhotoKey ?? null;
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /**
   * Set when an `after-save` profile was saved but its photo step failed. A second submit then
   * updates that profile instead of calling `onSubmit` again, which on the create screen would
   * add a duplicate child.
   */
  const [savedChildId, setSavedChildId] = useState<string | null>(null);

  function toggleInterest(interest: string) {
    setInterests((current) =>
      current.includes(interest)
        ? current.filter((item) => item !== interest)
        : [...current, interest],
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const errors: FieldErrors = {
      nickname: validateNickname(nickname) ?? undefined,
      interests: validateInterests(interests) ?? undefined,
    };
    setFieldErrors(errors);
    if (errors.nickname || errors.interests) return;

    setIsSubmitting(true);
    const input: ChildProfileInput = {
      nickname: nickname.trim(),
      ageBand,
      avatarKey,
      avatarPhotoKey: existingPhotoKey,
      interests,
      readingMode,
    };
    try {
      if (photosEnabled && photoWrite === 'after-save') {
        await saveThenApplyPhoto(input);
      } else {
        // Uploads the chosen photo (if any) first, saves the profile with the
        // resulting path, then cleans up a replaced photo - see
        // `persistPhotoSelection` for why that order matters.
        await persistPhotoSelection(photoSelection, existingPhotoKey, async (avatarPhotoKey) => {
          await onSubmit({ ...input, avatarPhotoKey });
        });
      }
      onSaved?.();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * Django (LAI-0905): the photo is a sub-resource of a saved child, so the profile is saved
   * first and the photo uploaded or removed after it. A photo failure leaves a saved profile, so
   * the message says so and the next submit retries against that profile.
   */
  async function saveThenApplyPhoto(input: ChildProfileInput) {
    const saved = savedChildId
      ? await updateChildProfile(savedChildId, input)
      : await onSubmit(input);
    if (photoSelection.kind === 'unchanged') return;
    if (!saved) throw new Error('Something went wrong. Please try again.');
    try {
      await applyChildPhotoSelection(saved.id, photoSelection);
    } catch (error) {
      setSavedChildId(saved.id);
      const detail = error instanceof Error ? ` ${error.message}` : '';
      throw new Error(`${PHOTO_AFTER_SAVE_PREFIX}${detail}`, { cause: error });
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {formError ? (
        <p className={styles.error} role="alert">
          {formError}
        </p>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="nickname">
          Nickname
        </label>
        <input
          id="nickname"
          className={styles.input}
          type="text"
          value={nickname}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setNickname(event.target.value)}
        />
        {fieldErrors.nickname ? <p className={styles.fieldError}>{fieldErrors.nickname}</p> : null}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="ageBand">
          Age band
        </label>
        <select
          id="ageBand"
          className={styles.select}
          value={ageBand}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            setAgeBand(event.target.value as AgeBandValue)
          }
        >
          {AGE_BAND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className={styles.field}>
        <legend className={styles.label}>Companion avatar</legend>
        <div className={styles.radioGrid}>
          {AVATAR_OPTIONS.map((option) => (
            <label className={styles.radioOption} key={option.value}>
              <input
                type="radio"
                name="avatarKey"
                value={option.value}
                checked={avatarKey === option.value}
                onChange={() => setAvatarKey(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      {photosEnabled ? (
        <ChildPhotoField
          avatarKey={avatarKey}
          existingPhotoKey={existingPhotoKey}
          selection={photoSelection}
          onSelectionChange={setPhotoSelection}
          disabled={isSubmitting}
        />
      ) : null}

      <fieldset className={styles.field}>
        <legend className={styles.label}>Interests</legend>
        <p className={styles.hint}>Choose up to {MAX_INTERESTS}.</p>
        <div className={styles.checkboxGrid}>
          {INTEREST_OPTIONS.map((interest) => (
            <label className={styles.checkboxOption} key={interest}>
              <input
                type="checkbox"
                checked={interests.includes(interest)}
                onChange={() => toggleInterest(interest)}
              />
              {interest}
            </label>
          ))}
        </div>
        {fieldErrors.interests ? (
          <p className={styles.fieldError}>{fieldErrors.interests}</p>
        ) : null}
      </fieldset>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="readingMode">
          Reading mode
        </label>
        <select
          id="readingMode"
          className={styles.select}
          value={readingMode}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            setReadingMode(event.target.value as ReadingModeValue)
          }
        >
          {READING_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <button className={styles.button} type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving...' : submitLabel}
      </button>
    </form>
  );
}
