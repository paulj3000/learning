import { useState } from 'react';
import styles from './Interaction.module.css';
import type { InteractionItem } from '../types';

interface BuildInteractionProps {
  prompt: string;
  availablePieces: InteractionItem[];
  disabled: boolean;
  onSubmit: (selectedPieceIds: string[]) => void;
}

/** Toggle buttons (`aria-pressed`), not drag-to-slot — keyboard/touch/mouse accessible by construction. */
export function BuildInteraction({
  prompt,
  availablePieces,
  disabled,
  onSubmit,
}: BuildInteractionProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  function toggle(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id],
    );
  }

  return (
    <div className={styles.card}>
      <p className={styles.prompt}>{prompt}</p>
      <ul className={styles.list}>
        {availablePieces.map((piece) => (
          <li key={piece.id}>
            <button
              className={styles.optionButton}
              type="button"
              aria-pressed={selectedIds.includes(piece.id)}
              disabled={disabled}
              onClick={() => toggle(piece.id)}
            >
              {piece.label}
            </button>
          </li>
        ))}
      </ul>
      <button
        className={styles.primaryButton}
        type="button"
        disabled={disabled || selectedIds.length === 0}
        onClick={() => onSubmit(selectedIds)}
      >
        Build it
      </button>
    </div>
  );
}
