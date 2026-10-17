import { useState } from 'react';
import styles from './StepShell.module.css';
import type { ChoiceOption } from '../engine/types';

interface OrderingStepProps {
  prompt: string;
  items: ChoiceOption[];
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

export function OrderingStep({ prompt, items, disabled, onSubmit }: OrderingStepProps) {
  const [order, setOrder] = useState(items);

  return (
    <div className={styles.card}>
      <p className={styles.prompt}>{prompt}</p>
      <ul className={styles.orderingList}>
        {order.map((item, index) => (
          <li className={styles.orderingItem} key={item.id}>
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
