import { useState, type ChangeEvent, type FormEvent } from 'react';
import styles from './ParentGate.module.css';

interface ParentGateProps {
  title: string;
  description: string;
  onSuccess: () => void;
  onCancel: () => void;
}

function randomOperand(): number {
  return 2 + Math.floor(Math.random() * 7);
}

/**
 * A simple adult-only arithmetic challenge (docs/UX_AND_ACCESSIBILITY.md
 * "Parent gate"), used before sensitive actions and when leaving child mode.
 */
export function ParentGate({ title, description, onSuccess, onCancel }: ParentGateProps) {
  const [operands] = useState(() => [randomOperand(), randomOperand()]);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const expected = operands[0] + operands[1];
    if (Number(answer) === expected) {
      setError(null);
      onSuccess();
      return;
    }
    setError('That is not quite right. Please try again.');
  }

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="parent-gate-title"
    >
      <form className={styles.card} onSubmit={handleSubmit}>
        <h2 className={styles.heading} id="parent-gate-title">
          {title}
        </h2>
        <p className={styles.lead}>{description}</p>
        <div className={styles.row}>
          <label className={styles.lead} htmlFor="parent-gate-answer">
            What is {operands[0]} + {operands[1]}?
          </label>
        </div>
        <input
          id="parent-gate-answer"
          className={styles.input}
          type="number"
          inputMode="numeric"
          autoComplete="off"
          value={answer}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setAnswer(event.target.value)}
        />
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button className={styles.buttonSecondary} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.button} type="submit">
            Continue
          </button>
        </div>
      </form>
    </div>
  );
}
