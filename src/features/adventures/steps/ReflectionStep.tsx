import styles from './StepShell.module.css';

interface ReflectionStepProps {
  prompt: string;
  disabled: boolean;
  onContinue: () => void;
}

/**
 * A reflection moment is the child's own pause, not a character's dialogue,
 * so unlike NarrativeStep this has no speaker line.
 */
export function ReflectionStep({ prompt, disabled, onContinue }: ReflectionStepProps) {
  return (
    <div className={styles.card}>
      <p className={styles.prompt}>{prompt}</p>
      <button
        className={styles.primaryButton}
        type="button"
        disabled={disabled}
        onClick={onContinue}
      >
        Continue
      </button>
    </div>
  );
}
