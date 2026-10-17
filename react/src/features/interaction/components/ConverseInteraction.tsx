import styles from './Interaction.module.css';
import type { InteractionItem } from '../types';

interface ConverseInteractionProps {
  prompt: string;
  responses: InteractionItem[];
  disabled: boolean;
  onSelect: (responseId: string) => void;
}

/**
 * A bounded set of curated dialogue responses, never a free-text/open-ended
 * chat box (CLAUDE.md section 2: a child profile "never receives an
 * unrestricted general-purpose chat box").
 */
export function ConverseInteraction({
  prompt,
  responses,
  disabled,
  onSelect,
}: ConverseInteractionProps) {
  return (
    <div className={styles.card}>
      <p className={styles.prompt}>{prompt}</p>
      <ul className={styles.list}>
        {responses.map((response) => (
          <li key={response.id}>
            <button
              className={styles.optionButton}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(response.id)}
            >
              {response.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
