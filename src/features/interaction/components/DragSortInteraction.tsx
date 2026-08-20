import { useState } from 'react';
import styles from './Interaction.module.css';
import type { InteractionItem } from '../types';

interface DragSortInteractionProps {
  prompt: string;
  items: InteractionItem[];
  disabled: boolean;
  onSubmit: (order: string[]) => void;
}

function moveItem<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= list.length) return list;
  const next = [...list];
  [next[index], next[targetIndex]] = [next[targetIndex] as T, next[index] as T];
  return next;
}

/**
 * Keyboard/touch/mouse accessible by construction: reordering is done
 * with real `<button>` elements (up/down), never native HTML5 drag
 * events, which are mouse-only and poorly supported by assistive tech —
 * same choice already made in `src/features/adventures/steps/OrderingStep.tsx`.
 */
export function DragSortInteraction({ prompt, items, disabled, onSubmit }: DragSortInteractionProps) {
  const [order, setOrder] = useState(items);

  return (
    <div className={styles.card}>
      <p className={styles.prompt}>{prompt}</p>
      <ul className={styles.list}>
        {order.map((item, index) => (
          <li className={styles.row} key={item.id}>
            <span>{item.label}</span>
            <span className={styles.moveButtons}>
              <button
                className={styles.moveButton}
                type="button"
                aria-label={`Move ${item.label} up`}
                disabled={disabled || index === 0}
                onClick={() => setOrder((current) => moveItem(current, index, -1))}
              >
                &uarr;
              </button>
              <button
                className={styles.moveButton}
                type="button"
                aria-label={`Move ${item.label} down`}
                disabled={disabled || index === order.length - 1}
                onClick={() => setOrder((current) => moveItem(current, index, 1))}
              >
                &darr;
              </button>
            </span>
          </li>
        ))}
      </ul>
      <button
        className={styles.primaryButton}
        type="button"
        disabled={disabled}
        onClick={() => onSubmit(order.map((item) => item.id))}
      >
        Check my order
      </button>
    </div>
  );
}
