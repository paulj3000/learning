import { useState, type ChangeEvent, type FormEvent } from 'react';
import styles from './StepShell.module.css';

interface NumberInputStepProps {
  prompt: string;
  disabled: boolean;
  onSubmit: (value: number) => void;
}

export function NumberInputStep({ prompt, disabled, onSubmit }: NumberInputStepProps) {
  const [value, setValue] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value.trim() === '') return;
    onSubmit(Number(value));
  }

  return (
    <form className={styles.card} onSubmit={handleSubmit}>
      <label className={styles.prompt} htmlFor="number-input-answer">
        {prompt}
      </label>
      <input
        id="number-input-answer"
        className={styles.optionButton}
        type="number"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value)}
      />
      <button
        className={styles.primaryButton}
        type="submit"
        disabled={disabled || value.trim() === ''}
      >
        Check my answer
      </button>
    </form>
  );
}
