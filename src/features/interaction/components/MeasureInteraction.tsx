import { useState, type ChangeEvent, type FormEvent } from 'react';
import styles from './Interaction.module.css';

interface MeasureInteractionProps {
  prompt: string;
  unit: string;
  disabled: boolean;
  onSubmit: (value: number) => void;
}

export function MeasureInteraction({ prompt, unit, disabled, onSubmit }: MeasureInteractionProps) {
  const [value, setValue] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value.trim() === '') return;
    onSubmit(Number(value));
  }

  return (
    <form className={styles.card} onSubmit={handleSubmit}>
      <label className={styles.prompt} htmlFor="measure-interaction-answer">
        {prompt}
      </label>
      <span className={styles.field}>
        <input
          id="measure-interaction-answer"
          className={styles.textInput}
          type="number"
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value)}
        />
        <span className={styles.helperText}>{unit}</span>
      </span>
      <button className={styles.primaryButton} type="submit" disabled={disabled || value.trim() === ''}>
        Check my measurement
      </button>
    </form>
  );
}
