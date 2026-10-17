import styles from './StepShell.module.css';
import type { ChoiceOption } from '../engine/types';

interface ChoiceStepProps {
  prompt: string;
  options: ChoiceOption[];
  disabled: boolean;
  onSelect: (optionId: string) => void;
}

const PLANK_WIDTH = 30;
const PLANK_HEIGHT = 12;
const PLANK_GAP = 4;

/** Renders `groups` (e.g. `[2, 2]`) as rows of countable plank icons, purely decorative. */
function GroupIcons({ groups }: { groups: number[] }) {
  return (
    <span className={styles.groupIcons} aria-hidden="true">
      {groups.map((count, groupIndex) => (
        <span className={styles.groupIconsGroup} key={groupIndex}>
          {groupIndex > 0 && <span className={styles.groupIconsPlus}>+</span>}
          <svg
            width={count * PLANK_WIDTH + (count - 1) * PLANK_GAP}
            height={PLANK_HEIGHT}
            viewBox={`0 0 ${count * PLANK_WIDTH + (count - 1) * PLANK_GAP} ${PLANK_HEIGHT}`}
          >
            {Array.from({ length: count }, (_, plankIndex) => {
              const x = plankIndex * (PLANK_WIDTH + PLANK_GAP);
              return (
                <g key={plankIndex}>
                  <rect
                    x={x}
                    y={0}
                    width={PLANK_WIDTH}
                    height={PLANK_HEIGHT}
                    rx={3}
                    className={styles.plankRect}
                  />
                  <line
                    x1={x + 5}
                    y1={PLANK_HEIGHT / 2}
                    x2={x + PLANK_WIDTH - 5}
                    y2={PLANK_HEIGHT / 2}
                    className={styles.plankGrain}
                  />
                </g>
              );
            })}
          </svg>
        </span>
      ))}
    </span>
  );
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
              {option.groups && <GroupIcons groups={option.groups} />}
              <span>{option.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
