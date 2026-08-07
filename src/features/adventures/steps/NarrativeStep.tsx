import styles from './StepShell.module.css';

interface NarrativeStepProps {
  speaker: string;
  text: string;
  disabled: boolean;
  onContinue: () => void;
}

export function NarrativeStep({ speaker, text, disabled, onContinue }: NarrativeStepProps) {
  return (
    <div className={styles.card}>
      <p className={styles.speaker}>{speaker}</p>
      <p className={styles.prompt}>{text}</p>
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
