import { useState, type ChangeEvent, type FormEvent } from 'react';
import styles from './Interaction.module.css';
import type { InteractionItem } from '../types';

interface DecodeInteractionProps {
  prompt: string;
  prompts: InteractionItem[];
  choices: InteractionItem[];
  disabled: boolean;
  onSubmit: (matches: Array<{ promptId: string; answerId: string }>) => void;
}

/** A native `<select>` per prompt row — keyboard-accessible by construction, unlike a drag-to-match UI. */
export function DecodeInteraction({
  prompt,
  prompts,
  choices,
  disabled,
  onSubmit,
}: DecodeInteractionProps) {
  const [selections, setSelections] = useState<Record<string, string>>({});

  function handleChange(promptId: string, event: ChangeEvent<HTMLSelectElement>) {
    setSelections((current) => ({ ...current, [promptId]: event.target.value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (prompts.some((item) => !selections[item.id])) return;
    onSubmit(prompts.map((item) => ({ promptId: item.id, answerId: selections[item.id] as string })));
  }

  return (
    <form className={styles.card} onSubmit={handleSubmit}>
      <p className={styles.prompt}>{prompt}</p>
      <ul className={styles.list}>
        {prompts.map((item) => (
          <li className={styles.row} key={item.id}>
            <label htmlFor={`decode-${item.id}`}>{item.label}</label>
            <select
              id={`decode-${item.id}`}
              className={styles.select}
              disabled={disabled}
              value={selections[item.id] ?? ''}
              onChange={(event) => handleChange(item.id, event)}
            >
              <option value="" disabled>
                Choose...
              </option>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      <button
        className={styles.primaryButton}
        type="submit"
        disabled={disabled || prompts.some((item) => !selections[item.id])}
      >
        Check my matches
      </button>
    </form>
  );
}
