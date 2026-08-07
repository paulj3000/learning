import styles from './StepShell.module.css';
import type { ChoiceOption } from '../engine/types';

interface ChoiceStepProps {
  prompt: string;
  options: ChoiceOption[];
  disabled: boolean;
  onSelect: (optionId: string) => void;
}

export function ChoiceStep({ prompt, options, disabled, onSelect }: ChoiceStepProps) {
  return (
    <div className={styles.card}>
      <p className={styles.prompt}>{prompt}</p>
      <ul className={styles.options}>
        {options.map((option) => (
          <li key={option.id}>
            <button
              className={styles.optionButton}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(option.id)}
            >
              {option.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
