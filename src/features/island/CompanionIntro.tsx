import { useState } from 'react';
import styles from './CompanionIntro.module.css';

interface CompanionIntroProps {
  childNickname: string;
  onChoose: () => Promise<void>;
}

export function CompanionIntro({ childNickname, onChoose }: CompanionIntroProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChoose() {
    setError(null);
    setIsSubmitting(true);
    try {
      await onChoose();
    } catch (chooseError) {
      setError(
        chooseError instanceof Error
          ? chooseError.message
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.heading}>Meet Chatty the Parrot</h1>
        <p className={styles.lead}>
          Hi {childNickname}! Chatty is a curious, friendly parrot who will explore the island with
          you.
        </p>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <button
          className={styles.button}
          type="button"
          disabled={isSubmitting}
          onClick={() => void handleChoose()}
        >
          {isSubmitting ? 'Saying hello...' : 'Choose Chatty as my companion'}
        </button>
      </div>
    </div>
  );
}
