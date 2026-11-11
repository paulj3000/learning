import { cn } from './cn';
import { PROGRESS_FILL, type ProgressTone } from './variants';

export interface ProgressIndicatorProps {
  /** What is being measured, read aloud: "Bridge repair". */
  label: string;
  value: number;
  max: number;
  tone?: ProgressTone;
  className?: string;
  /** What is counted, plural: "steps" (the default) or "places explored". */
  unit?: string;
}

/** Clamps to [0, max] and rounds, so a bad count never draws a broken bar. */
export function normalizeProgress(value: number, max: number): { value: number; max: number } {
  const safeMax = Number.isFinite(max) && max > 0 ? Math.round(max) : 0;
  const safeValue = Number.isFinite(value) ? Math.round(value) : 0;
  return { value: Math.min(Math.max(safeValue, 0), safeMax), max: safeMax };
}

/**
 * A calm "how far along" bar (AP-01). It names steps ("2 of 5 steps"), never
 * a score or a percentage to chase (CLAUDE.md pillar 7). Exposed as a
 * `progressbar` with its numbers, and the same words are visible, so the
 * meaning never depends on colour alone.
 */
export function ProgressIndicator({
  label,
  value,
  max,
  tone = 'tropical',
  className,
  unit = 'steps',
}: ProgressIndicatorProps) {
  const normalized = normalizeProgress(value, max);
  const fraction = normalized.max === 0 ? 0 : normalized.value / normalized.max;
  const text = `${normalized.value} of ${normalized.max} ${unit}`;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-baseline justify-between gap-2 text-sm text-ink">
        <span className="font-semibold">{label}</span>
        <span>{text}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={normalized.max}
        aria-valuenow={normalized.value}
        aria-valuetext={text}
        className="h-4 w-full overflow-hidden rounded-full border-2 border-slate-line bg-paper"
      >
        <div
          data-slot="progress-fill"
          className={cn('h-full rounded-full', PROGRESS_FILL[tone])}
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
    </div>
  );
}
