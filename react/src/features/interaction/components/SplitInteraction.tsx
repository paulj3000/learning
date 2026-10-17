import { useState, type ChangeEvent, type FormEvent } from 'react';
import styles from './Interaction.module.css';

interface SplitInteractionProps {
  prompt: string;
  totalLabel: string;
  partsCount: number;
  disabled: boolean;
  onSubmit: (parts: number[]) => void;
}

/** Splits `totalLabel` into `partsCount` parts, one labeled numeric input per part. */
export function SplitInteraction({
  prompt,
  totalLabel,
  partsCount,
  disabled,
  onSubmit,
}: SplitInteractionProps) {
  const [values, setValues] = useState<string[]>(() => Array(partsCount).fill(''));

  function handleChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    setValues((current) => current.map((value, i) => (i === index ? event.target.value : value)));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (values.some((value) => value.trim() === '')) return;
    onSubmit(values.map(Number));
  }

  const runningSum = values.reduce((total, value) => total + (Number(value) || 0), 0);

  return (
    <form className={styles.card} onSubmit={handleSubmit}>
      <p className={styles.prompt}>{prompt}</p>
      <p className={styles.helperText}>{totalLabel}</p>
      {values.map((value, index) => (
        <label className={styles.field} key={index}>
          <span>Part {index + 1}</span>
          <input
            className={styles.textInput}
            type="number"
            inputMode="numeric"
            autoComplete="off"
            disabled={disabled}
            value={value}
            onChange={(event) => handleChange(index, event)}
          />
        </label>
      ))}
      <p className={styles.helperText} aria-live="polite">
        So far: {runningSum}
      </p>
      <button
        className={styles.primaryButton}
        type="submit"
        disabled={disabled || values.some((value) => value.trim() === '')}
      >
        Check my split
      </button>
    </form>
  );
}
