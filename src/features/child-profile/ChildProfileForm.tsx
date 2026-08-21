import { useState, type ChangeEvent, type FormEvent } from 'react';
import styles from './ChildProfileForm.module.css';
import {
  AGE_BAND_OPTIONS,
  AVATAR_OPTIONS,
  INTEREST_OPTIONS,
  MAX_INTERESTS,
  READING_MODE_OPTIONS,
  SESSION_MINUTES_RANGE,
  type AgeBandValue,
  type AvatarValue,
  type ReadingModeValue,
} from './constants';
import { validateInterests, validateNickname, validateSessionMinutes } from './validators';
import { ChildPhotoField } from './ChildPhotoField';
import { persistPhotoSelection, type PhotoSelection } from './avatarPhoto';
import type { ChildProfileInput } from './api';

interface ChildProfileFormProps {
  initialValue?: Partial<ChildProfileInput>;
  submitLabel: string;
  onSubmit: (input: ChildProfileInput) => Promise<void>;
}

interface FieldErrors {
  nickname?: string;
  interests?: string;
  sessionMinutes?: string;
}

export function ChildProfileForm({ initialValue, submitLabel, onSubmit }: ChildProfileFormProps) {
  const [nickname, setNickname] = useState(initialValue?.nickname ?? '');
  const [ageBand, setAgeBand] = useState<AgeBandValue>(initialValue?.ageBand ?? 'SPROUT');
  const [avatarKey, setAvatarKey] = useState<AvatarValue>(
    (initialValue?.avatarKey as AvatarValue) ?? AVATAR_OPTIONS[0].value,
  );
  const [interests, setInterests] = useState<string[]>(initialValue?.interests ?? []);
  const [readingMode, setReadingMode] = useState<ReadingModeValue>(
    initialValue?.readingMode ?? 'VOICE_FIRST',
  );
  const [sessionMinutes, setSessionMinutes] = useState(
    initialValue?.sessionMinutes ?? SESSION_MINUTES_RANGE.SPROUT.min,
  );
  const [photoSelection, setPhotoSelection] = useState<PhotoSelection>({ kind: 'unchanged' });
  const existingPhotoKey = initialValue?.avatarPhotoKey ?? null;
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      sessionMinutes: validateSessionMinutes(sessionMinutes, ageBand) ?? undefined,
    };
    setFieldErrors(errors);
    if (errors.nickname || errors.interests || errors.sessionMinutes) return;

    setIsSubmitting(true);
    try {
      // Uploads the chosen photo (if any) first, saves the profile with the
      // resulting path, then cleans up a replaced photo - see
      // `persistPhotoSelection` for why that order matters.
      await persistPhotoSelection(photoSelection, existingPhotoKey, (avatarPhotoKey) =>
        onSubmit({
          nickname: nickname.trim(),
          ageBand,
          avatarKey,
          avatarPhotoKey,
          interests,
          readingMode,
          sessionMinutes,
        }),
      );
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const range = SESSION_MINUTES_RANGE[ageBand];

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
          onChange={(event: ChangeEvent<HTMLSelectElement>) => {
            const nextAgeBand = event.target.value as AgeBandValue;
            setAgeBand(nextAgeBand);
            setSessionMinutes(SESSION_MINUTES_RANGE[nextAgeBand].min);
          }}
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

      <ChildPhotoField
        avatarKey={avatarKey}
        existingPhotoKey={existingPhotoKey}
        selection={photoSelection}
        onSelectionChange={setPhotoSelection}
        disabled={isSubmitting}
      />

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

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sessionMinutes">
          Session length (minutes)
        </label>
        <input
          id="sessionMinutes"
          className={styles.input}
          type="number"
          min={range.min}
          max={range.max}
          value={sessionMinutes}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setSessionMinutes(Number(event.target.value))
          }
        />
        <p className={styles.hint}>
          Recommended {range.min}-{range.max} minutes for this age band.
        </p>
        {fieldErrors.sessionMinutes ? (
          <p className={styles.fieldError}>{fieldErrors.sessionMinutes}</p>
        ) : null}
      </div>

      <button className={styles.button} type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving...' : submitLabel}
      </button>
    </form>
  );
}
